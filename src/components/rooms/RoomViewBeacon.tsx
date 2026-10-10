"use client";

import { useEffect } from "react";
import { CAMPAIGN_ID_RE, STUDIO_EVENT_SCHEMA_VERSION } from "@/lib/studio/domain";

/**
 * One beacon per page load and room. Keyed by slug only: React strict mode runs
 * effects twice in development, and the first run strips ?ref/?c from the URL,
 * so an href-based key would send a second, unattributed beacon.
 */
const sent = new Set<string>();

function optedOut(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack === "1" || nav.globalPrivacyControl === true;
}

/**
 * Creator Studio room-view beacon: one same-origin navigator.sendBeacon per
 * page load. Sends only the event name, `?ref=embed` / `?c=<campaign>` when
 * present, and the referring site's HOST NAME (never a URL or query). No
 * cookies are set, no identifiers stored, nothing third-party. Honors Do Not
 * Track / Global Privacy Control. The attribution params are then removed
 * from the address bar so a re-shared link isn't attributed to the embed or
 * campaign again.
 */
export function RoomViewBeacon({ slug }: { slug: string }) {
  useEffect(() => {
    if (sent.has(slug)) return;
    sent.add(slug);
    const url = new URL(window.location.href);
    const ref = url.searchParams.get("ref") === "embed" ? "embed" : null;
    const c = url.searchParams.get("c");
    const campaign = c && CAMPAIGN_ID_RE.test(c) ? c : null;
    if (url.searchParams.has("ref") || url.searchParams.has("c")) {
      url.searchParams.delete("ref");
      url.searchParams.delete("c");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
    if (optedOut()) return;
    let referrerHost: string | null = null;
    try {
      referrerHost = document.referrer ? new URL(document.referrer).hostname.slice(0, 253) || null : null;
    } catch {
      referrerHost = null;
    }
    const body = JSON.stringify({ schemaVersion: STUDIO_EVENT_SCHEMA_VERSION, event: "room_view", ref, campaign, referrerHost });
    const endpoint = `/api/rooms/${encodeURIComponent(slug)}/events`;
    try {
      if (navigator.sendBeacon?.(endpoint, new Blob([body], { type: "application/json" }))) return;
    } catch {
      /* fall through */
    }
    void fetch(endpoint, { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" } }).catch(() => undefined);
  }, [slug]);
  return null;
}
