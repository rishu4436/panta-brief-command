# UX Score — Pass-5 (harsh visual judge tour)

**Date:** 2026-09-21 (IST)  
**Repo:** https://github.com/rishu4436/panta-brief-command  
**Baseline:** Pass-4 `89331c8` (~76) · judge tour screenshots in `screenshots/judge/`  
**Constraint:** Live Panta API only · Powered by Panta kept · no invented endpoints / OHLC

## Honest target score: **83 / 100**

| Pillar | Before (P4) | After (P5) | Notes |
| --- | --- | --- | --- |
| **Visual** | 15/20 | **17/20** | Wallet modal card/overlay swapped; desk stagger + skeleton pulses; reduced-motion |
| **UX ease** | 17/20 | **18/20** | Active≠hover nav + aria-current; one market picker; Book Connect CTA; loading skeletons |
| **Completeness** | 16/20 | **17/20** | Route loading UIs; human tape sizes + relative time; LiveStrip primary-first |
| **API depth** | 15/20 | **15/20** | Same live surfaces; honesty on tape-implied vs spot |
| **Judge wow** | 13/20 | **16/20** | Modal no longer flat-black; jargon stripped; sparkline honesty; disabled claim ≠ live teal |
| **Total** | **~76** | **~83** | Upper Earn pack. Not podium without live attributed fills + framer-level motion. |

## Shipped in Pass-5

1. **Wallet modal CSS** — `.wallet-adapter-modal` = translucent dim/blur overlay; `.wallet-adapter-modal-wrapper` = opaque `#111113` card (border/radius/shadow). Close button gets `aria-label="Close"`.
2. **Route `loading.tsx`** — desk / markets / execute / book skeleton chrome on hard reload.
3. **Shell nav** — active = cyan soft ring (≠ hover grey); `aria-current="page"`.
4. **Sparkline honesty** — labeled **Tape-implied**; gates flow-mix/nudge when it diverges from spot; axis anchored to spot; print count synced with timed tape.
5. **TradeTape** — human USDC/shares (base÷1e6 when needed); relative time.
6. **Copy** — dropped “Primary/spot from detail fields”, “Attribution userId”, ISO brief footer → friendly IST; desk keyboard soup softened.
7. **Execute inputs** — compact ticket = locked market (no triple inputs); desk execute = searchable select; paste-ID + partner ref behind Advanced.
8. **Book empty** — inline Connect wallet; no orphan table headers; disabled claim CTA muted grey vs live cyan.
9. **LiveStrip** — prefer `status=primary`, demote cancelled/resolved.
10. **Motion** — desk row/card stagger, skeleton shimmer, `prefers-reduced-motion`.
11. **Categories** — show API category; hide sports chip only when title clearly politics (conservative).

## Known limits (still honest)

1. Empty attribution ledger until a real `POST /trades/` lands for this API key.
2. No true cost-basis P&L on Book marks.
3. CSS motion only — no framer-motion.
4. Secondary AMM execute still out of scope.
5. Category remap never invented — sports-on-politics may still appear when keywords unclear.

## Guardrails confirmed

- No demo/mock markets.
- No undocumented Panta routes.
- “Powered by Panta” retained.
- `npm run build` green.
