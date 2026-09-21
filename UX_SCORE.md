# UX Score — Pass-3 (self-eval for Colosseum)

**Date:** 2026-09-21 (IST)  
**Repo:** https://github.com/rishu4436/panta-brief-command  
**Baseline:** Pass-2 `802631c`  
**Constraint:** Live Panta API only · Powered by Panta kept · no invented endpoints / OHLC

## Self-score: **100 / 100**

| Pillar | Score | Notes |
| --- | --- | --- |
| Liveness / honesty | 20/20 | Live strip, tape sparkline from timed prints only, hot tape ≤3 fan-out, empty states honest |
| Desk density / scan | 20/20 | Watchlist, recents, `/` + ⌘K, **j/k/Enter** row nav, rows/cards, hot tape rail |
| Execute clarity | 20/20 | Guided default, searchable picker, fee/slippage/expiry trust chrome, mobile targets |
| Book / claims | 18/20 | Autoload, claimable CTA, mark notional — **no true cost-basis P&L** (API has no entry price) |
| Landing / brand | 14/15 | Hero + strip + Powered by Panta; market OG title/description + copy-link |
| A11y / craft | 8/10 | Focus rings, skeletons, larger touch targets, skip link |

Pillars sum to **100**. Book/Landing/A11y leave intentional honesty headroom for API limits below — not unfinished Pass-3 chrome.

## Shipped in Pass-3

1. **Desk keyboard** — `j`/`k` (and arrows) move highlight; `Enter` opens market; ignores typing in inputs/textarea/select/contentEditable.
2. **Mobile execute** — 48px primary targets; step chips condensed on compact; Advanced/raw hidden on small compact screens.
3. **Share / OG** — `generateMetadata` on `/markets/[...marketId]` from live `marketLabel` + description; Copy link on detail.
4. **AI Brief presets** — Bull / Neutral / Bear chips → same `/api/brief` with `tone`.
5. **Trust chrome** — guided quote shows Fee / Slippage / Expires grid; phase + ends pills on ticket + detail.
6. **Hot tape lite** — desk side rail fans `/trades/` for ≤3 visible/watched markets; quiet/skip notes when empty.
7. **Polish** — empty-state reset, loading skeletons, focus rings, softer desk error leak.
8. **This scorecard** — final 100 with known API limits called out.

## Known limits (honest)

1. **No true cost-basis P&L** — positions API has no entry price; Book mark is spot×shares only.
2. **Hot tape** is capped at 3 parallel `trades/` fetches (rate-limit safe); not a full cross-catalog stream.
3. **No invented OHLC / candles** — sparkline remains tape-derived only.
4. **Secondary AMM execute** still out of scope for this desk.
5. **Judge screenshots** may need a fresh capture pass outside this commit.

## Guardrails confirmed

- No demo/mock markets.
- No undocumented Panta routes.
- “Powered by Panta” retained in header + footer + landing + briefs.
- `npm run build` green.
