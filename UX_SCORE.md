# UX Score — Pass-2 (self-eval for Colosseum)

**Date:** 2026-09-21 (IST)  
**Repo:** https://github.com/rishu4436/panta-brief-command  
**Baseline:** Pass-1 `0c60b3e`  
**Constraint:** Live Panta API only · Powered by Panta kept · no invented endpoints / OHLC

## Self-score: **88 / 100**

| Pillar | Score | Notes |
| --- | --- | --- |
| Liveness / honesty | 18/20 | Live strip, tape sparkline only from timed prints, empty states honest |
| Desk density / scan | 17/20 | Watchlist chip, recents, `/` search, rows/cards, chips — still no j/k row nav |
| Execute clarity | 17/20 | Guided default, searchable picker, toast dismiss — advanced path still dense |
| Book / claims | 16/20 | Autoload, claimable label+CTA, mark notional when detail prices hydrate |
| Landing / brand | 12/15 | Stronger hero, single CTA band, strip chrome — OG/share still weak |
| A11y / craft | 8/10 | Focus rings, contrast bump, skip link — more touch audit left |

## Shipped in Pass-2

1. **Tape sparkline** — derives YES% series from trade tape timestamps/sizes/sides; empty dashed state when &lt;2 timed prints (no fake OHLC).
2. **Watchlist** — `localStorage` marketIds; ★ on desk rows/cards + detail; Watchlist filter chip; missing-page stubs.
3. **Command search** — `/` focuses desk search; ⌘K / header button opens market jump palette.
4. **Landing energy** — gradient hero, tighter vertical rhythm, live-strip border polish, duplicate CTA band removed.
5. **Book PnL-ish** — Mark column = shares × side price when detail hydrate succeeds; Claimable label; empty CTA to `/desk`.
6. **Execute polish** — filterable market picker; toast with dismiss; label contrast.
7. **Typography/contrast** — muted tokens + muddy labels bumped toward zinc-400.
8. **Recents** — `localStorage` recent marketIds strip on desk; detail visits push recent.

## Remaining gaps → 100

1. **Keyboard row nav** (`j`/`k`/Enter) on desk — Auspex-lite unfinished.
2. **Hot tape rail** — cross-market fan-out of `trades/` (rate-limit careful) — skipped as heavy.
3. **OG / share cards** for market URLs.
4. **True cost basis P&amp;L** — API has no entry price on positions; mark is spot-only.
5. **Mobile execute** — guided buttons still tight on narrow widths.
6. **Auto-brief quality presets** (bull/bear) via `/api/brief` only.
7. **Visual regression / judge screenshots** not refreshed in this pass.
8. **Error copy** still occasionally leaks proxy codes on desk setup.

## Guardrails confirmed

- No demo/mock markets.
- No undocumented Panta routes.
- “Powered by Panta” retained in header + footer + landing.
- `npm run build` green.
