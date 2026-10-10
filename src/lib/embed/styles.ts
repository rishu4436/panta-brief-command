/**
 * The widget's only stylesheet, inlined in a <style> element and allowed by
 * its SHA-256 hash in the embed CSP (no 'unsafe-inline', no style attributes,
 * no external files, no web fonts). Bars and the distribution are SVG
 * geometry attributes, which CSP doesn't treat as inline style.
 */

import { createHash } from "node:crypto";

export const EMBED_CSS = `
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font:14px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased;background:transparent}
.t-dark{--bg:#0b0f17;--card:#0f1521;--line:#1f2937;--ink:#e6edf6;--ink2:#b4c0d0;--ink3:#7d8a9c;--accent:#22d3ee;--accent2:#67e8f9;--track:#1e293b;--yes:#34d399;--warn:#fbbf24;--focus:#67e8f9;color-scheme:dark}
.t-light{--bg:#ffffff;--card:#ffffff;--line:#d9dee7;--ink:#0f172a;--ink2:#334155;--ink3:#5b6778;--accent:#0e7490;--accent2:#0891b2;--track:#e2e8f0;--yes:#047857;--warn:#92400e;--focus:#0e7490;color-scheme:light}
body{color:var(--ink)}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;max-width:560px;margin:0 auto;min-height:100%}
.l-compact .card{padding:12px 14px}
a{color:inherit}
a:focus-visible{outline:2px solid var(--focus);outline-offset:2px;border-radius:4px}
.eyebrow{margin:0;font-size:10px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}
h1{margin:4px 0 0;font-size:17px;line-height:1.3;font-weight:650;letter-spacing:-.01em;overflow-wrap:anywhere}
.l-compact h1{font-size:15px}
h1 a{text-decoration:none}
h1 a:hover{text-decoration:underline}
.q{margin:6px 0 0;font-size:13px;color:var(--ink2);overflow-wrap:anywhere}
.q b{font-weight:600;color:var(--ink3)}
.row{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:8px}
.badge{display:inline-flex;align-items:center;min-height:22px;padding:2px 8px;border-radius:999px;border:1px solid var(--line);font-size:11px;font-weight:600;color:var(--ink2)}
.b-open{border-color:var(--accent);color:var(--accent)}
.b-ok{border-color:var(--yes);color:var(--yes)}
.b-warn{border-color:var(--warn);color:var(--warn)}
.community{margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}
.l-compact .community{margin-top:8px;padding-top:8px}
.label{margin:0;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ink3)}
.big{margin:2px 0 0;font-size:32px;line-height:1.1;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.l-compact .big{font-size:24px}
.big small{font-size:13px;font-weight:600;color:var(--ink3);letter-spacing:0;margin-left:6px}
.sub{margin:2px 0 0;font-size:12px;color:var(--ink3)}
.bar{display:block;width:100%;height:8px;margin-top:8px}
.bar .tr{fill:var(--track)}
.bar .fl{fill:var(--accent)}
.dist{margin:10px 0 0}
.dist svg{display:block;width:100%;height:56px}
.dist .col{fill:var(--accent2);opacity:.85}
.dist .base{fill:var(--line)}
.dist figcaption{display:flex;justify-content:space-between;font-size:10px;color:var(--ink3);margin-top:2px;font-variant-numeric:tabular-nums}
.market{margin-top:12px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;font-size:12.5px;color:var(--ink2)}
.l-compact .market{margin-top:8px;padding:8px 10px}
.market p{margin:0}
.market .fresh{margin-top:3px;font-size:11px;color:var(--ink3)}
.market strong{color:var(--ink);font-variant-numeric:tabular-nums}
.res{margin-top:10px;font-size:12.5px;color:var(--ink2)}
.res strong{color:var(--ink)}
footer{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 12px;margin-top:14px}
.l-compact footer{margin-top:10px}
.cta{display:inline-flex;align-items:center;min-height:36px;padding:6px 12px;border-radius:10px;background:var(--accent);color:var(--bg);font-weight:650;font-size:13px;text-decoration:none}
.cta:hover{filter:brightness(1.08)}
.attr{margin:0;font-size:11px;color:var(--ink3)}
.attr a{text-decoration:none;font-weight:600;color:var(--ink2)}
.attr a:hover{text-decoration:underline}
.note{margin:8px 0 0;font-size:10.5px;color:var(--ink3)}
.sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media (max-width:360px){.card{padding:12px}.big{font-size:26px}footer{flex-direction:column;align-items:stretch}.cta{justify-content:center}}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`.trim();

export const EMBED_CSS_HASH = `sha256-${createHash("sha256").update(EMBED_CSS, "utf8").digest("base64")}`;
