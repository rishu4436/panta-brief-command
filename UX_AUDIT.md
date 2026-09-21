# Panta Brief Command — UX Audit & Improvement Plan

**Date:** 2026-09-21 (IST)  
**Repo:** https://github.com/rishu4436/panta-brief-command  
**Constraint:** Live Panta API only (no demo mode). Do **not** invent endpoints. Keep **Powered by Panta** attribution.  
**API surface in use (canonical):**  
`GET /markets/`, `GET /markets/{id}/`, `GET /categories/`, `GET /markets/{id}/trades/`,  
`POST /primaryorderquote/`, `POST /primaryorderbuild/`, `POST /primaryordersubmit/`, `POST /primaryorderverify/`,  
`GET /positions/?wallet=`, `POST /claim/build/`, `POST /claim/creator-fees/build/`, `POST /trades/`  
(+ local `POST /api/brief` for templated/OpenAI narrative)

**Sources reviewed:** panta.market, polymarket.com, kalshi.com, terminal.pm / Auspex-style terminals, 2026 PM UX pattern guides, and Brief Command `src/` (`/`, `/desk`, `/markets/[id]`, `/execute`, `/book` + components).

---

## 0. What wins in prediction-market UI in 2026

Winning products split into two camps — Brief Command should **own the second**:

| Camp | Exemplars | Win pattern |
| --- | --- | --- |
| **Content shopfront** | Polymarket, panta.market, Kalshi hubs | Card grid, probability-first %, thumbnails, news/context, one-tap Yes/No, discovery feed |
| **Operator terminal** | terminal.pm, Auspex, dense desks | Keyboard-first density, sticky ticket, tape + provenance, step clarity, watchlist/scan, micro-liveness |

Cross-cutting patterns that still apply to a desk:

1. **Probability first** — `%` dominant, cents/price secondary (Polymarket / Robinhood).
2. **Progressive disclosure** — Layer 1: event + odds + act; Layer 2: tape/rules/brief; Layer 3: raw ix / JSON.
3. **Liveness without anxiety** — rolling numbers, “updated Ns ago”, soft color — not flashing stock-ticker panic.
4. **Trust above the fold** — phase, end time, volume, resolution/context visible before money moves.
5. **Micro-interactions** — 200–400ms confirmations on quote fill, side toggle, claim success.
6. **Accessibility** — focus rings, non-color status, ≥44px touch targets, `prefers-reduced-motion`.

**Positioning thesis for Brief Command:**  
Be the **Intel → Execute → Book** command surface on top of Panta — denser, faster, and more legible than the generic Panta shopfront, without pretending to be Polymarket’s social feed. Differentiate with AI Brief, sticky primary ticket, trade tape, and claim desk — not with fake markets.

---

## 1. Current product strengths

### Product / IA
- Clear **three-slice workflow**: Desk (intel) → Execute (primary path) → Book (positions/claims). Matches operator mental model better than a pure browse shopfront.
- **Live-only honesty**: no mock tape, explicit “Powered by Panta”, API-key setup panel instead of silent empty state.
- Full **primary buy lifecycle** exposed: Quote → Build VT → Sign & send → Submit → Verify → `POST /trades/` — rare transparency vs consumer apps that hide the pipeline.
- Market terminal already uses a **3-column layout** (Context + AI Brief | Probability + Tape | Sticky Execute ticket) — correct Auspex/terminal skeleton.
- Book already splits **positions table + claim ticket** with win vs creator-fees modes.

### Visual / craft
- Coherent **dark terminal tokens** (`#0a0a0b` / `#111113` / cyan accent / YES emerald / NO rose).
- Tabular nums (`.font-num`), phase badges, ProbBar / DualSideHero, skeleton loaders, live-dot pulse.
- Wallet adapter restyled to match chrome (no purple clash).
- Landing has a sharp operator pitch (“Built for operators, not demos”) and mini terminal preview.

### Engineering hygiene (UX-relevant)
- Server proxy `/api/panta/*` keeps `X-Api-Key` off the client.
- Types map cleanly to live catalog / quote / positions shapes.
- IST-aware timestamps in desk/detail/brief (good for Asia/Calcutta operators).

---

## 2. Gaps vs panta.market and Polymarket (specific)

### vs **panta.market** (Solana USDC shopfront — Brief’s parent surface)

| Area | panta.market | Brief Command today | Gap |
| --- | --- | --- | --- |
| Discovery unit | Card grid (thumb ~88px, Yes/No CTAs on card, category chips, right rail widgets) | Dense **table rows** only; no images despite `images?` on catalog type | Desk feels thinner than the shopfront for browsing; misses visual scanability |
| First paint | Markets load for users on `/dashboard/user` with pulse skeletons → cards | Desk often hard-walls on **Connect Panta API** when key missing | Correct for live-only, but empty desk feels unfinished vs polished shopfront skeletons |
| Trade action | Inline Yes/No on card → trade sheet | Must open market → sticky ticket → 6 manual steps | Higher cognitive load; ticket reads like a debugger |
| Brand energy | Green CTA `#23ad4e`, rounded-2xl cards, marketing density | Cyan terminal, sparse landing preview with **hardcoded** 62.4% / 184.2k | Landing preview is decorative, not live; shopfront feels more “alive” |
| Attribution | First-party Panta | Footer “Powered by Panta” ✓ | Keep; make it more visible in header chrome without looking like a clone |

**Opportunity:** Out-desk the shopfront with **density + brief + tape + ticket**, while borrowing **card imagery, chip filters, and one-primary-CTA execute** so Brief feels *more* modern, not more austere.

### vs **Polymarket** (content-first global PM)

| Area | Polymarket | Brief Command | Gap |
| --- | --- | --- | --- |
| Home | Featured carousel + news-tied cards + volume | Marketing landing; no live strip | Landing does not prove the product with real markets |
| Probability | Huge %, outcome chips, multi-outcome stacks | DualSideHero good on detail; list ProbBar often `—` until detail fills | Catalog row odds frequently empty → desk looks broken vs Polymarket always-on % |
| Context | News headlines / comments on cards | Description + region/type/creator only | Context panel duplicates title; no “why this moves” until AI Brief click |
| Execute | One Buy Yes/No with size | Six explicit buttons + raw JSON panels | Power-user honesty, but not “easy”; needs guided single **Run path** with advanced expand |
| Engagement | Comments, live sports scores, “NEW”, filters (hide sports/crypto) | Category + phase selects only; client-side search only on loaded page | Weak curation / sort (volume, ending soon, hot) |
| Mobile | Thumb-first cards | Table → stacked rows; execute buttons cramped | Touch targets & hierarchy need mobile pass |

### vs **Kalshi** (trust + density)

- Kalshi surfaces **rules, expiry, fees** prominently. Brief’s execute shows fee only *after* quote; resolution/oracle barely highlighted (`oracle` exists on type but unused in UI).
- Kalshi category taxonomy + Midterms hubs. Brief has categories but no “hub” chips or featured strip.

### vs **terminal.pm / Auspex** (true terminals)

- They sell **scanner density, keyboard nav, watchlists, timestamps/provenance, sticky multi-panel**.  
- Brief has the *idea* (tape, sticky ticket, stepper) but: no keyboard shortcuts, no last-updated clock, no row density mode, execute log/JSON dominates visual weight, no watchlist, no `/` search focus.

---

## 3. Prioritized roadmap (P0 / P1 / P2)

**Constraint reminder:** Only existing Panta endpoints + `/api/brief`. Prefer UI composition of fields already returned (`images`, `volumeUsdc`, `yesPrice`/`primaryYesPrice`, `oracle`, `endTime`, quote `shares`/`avgPrice`/`feeUsdc`/`expiresAt`, position `claimable`/`claimed`).

### P0 — Make the desk feel alive & easier than a shopfront (one sprint)

1. **Live landing proof** — Replace hardcoded hero stats with a small strip from `GET /markets/?limit=6` (titles + ProbBar + link to `/markets/[id]`). Keep CTA → `/desk`. Fail soft (skeleton / “catalog unavailable”) — never invent markets.
2. **Desk density upgrade** — Optional card/list toggle; show `images[0]` thumbnail when present; volume + ends always visible on mobile; chip-style category filters (from `GET /categories/`) instead of only `<select>`.
3. **Probability honesty** — When list prices are null, show muted “Open for spot” (not a lonely `—`); on detail, label **Primary spot** vs secondary when using `primaryYesPrice` / `secondaryYesPrice`.
4. **Execute: Guided path** — Primary CTA **“Quote & continue”** auto-chains Quote→Build→prompt Sign; keep steps 4–6 as secondary. Collapse JSON/desk log behind “Advanced / raw”. Show quote economics as **You pay X → get Y shares @ Z (fee)** in plain language.
5. **Ticket UX** — Amount presets (`10 / 25 / 50 / 100`), side buttons full-width, countdown on `expiresAt`, disable Quote when wallet disconnected with inline Connect.
6. **Liveness chrome** — “Updated {relative} IST” on desk/detail after fetches; subtle pulse on refresh; keep Powered by Panta in header meta + footer.

### P1 — Terminal polish that Polymarket/panta shopfronts lack

7. **Market terminal IA** — Promote oracle/resolution time; de-dupe Context (don’t repeat full title); auto-generate AI Brief on first open (or skeleton “Ready”); tape columns: side · size · wallet · time · primary badge (already mostly there — tighten density).
8. **Desk sort & scan** — Client sort: volume, ending soon, phase; `/` focuses search; `j`/`k` move rows; Enter opens market (Auspex-lite).
9. **Book as P&L desk** — Auto-load positions on wallet connect; claimable rows highlighted; one-click “Claim” fills ticket + optional confirm modal; success toast with sig link (Solana explorer), not only raw string.
10. **Micro-interactions** — Number roll on DualSideHero; checkmark burst on attribute success; side toggle haptic-class CSS; respect `prefers-reduced-motion`.
11. **Accessibility pass** — Skip link, focus-visible rings on all controls, aria-labels on Yes/No, table headers scope, color + text for claimable/claimed.

### P2 — Differentiation / retention (still live-API only)

12. Watchlist (localStorage marketIds) + floating “Ticket” dock.
13. Desk “Hot tape” side rail: last N trades across open markets (would need per-market `trades/` fan-out — rate-limit carefully; skip if too heavy).
14. Shareable market URL OG polish; embeddable ProbBar snippet.
15. Optional OpenAI brief quality presets (bull/bear bullets) — still `/api/brief` only.

---

## 4. Pass-1 build checklist (one push for next coding agent)

Execute as a **single PR/push**. Stay on existing APIs. No demo mode. Keep footer + header attribution.

### A. Landing polish (`src/app/page.tsx`, maybe small `LiveStrip` component)
- [ ] Fetch `GET /markets/?limit=6` via `pantaFetch` in a client island; render 3–6 compact rows (title, ProbBar, volume, link).
- [ ] On error/empty: keep static preview but label **“Preview · connect API for live strip”** — do not fabricate odds.
- [ ] Add secondary line under hero: **Intel → Execute → Book** with jump links.
- [ ] Ensure “Powered by Panta” appears in hero pill (already) **and** footer (already).

### B. Desk density (`MarketList.tsx`, `ProbBar.tsx`, `PhaseBadge.tsx`)
- [ ] Add view toggle: **Rows** (default) | **Cards**.
- [ ] Cards: thumbnail from `images?.[0]` if any; title; PhaseBadge; ProbBar; volume; Ends; click → detail.
- [ ] Replace category `<select>` with horizontal **chip scroller** (All + categories). Keep phase filter.
- [ ] Client sort control: Default | Volume | Ending soon.
- [ ] Empty price state: show `···` + tooltip/title “Spot fills on market open”.
- [ ] Persist search query in URL `?q=` for shareability (optional but nice).
- [ ] Mobile: ensure row tap target ≥44px; show volume under title on xs.

### C. Market terminal (`MarketDetail.tsx`, `AiBrief.tsx`, `TradeTape.tsx`)
- [ ] Header meta: phase · category · volume · ends · **oracle** (if present) · short marketId.
- [ ] Context panel: description only (truncate with “more”); dl for region/type/creator/resolutionTime — don’t repeat title.
- [ ] Probability panel: DualSideHero + caption “Primary/spot from detail fields” (clarify nulls).
- [ ] Tape: denser rows; monospace sizes; sticky column header (Side / Size / Wallet / Time).
- [ ] AI Brief: primary button restyle; optional auto-run once when `market` + `tape` ready (feature-flag via const `AUTO_BRIEF = true`).
- [ ] Sticky ticket column: ensure `lg:top-16` clears header; compact mode amount presets.

### D. Execute ticket UX (`PrimaryBuyPanel.tsx`, `/execute`)
- [ ] Add **Guided** mode (default): one primary button runs Quote → Build → Sign&send sequentially with progress on STEPS; then enable Submit / Verify / Attribute as follow-ups (or chain Submit→Verify→Attribute behind “Finish attribution”).
- [ ] Keep **Manual** toggle for current 6-button lab mode (judges/debug).
- [ ] Plain-language quote card: `Pay {amountUsdc} USDC → ~{shares} {SIDE} @ {avgPrice} · fee {feeUsdc} · expires in Mm:Ss`.
- [ ] Amount chips: 10 / 25 / 50 / 100 / Max(clear).
- [ ] Hide raw JSON behind `<details>`; keep desk log but quieter.
- [ ] If `!connected`, replace Quote with wallet CTA styling consistent with Shell.
- [ ] On success attribute: emerald toast + shortAddr(sig) + copy button.

### E. Book UX (`BookPanel.tsx`)
- [ ] `useEffect` auto `load()` when `publicKey` appears.
- [ ] Claimable rows: left accent border + “Claim” button that sets `claimMarketId`, mode=win, scrolls ticket into view.
- [ ] Claim success: toast + explorer link `https://solscan.io/tx/{sig}` (or cluster-aware if RPC known).
- [ ] Empty state: “No positions — buy on a market terminal” → link `/desk`.
- [ ] Table: add Outcome column when `outcome` present.

### F. Micro-interactions (`globals.css` + components)
- [ ] `@keyframes count-roll` / transition widths already exist — apply `transition-all duration-300` on DualSideHero numbers via key remount or CSS.
- [ ] Button active: `active:scale-[0.98]`.
- [ ] Step chips: animate fill when `step` advances.
- [ ] `prefers-reduced-motion: reduce` → disable live-dot / fade-in transforms.

### G. Accessibility
- [ ] Skip-to-content link in `Shell`.
- [ ] `:focus-visible` outline using `--accent` on links/buttons/inputs.
- [ ] Yes/No buttons: `aria-pressed`.
- [ ] STEPS: `aria-current` on active step.
- [ ] Don’t rely on color alone for claimable (include text).

### H. Guardrails for the implementer
- [ ] **Do not** add demo/mock market arrays.
- [ ] **Do not** call undocumented Panta routes.
- [ ] **Do not** remove “Powered by Panta”.
- [ ] Prefer composing existing fields over new backend work.
- [ ] After UI changes: `npm run build` must pass.

---

## 5. Suggested file touch list (Pass-1)

| File | Change |
| --- | --- |
| `src/app/page.tsx` | Live markets strip |
| `src/components/MarketList.tsx` | Cards/chips/sort/null-price |
| `src/components/MarketDetail.tsx` | Meta, context, oracle |
| `src/components/PrimaryBuyPanel.tsx` | Guided execute, presets, plain quote |
| `src/components/BookPanel.tsx` | Autoload, claimable CTA, toasts |
| `src/components/AiBrief.tsx` | Optional auto-generate |
| `src/components/TradeTape.tsx` | Denser header |
| `src/components/Shell.tsx` | Skip link, stronger Panta chip |
| `src/components/ProbBar.tsx` | Null-state affordance |
| `src/app/globals.css` | Motion, focus-visible, reduced-motion |

---

## 6. Success criteria

- Landing shows **real** catalog snippets when `PANTA_API_KEY` works.
- Desk is scannable in <3s (chips + probs or clear “open for spot”).
- Market page feels like a **mini terminal**, not three disconnected cards.
- New user can complete primary buy with **≤2 conscious clicks** after wallet connect (Guided mode), while Manual mode remains for auditors.
- Book loads without hunting for Refresh; claimables are obvious.
- Still 100% live API; still attributed to Panta; build green.

---

## Appendix — Competitive notes (quick)

- **Polymarket:** Card = navigation atom; news-as-context; probability as content; weak as a power desk.
- **panta.market:** Same card grammar on Solana; green retail CTAs; right rail; Brief should feel like the **pro skin** of this liquidity, not a clone.
- **Kalshi:** Rules/fees/trust; category intent browsing.
- **terminal.pm / Auspex:** Density, keyboard, provenance timestamps, sticky multi-panel — steal *interaction*, not multi-venue scope (out of API scope).
