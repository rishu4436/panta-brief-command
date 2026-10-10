/**
 * Embed URL + iframe snippet builder (pure; client + server).
 * The slug is URL-encoded, every attribute value is HTML-escaped, and the
 * options come only from the allowlist, so the snippet can't carry markup.
 */

import { embedHeight, embedQuery, type EmbedOptions } from "./options";

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"'`]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" })[c]!);

export const embedPath = (slug: string) => `/embed/rooms/${encodeURIComponent(slug)}`;

export function embedUrl(origin: string, slug: string, o: EmbedOptions): string {
  return `${origin}${embedPath(slug)}?${embedQuery(o)}`;
}

export const roomUrl = (origin: string, slug: string) => `${origin}/rooms/${encodeURIComponent(slug)}`;

/**
 * <iframe> markup for a host page. `sandbox` without allow-scripts or
 * allow-same-origin: the widget needs neither (it has no script and no
 * cookies); allow-popups(-to-escape-sandbox) lets "Open on Brief Command"
 * open a normal tab.
 */
export function iframeSnippet(origin: string, slug: string, title: string, o: EmbedOptions): string {
  const src = embedUrl(origin, slug, o);
  const label = `${title} · community forecast on Brief Command`;
  return (
    `<iframe src="${escapeHtml(src)}" title="${escapeHtml(label)}" width="100%" height="${embedHeight(o)}" ` +
    `style="border:0;max-width:560px;width:100%;color-scheme:normal" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" ` +
    `sandbox="allow-popups allow-popups-to-escape-sandbox"></iframe>`
  );
}
