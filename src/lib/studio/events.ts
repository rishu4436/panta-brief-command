import "server-only";

/**
 * Privacy-conscious distribution counting (see docs/CREATOR_STUDIO.md).
 *
 *  - No cookies, no third-party pixels, no wallet, no raw IPs: repeats are
 *    recognised by HMAC(daily salt, ip | user agent | room | event); the salt
 *    is derived from the server secret and the UTC day, so keys can't be
 *    linked across days and the IP can't be recovered.
 *  - Not counted: Do Not Track / Global Privacy Control, prefetch / prerender
 *    requests, and user agents that look automated (heuristic).
 *  - Referrers are reduced to a bucket (direct / embed / same-site /
 *    external host name); never a URL, path or query string.
 */

import { after } from "next/server";
import { createHmac } from "node:crypto";
import { clientIp } from "@/lib/rate-limit";
import { sessionSecret } from "@/lib/rooms/auth";
import type { RoomRecord } from "@/lib/rooms/domain";
import type { RoomRepository } from "@/lib/rooms/store";
import { appOrigin } from "@/lib/embed/origin";
import { campaignMetric, CAMPAIGN_ID_RE, METRIC, REFERRER_HOST_RE, srcHostMetric, utcDay, type RoomEventInput } from "./domain";

export const BOT_UA_RE =
  /bot\b|bot\/|crawl|spider|slurp|scrape|headless|phantomjs|puppeteer|playwright|selenium|lighthouse|pagespeed|curl\/|wget|python|httpclient|okhttp|go-http|java\/|libwww|axios|node-fetch|undici|postman|insomnia|facebookexternalhit|embedly|preview|monitor|uptime|pingdom|validator/i;

export type SkipReason = "privacy" | "prefetch" | "bot";

/** Why this request must not be counted, or null when it may be. */
export function skipReason(h: Headers): SkipReason | null {
  if (h.get("dnt") === "1" || h.get("sec-gpc") === "1") return "privacy";
  const purpose = `${h.get("purpose") ?? ""} ${h.get("sec-purpose") ?? ""} ${h.get("x-purpose") ?? ""} ${h.get("x-moz") ?? ""}`.toLowerCase();
  if (/prefetch|prerender|preview/.test(purpose) || h.get("next-router-prefetch") !== null || h.get("rsc") === "1") return "prefetch";
  const ua = (h.get("user-agent") ?? "").trim();
  if (ua.length < 20 || ua.length > 512 || BOT_UA_RE.test(ua)) return "bot";
  return null;
}

/** Lower-cased host name without port / trailing dot, or null if it isn't a plausible host. */
export function cleanHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const h = raw.trim().toLowerCase().replace(/\.$/, "");
  if (h === "localhost") return h;
  return REFERRER_HOST_RE.test(h) ? h : null;
}

const hostnameOf = (origin: string) => {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
};

/** Source bucket metric for a room view. */
export function sourceMetric(input: { ref?: "embed" | null; referrerHost?: string | null }, ownHosts: (string | null)[]): string {
  if (input.ref === "embed") return METRIC.srcEmbed;
  if (input.referrerHost == null || input.referrerHost === "") return METRIC.srcDirect;
  const host = cleanHost(input.referrerHost);
  if (!host) return METRIC.srcOther;
  if (ownHosts.includes(host)) return METRIC.srcSameSite;
  if (host === "localhost") return METRIC.srcOther;
  return srcHostMetric(host);
}

/** Daily-rotating HMAC dedupe key; null when no server secret is configured (then nothing is counted). */
export function dedupeKey(input: { secret: string | null; nowMs: number; ip: string; ua: string; roomId: string; event: string }): string | null {
  if (!input.secret) return null;
  const salt = createHmac("sha256", input.secret).update(`studio-dedupe:v1:${utcDay(input.nowMs)}`).digest();
  return createHmac("sha256", salt).update(`${input.ip}\n${input.ua}\n${input.roomId}\n${input.event}`).digest("hex").slice(0, 40);
}

export type RecordOutcome = "counted" | "duplicate" | "capped" | "skipped" | "unavailable";

function keyFor(h: Headers, room: RoomRecord, event: string, nowMs: number) {
  return dedupeKey({ secret: sessionSecret(), nowMs, ip: clientIp(h), ua: (h.get("user-agent") ?? "").slice(0, 512), roomId: room.roomId, event });
}

/** Observed room view from the same-origin beacon. The room must be active (callers check). */
export async function recordRoomView(repo: RoomRepository, room: RoomRecord, input: RoomEventInput, h: Headers, nowMs: number, requestHost: string | null): Promise<RecordOutcome> {
  if (skipReason(h)) return "skipped";
  const key = keyFor(h, room, input.event, nowMs);
  if (!key) return "unavailable";
  const own = [hostnameOf(appOrigin()), requestHost ? requestHost.split(":")[0].toLowerCase() : null];
  const metrics: string[] = [METRIC.view, sourceMetric(input, own)];
  if (input.ref === "embed") metrics.push(METRIC.cta);
  if (input.campaign && CAMPAIGN_ID_RE.test(input.campaign)) metrics.push(campaignMetric(input.campaign));
  return repo.recordStudioEvent({ creatorWallet: room.creatorWallet, roomId: room.roomId, day: utcDay(nowMs), metrics, dedupeKey: key, nowMs });
}

/** Server request for the room's embed widget (approximate: CDN-cached loads never reach the server). */
export async function recordEmbedRequest(repo: RoomRepository, room: RoomRecord, h: Headers, nowMs: number): Promise<RecordOutcome> {
  if (skipReason(h)) return "skipped";
  const key = keyFor(h, room, "embed", nowMs);
  if (!key) return "unavailable";
  return repo.recordStudioEvent({ creatorWallet: room.creatorWallet, roomId: room.roomId, day: utcDay(nowMs), metrics: [METRIC.embed], dedupeKey: key, nowMs });
}

/** Run after the response is sent (Next `after`); outside a request scope (tests) it runs detached. Never throws. */
export function runAfterResponse(task: () => Promise<unknown>): void {
  const safe = () => task().then(
    () => undefined,
    () => undefined,
  );
  try {
    after(safe);
  } catch {
    void safe();
  }
}
