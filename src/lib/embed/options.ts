/**
 * Embed display options: a closed allowlist (pure; client + server).
 *
 *   theme  = dark | light        (default dark)
 *   layout = compact | standard  (default standard)
 *   dist   = 1 | 0               (default 1, the community distribution; standard only)
 *   market = 1 | 0               (default 1, the Panta market line)
 *
 * Unknown keys are ignored; a known key with an invalid value falls back to
 * its default (a typo on a host page must not break the widget). Values are
 * matched exactly against the allowlist, so nothing from the query string
 * ever reaches the HTML, CSS or a script (the widget has no script).
 */

export const EMBED_THEMES = ["dark", "light"] as const;
export const EMBED_LAYOUTS = ["compact", "standard"] as const;
export type EmbedTheme = (typeof EMBED_THEMES)[number];
export type EmbedLayout = (typeof EMBED_LAYOUTS)[number];

export type EmbedOptions = { theme: EmbedTheme; layout: EmbedLayout; dist: boolean; market: boolean };

export const DEFAULT_EMBED_OPTIONS: EmbedOptions = { theme: "dark", layout: "standard", dist: true, market: true };

type ParamSource = { get(name: string): string | null };

const pick = <T extends string>(allowed: readonly T[], v: string | null, d: T): T => (v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : d);
const flag = (v: string | null, d: boolean) => (v === "1" ? true : v === "0" ? false : d);

export function parseEmbedOptions(sp: ParamSource): EmbedOptions {
  return {
    theme: pick(EMBED_THEMES, sp.get("theme"), DEFAULT_EMBED_OPTIONS.theme),
    layout: pick(EMBED_LAYOUTS, sp.get("layout"), DEFAULT_EMBED_OPTIONS.layout),
    dist: flag(sp.get("dist"), DEFAULT_EMBED_OPTIONS.dist),
    market: flag(sp.get("market"), DEFAULT_EMBED_OPTIONS.market),
  };
}

/** Canonical query string (always all four keys, fixed order). */
export function embedQuery(o: EmbedOptions): string {
  return `theme=${o.theme}&layout=${o.layout}&dist=${o.dist ? 1 : 0}&market=${o.market ? 1 : 0}`;
}

/** Suggested iframe height in CSS px for the options (content scrolls inside if a narrow host wraps more). */
export function embedHeight(o: EmbedOptions): number {
  if (o.layout === "compact") return o.market ? 340 : 270;
  return 340 + (o.dist ? 100 : 0) + (o.market ? 100 : 0);
}
