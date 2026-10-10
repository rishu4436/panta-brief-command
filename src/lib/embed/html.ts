/**
 * Server-rendered widget HTML (pure string building; no client script).
 * Every dynamic value goes through escapeHtml; URLs are built by us from
 * the configured origin + an encoded slug; options come from the allowlist.
 */

import { formatBpsPercent } from "@/lib/forecasts/domain";
import type { EmbedModel } from "./model";
import type { EmbedOptions } from "./options";
import { escapeHtml as e } from "./snippet";
import { EMBED_CSS } from "./styles";

const EXT = 'target="_blank" rel="noopener noreferrer"';

function shell(o: EmbedOptions, title: string, canonical: string | null, body: string): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex,nofollow">` +
    `<meta name="referrer" content="strict-origin-when-cross-origin">` +
    `<title>${e(title)}</title>` +
    (canonical ? `<link rel="canonical" href="${e(canonical)}">` : "") +
    `<style>${EMBED_CSS}</style></head>` +
    `<body class="t-${o.theme} l-${o.layout}">${body}</body></html>`
  );
}

function bar(meanBps: number): string {
  const w = Math.max(0, Math.min(100, meanBps / 100));
  return `<svg class="bar" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true" focusable="false"><rect class="tr" x="0" y="0" width="100" height="8" rx="4"/><rect class="fl" x="0" y="0" width="${w.toFixed(2)}" height="8" rx="4"/></svg>`;
}

function distribution(buckets: number[], participants: number): string {
  const max = Math.max(1, ...buckets);
  const cols = buckets
    .map((n, i) => {
      const h = n === 0 ? 0 : Math.max(2, Math.round((n / max) * 50));
      return `<rect class="col" x="${i * 10 + 1}" y="${52 - h}" width="8" height="${h}" rx="1"/>`;
    })
    .join("");
  const desc = buckets.map((n, i) => `${i * 10}–${i === 9 ? 100 : i * 10 + 10}%: ${n}`).join(", ");
  return (
    `<figure class="dist"><svg viewBox="0 0 100 54" preserveAspectRatio="none" role="img" aria-label="${e(`Distribution of ${participants} forecast${participants === 1 ? "" : "s"} by YES probability. ${desc}`)}" focusable="false">` +
    `${cols}<rect class="base" x="0" y="52" width="100" height="1"/></svg>` +
    `<figcaption aria-hidden="true"><span>0%</span><span>50%</span><span>100%</span></figcaption></figure>`
  );
}

function statusBadges(m: EmbedModel): string {
  const lc = m.market.lifecycle;
  const tone = lc === "open" ? "b-open" : lc === "resolved" && m.resolution?.kind === "verified" ? "b-ok" : "";
  let html = `<span class="badge ${tone}">${e(m.market.lifecycleLabel)}</span>`;
  if (m.resolution?.kind === "verified") html += `<span class="badge b-ok">Verified: ${m.resolution.outcome === "yes" ? "YES" : "NO"}</span>`;
  else if (m.resolution?.kind === "blocked") html += `<span class="badge b-warn">Resolution sources disagree</span>`;
  else if (m.resolution?.kind === "awaiting_verification") html += `<span class="badge b-warn">Awaiting verification</span>`;
  return `<div class="row">${html}</div>`;
}

function resolutionLine(m: EmbedModel): string {
  const r = m.resolution;
  if (!r) return "";
  if (r.kind === "verified") {
    const how = r.via === "arena" ? "verified and finalized: Panta's market record and the on-chain market account agree" : "Panta's market record and the on-chain market account agree";
    return `<p class="res">Resolved <strong>${r.outcome === "yes" ? "YES" : "NO"}</strong> · ${e(how)}${r.slot !== null ? ` (slot ${r.slot})` : ""}.</p>`;
  }
  if (r.kind === "blocked") return `<p class="res">Panta's record and the on-chain account report different outcomes, so no result is shown until they agree.</p>`;
  return `<p class="res">A resolution has been reported but not yet verified by both Panta and the on-chain account, so the outcome isn't shown here yet.</p>`;
}

function marketLine(m: EmbedModel, o: EmbedOptions): string {
  if (!o.market) return "";
  const p = m.market.price;
  let line: string;
  if (p.mode === "probability") line = `Panta primary price implies YES <strong>${e(p.yesPct)}</strong>`;
  else if (p.mode === "secondary") line = `Panta last secondary prices: YES <strong>${e(p.yes)}</strong> · NO <strong>${e(p.no)}</strong> <span>(prices, not probabilities)</span>`;
  else line = e(p.why);
  return `<section class="market" aria-label="Panta market"><p>${line}</p><p class="fresh">${e(m.market.freshness)}</p></section>`;
}

export function renderEmbed(m: EmbedModel, o: EmbedOptions): string {
  const c = m.community;
  const compact = o.layout === "compact";
  const has = c.meanBps !== null && c.participants > 0;
  const final = Boolean(m.resolution) || (m.market.lifecycle !== null && m.market.lifecycle !== "open");
  const label = final ? "Final community forecast · YES" : "Community forecast · YES";
  const forecasters = `${c.participants} forecaster${c.participants === 1 ? "" : "s"}`;
  const community = has
    ? `<p class="label">${label}</p><p class="big">${e(formatBpsPercent(c.meanBps!, 1))}<small>mean of ${forecasters}</small></p>` +
      bar(c.meanBps!) +
      (!compact && o.dist ? distribution(c.buckets, c.participants) : "")
    : `<p class="label">${label}</p><p class="big">—</p><p class="sub">${m.forecastingOpen ? "No forecasts yet. Be the first." : "No community forecasts were made."}</p>`;
  const cta = m.forecastingOpen ? "Add your forecast on Brief Command" : "Open the room on Brief Command";
  const body =
    `<main class="card" aria-labelledby="h">` +
    `<p class="eyebrow">Prediction Room</p>` +
    `<h1 id="h"><a href="${e(m.roomUrl)}" ${EXT}>${e(m.title)}</a></h1>` +
    (o.market && m.question && !compact ? `<p class="q"><b>Market:</b> ${e(m.question)}</p>` : "") +
    statusBadges(m) +
    `<section class="community" aria-label="Community forecast">${community}</section>` +
    (compact ? "" : resolutionLine(m)) +
    marketLine(m, o) +
    `<footer><a class="cta" href="${e(m.roomUrl)}" ${EXT}>${e(cta)}<span class="sr"> (opens in a new tab)</span></a>` +
    `<p class="attr"><a href="${e(m.homeUrl)}" ${EXT}>Brief Command</a> · Powered by Panta</p></footer>` +
    (compact ? "" : `<p class="note">Community forecasts are opinions from wallet-verified users, not a Panta price or a guarantee of any outcome.</p>`) +
    `</main>`;
  return shell(o, `${m.title} · Brief Command`, m.roomUrl, body);
}

/** Plain message page (not found, unavailable, rate limited). */
export function renderEmbedMessage(o: EmbedOptions, homeUrl: string, heading: string, text: string): string {
  const body =
    `<main class="card" aria-labelledby="h"><p class="eyebrow">Prediction Room</p>` +
    `<h1 id="h">${e(heading)}</h1>` +
    `<p class="q">${e(text)}</p>` +
    `<footer><a class="cta" href="${e(homeUrl)}" ${EXT}>Visit Brief Command<span class="sr"> (opens in a new tab)</span></a>` +
    `<p class="attr">Brief Command · Powered by Panta</p></footer></main>`;
  return shell(o, `${heading} · Brief Command`, null, body);
}

/** One response for missing, archived and malformed rooms alike (no detail leaks). */
export const renderEmbedNotFound = (o: EmbedOptions, homeUrl: string) =>
  renderEmbedMessage(o, homeUrl, "Room not available", "This room doesn't exist or can't be shown here.");
