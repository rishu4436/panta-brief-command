# UX Score — Pass-4 (post harsh-judge P0/P1)

**Date:** 2026-09-21 (IST)  
**Repo:** https://github.com/rishu4436/panta-brief-command  
**Baseline:** Harsh judge `JUDGE_REVIEW.md` against Pass-3 `1561b62` → **58/100**  
**Constraint:** Live Panta API only · Powered by Panta kept · no invented endpoints / OHLC

## Honest target score: **76 / 100**

| Pillar | Before | After | Notes |
| --- | --- | --- | --- |
| **Visual** | 13/20 | **15/20** | Staged landing fade/slide (CSS); still no framer-motion / glass depth |
| **UX ease** | 14/20 | **17/20** | Max→Clear fixed; guided one-shot Quote→Attr; wallet shortAddr + optional USDC |
| **Completeness** | 11/20 | **16/20** | `GET /account/trades/` Activity on Book + Execute; honest empty state |
| **API depth** | 12/20 | **15/20** | Documented attribution read surface wired; write path unchanged |
| **Judge wow** | 8/20 | **13/20** | History gap closed; landing motion + connect proof strip; titles hydrate earlier |
| **Total** | **58** | **~76** | Mid→upper Earn pack. Not podium without live attributed fills + fresh screenshots. |

## Shipped in Pass-4 (this pass)

1. **Attributed trades history** — `AttributedTrades.tsx` → `GET /account/trades/?limit=50` with summary chips, kind filter (buy|claim), Solscan links, IST times; wired on `/book` and `/execute`.
2. **Max chip** — renamed **Clear** (presets 10/25/50/100 remain). No fake Max.
3. **Guided one-shot** — after successful sign, auto-chains Submit → Verify → Attribute with phase progress; Manual mode kept; Retry finish if mid-pipeline.
4. **Catalog titles** — hydrate prioritizes primary + volume; progressive paint; description snippet while title empty; `Untitled · open detail` instead of ID soup headline.
5. **Landing motion** — CSS `stage-in` delays for hero + strip; “Connect in desk” proof strip; wallet button on landing.
6. **Wallet productization** — `shortAddr` in header meta; optional USDC via RPC token accounts (soft-fail).
7. **Score honesty** — this file replaces the prior self-100.

## Known limits (still honest)

1. **Empty attribution ledger** until a real POST /trades/ lands for this API key — UI is ready; data may be empty.
2. **No true cost-basis P&L** — Book mark is spot×shares only (labeled).
3. **No framer-motion** — CSS staged entrance only.
4. **Secondary AMM execute** still out of scope.
5. **Screenshots** may still lag — re-capture recommended for judges.

## Guardrails confirmed

- No demo/mock markets.
- No undocumented Panta routes (`/account/trades/` is documented).
- “Powered by Panta” retained.
- `npm run build` green.
