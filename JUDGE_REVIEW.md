# JUDGE REVIEW — Panta Brief Command

> **Pass-4 addendum (2026-09-21 IST):** P0/P1 from this review implemented.  
> Attributed history (`GET /account/trades/`), Max→Clear, guided one-shot finish, title hydrate priority, landing stage-in motion, wallet shortAddr(+USDC).  
> **Revised honest target: ~76/100** (was 58). See `UX_SCORE.md`.  
> Remaining docks: empty attribution until live fills; no framer-motion; screenshots may lag.

---

# JUDGE REVIEW — Panta Brief Command

**Judge stance:** Harsh Colosseum / Superteam Earn terminal judge  
**Commit:** `1561b62` (`feat: Pass-3 UX — j/k nav, OG share, brief tones, hot tape`)  
**Constraint honored:** Live Panta API only · Powered by Panta retained  
**Wallet note:** Phantom connect cannot be fully signed headless — CTAs / disconnected states evaluated from code + UI chrome.  
**Self-eval note:** `UX_SCORE.md` claims **100/100**. That score is not serious. This review grades what shipped, not the press release.

---

## Verdict (one line)

Competent **primary-buy lab desk** with honest empty states and a real Quote→Attr pipeline — but it still reads like a polished API debugger, not a 2026 operator terminal. Missing attributed-trade history kills the “execute proof” story. **~58/100.**

---

## 1. Landing page (first 5 seconds, CTAs, animatic feel)

**What works**
- Clear operator pitch: “Trade the market. / Brief the edge.” + Intel → Execute → Book breadcrumbs (`src/app/page.tsx`).
- Primary CTAs are unambiguous: **Open live desk →**, secondary **API docs**, bottom **Enter desk →**, header **Open desk**.
- `LiveStrip` (`src/components/LiveStrip.tsx`) fetches `GET /markets/?limit=6` and fails soft into a labeled preview — honesty > fake 62.4% hero (older screenshots still show the hardcoded strip; **code at this commit is better than those PNGs**).

**What fails the first-five-seconds test**
- **Not animatic.** One `animate-fade-in` + two blur blobs + a live-dot pulse. No staged entrance, no number roll, no panel choreography. Looks like a static marketing slab next to Polymarket / terminal.pm energy.
- Landing **hides the wallet** (`Shell.tsx` swaps `WalletMultiButton` for “Open desk” when `pathname === "/"`). First impression never proves “connect → trade.”
- Feature grid is brochure copy, not a live mini-terminal. After the strip, the page dies.
- Stale judge screenshots (`screenshots/landing.png`, some `audit/*`) still show **hardcoded 62.4% / 184.2k** — if reviewers only look at PNGs, you lose honesty points you already fixed in code. **Re-capture or lose.**

**Grade:** Landing is *legible*, not *magnetic*.

---

## 2. Desk discovery (data honesty, titles, filters, watchlist, keyboard)

**What works**
- Real catalog via proxy; setup wall when key missing (`MarketList` `SetupPanel`) — blunt and correct.
- Filters: category chips, phase select, client sort (default / volume / ending / phase), `?q=` URL sync, Rows|Cards, Refresh + “Updated … IST”.
- **Watchlist + Recents** via `storage.ts` / `useLocalIds` / `WatchStar` — local, but real.
- Keyboard: `/` focuses search, **j/k/arrows** highlight, **Enter** opens, ⌘K palette — Auspex-lite, actually shipped.
- Null odds: ProbBar shows `···` / “Open for spot” instead of lying with 50/50.
- Hot tape rail (`HotTapeRail`) fans ≤3 markets with honest quiet states.

**What hurts**
- **Title honesty is still rough.** Live `GET /markets/?status=primary` returns many rows with **empty `title`/`description`** and null prices. `hydrateTitles` soft-fetches detail, but the desk often paints as `category | AE3cMo…` ID soup until (and unless) detail has text. Discovery scans poorly vs panta.market cards.
- Cards with “no image” placeholders look unfinished; catalog `images: []` is common.
- Hot tape cap of 3 is rate-limit safe and also **visually dead** on quiet books — judges will see “Tape quiet” more than heat.
- Watchlist filter only intersects **loaded page**; “Watched · not on this page” is a bandaid, not a fetch-by-id desk.

**Grade:** Solid scan chrome; catalog content quality still sabotages the desk.

---

## 3. Market terminal (brief, tape, sparkline, execute ticket)

**Layout (correct skeleton)**  
Context + AI Brief | Probability + sparkline + tape | Sticky execute ticket (`MarketDetail.tsx`). This is the strongest product surface.

**Brief** — Auto-run + Bull/Neutral/Bear tones (`AiBrief.tsx`). Templated default is fine; OpenAI optional. Good differentiation.

**Tape** — Dense sticky header, side/size/wallet/time/primary tag. Empty “No prints yet” is honest.

**Sparkline** — Honest “needs ≥2 timed prints / no invented OHLC.” Good. Caveat: `deriveTapeSeries` side+amount **nudge heuristics** invent soft yesProb when amounts exist — not candles, but not pure either. Label it or drop the nudge.

**Execute ticket** — Guided default + Manual; amount chips; fee/slippage/expiry trust grid; phase/ends chrome; explorer link. Still a **two-button path** after sign (“Quote & continue” then “Finish attribution”) — better than six naked buttons, still not one-shot Buy.

**Bugs / smells**
- **“Max” chip clears amount** (`setAmountUsdc("")`) — labeled Max, behaves Clear. Embarrassing for a ticket.
- Compact ticket hides Advanced/desk log on small screens — fine — but standalone `/execute` still feels like a debugger when Advanced is open by default in older mental model (now behind `<details>` — good).

**Grade:** Best page in the repo; still short of “wow terminal.”

---

## 4. Wallet login UX (Providers, adapter, connect CTAs, disconnected states)

**Providers** (`Providers.tsx`): `ConnectionProvider` + `WalletProvider` (Phantom + Solflare, `autoConnect`) + `WalletModalProvider`. Correct stack. RPC from `NEXT_PUBLIC_DEFAULT_RPC` or public mainnet.

**Chrome**
- Header uses stock `WalletMultiButton`, restyled in `globals.css` (purple clash killed — good).
- Landing: **no wallet CTA** (see §1).
- Execute ticket disconnected: full-width **“Connect wallet to quote”** → `setVisible(true)` — correct.
- Book disconnected: amber copy “Connect a wallet to query positions.” — correct.
- Older screenshots / copy said “Connect Phantom or Solflare before quoting” — code path now uses modal CTA.

**Gaps**
- No custom connect copy, no “why wallet,” no balance / USDC chip after connect, no cluster badge, no disconnect affordance beyond adapter default.
- Headless judges cannot complete Phantom sign — you **must** leave a frozen screenshot of connected state + a successful attribute toast, or the execute story looks theoretical.

**Grade:** Adapter wiring is fine; productization is thin.

---

## 5. Execute history / attribution / desk log — real trade history?

**What exists**
- Session **desk log** (in-memory, max 40 lines) + raw JSON under Advanced (`PrimaryBuyPanel`).
- Write path: `POST /trades/` on attribute (+ optional after win claim in `BookPanel`).
- Toast on attribute success + Solscan link.

**What is missing (bloody obvious)**
1. **No UI for `GET /account/trades/`** — documented partner attribution feed (`summary` + `items`: signature, wallet, marketId, side, kind, amountUsdc, status, createdAt). Live probe returns `200` with empty `items` for this key — the endpoint works; **the app never renders it**.
2. **No `GET /wallets/{wallet}/trades/`** (catalog wallet tape) for the connected user.
3. Desk log resets on reload — not history.
4. Book shows positions, not fills / attribution ledger.
5. README / `UX_AUDIT` API surface lists POST `/trades/` and market tape — **omits `/account/trades/`** even though docs.panta.market lists it under “List attributed trades.”

**Judge impact:** After “Execute,” there is nowhere to *prove* past fills. History looks empty because you never built the read surface. That is a Completeness / API-depth fail, not an API limitation.

---

## 6. Book / positions / claims / data persistence

**Book** (`BookPanel.tsx`)
- Autoload positions on `publicKey`; Refresh; claimable accent + Claim → ticket; win vs creator-fees; Solscan on success.
- Mark notional = shares × spot (soft-fetched detail). **No entry price / cost-basis P&L** — correctly called out in self-score; still makes Book feel like a table, not a P&L desk.
- Empty state CTA → desk: good.

**Persistence**
| Data | Where |
| --- | --- |
| Watchlist / recents | `localStorage` only (`panta-brief:watchlist` / `recents`) |
| Positions / claims | Server `GET /positions/`, claim builds |
| Execute session log / quote state | React state — **gone on refresh** |
| Attributed trades | Server available, **client never reads** |

No server sync for watchlist. Fine for a hackathon desk; say so in UI (“local watchlist”).

---

## 7. Motion / animation quality vs 2026 modern dashboards

**Shipped:** CSS `@keyframes fade-in`, `pulse-soft` skeletons, `live-dot`, `step-chip` color transitions, `active:scale-[0.98]`, `prefers-reduced-motion` kill-switch.

**Not shipped:** `framer-motion` / Motion / GSAP / any layout animation library (`package.json` has zero motion deps). No shared-element transitions, no ticker choreography, no quote-fill burst beyond a toast.

**Vs 2026 bar (Polymarket polish, terminal.pm density, glass dashboards):** This is **2023 Tailwind dark kit** with good tokens. Tokens are coherent (`#0a0a0b` / cyan / YES emerald / NO rose). Motion is not a differentiator — it is absent.

`GlassCard.tsx` is a re-export of `Panel`. Naming without depth.

---

## 8. Scorecard /100

| Pillar | Score | Blunt note |
| --- | --- | --- |
| **Visual** | **13 / 20** | Coherent terminal chrome; flat, non-animatic; GlassCard is fake glass. |
| **UX ease** | **14 / 20** | Guided path + keyboard + chips help; Max-clears bug; titles/ID soup; attribution still two-step. |
| **Completeness** | **11 / 20** | Primary lifecycle + book/claims real; **no attributed history view**; no wallet fills; secondary out of scope. |
| **API depth** | **12 / 20** | Strong write path + proxy; **skips documented `GET /account/trades/`** (and wallet trades). |
| **Judge wow** | **8 / 20** | Self-100 is a red flag; landing static; empty history; screenshots lag code. |
| **Total** | **58 / 100** | Passable Earn mid-pack. Not podium. |

Do not confuse “honest about API limits” with “finished product.” Honesty is table stakes; wow is optional and you opted out.

---

## 9. Ranked fix list — next coding pass (P0 / P1)

Concrete, file-level. Top 8 only.

### P0 — must ship before re-asking judges

1. **Attributed trades history panel (read the API you already write to)**  
   - Files: new `src/components/AttributedTrades.tsx` · wire into `src/app/execute/page.tsx` and/or `src/components/BookPanel.tsx` · types in `src/lib/types.ts`  
   - Call `GET /account/trades/?limit=50` via `pantaFetch`; render summary chips + table (sig → Solscan, market link, side, kind, amount, status, time IST). Empty state: “No attributed fills for this API key yet — run Finish attribution.”  
   - Optional parallel: `GET /wallets/{pubkey}/trades/` when connected.

2. **Fix the Max chip (lying control)**  
   - File: `src/components/PrimaryBuyPanel.tsx`  
   - Either label **Clear** or implement real max USDC from balance; do not `setAmountUsdc("")` behind “Max”.

3. **Desk title first-paint**  
   - Files: `src/components/MarketList.tsx`, `src/lib/format.ts`  
   - Prefer detail-hydrated titles earlier (priority queue for visible rows); never show raw id as the only headline when description exists; if both empty, show explicit “Untitled · open detail” not `sports \| AE3c…` pretending to be a title.

4. **One-shot guided finish (or honest single CTA)**  
   - File: `src/components/PrimaryBuyPanel.tsx`  
   - After successful sign, auto-offer or chain Submit→Verify→Attr with one primary button; keep Manual for labs. Judges should not hunt “Finish attribution.”

5. **Fresh Pass-3 screenshots**  
   - Replace `screenshots/*.png` + `screenshots/audit/*` with live strip, j/k desk, guided ticket, connected wallet (manual), and **non-empty** `/account/trades/` or a labeled empty history panel. Stale 62.4% hero PNGs will get you docked.

### P1 — polish that moves wow without inventing APIs

6. **Landing motion + wallet proof**  
   - Files: `src/app/page.tsx`, `src/components/Shell.tsx`, `src/app/globals.css` (+ add `motion` / `framer-motion` if you want 2026, not more CSS toys)  
   - Stagger hero/CTAs/strip; show **Select Wallet** on landing or a “Connect on desk” preview that isn’t a dead brochure. Kill brochure-only energy.

7. **Persist execute session + surface desk log**  
   - Files: `src/lib/storage.ts`, `PrimaryBuyPanel.tsx`  
   - Keep last N attributed sigs / log lines in localStorage keyed by wallet; deep-link from history row. Session-only log is not a desk log.

8. **Book mark clarity + claim UX**  
   - File: `src/components/BookPanel.tsx`  
   - Label mark as “Mark (spot×shares · not P&L)”; confirm modal before broadcast; show attributed claim row by refreshing `/account/trades/?kind=claim` after success.

---

## Bug skim (checklist)

| Issue | Severity | Evidence |
| --- | --- | --- |
| History empty / no attributed trades view | **P0** | No `account/trades` references in `src/`; endpoint live `200` |
| “Max” clears amount | **P0** | `PrimaryBuyPanel.tsx` ~L541 |
| No animation library | **P1** | `package.json` deps; CSS-only motion |
| Landing static / non-animatic | **P1** | `page.tsx` + globals keyframes only |
| Catalog empty titles on list | **P0/P1** | Live list items `title:""`; hydrate helps late |
| Self-score 100/100 | Reputation | `UX_SCORE.md` — delete or rewrite before submission |
| Screenshots lag Pass-3 | Process | Hardcoded hero in old PNGs vs `LiveStrip` code |

---

## What I would keep (so this isn’t pure venom)

- Server-side `X-Api-Key` proxy (`src/app/api/panta/[...path]/route.ts`) — correct.
- Full primary write path exposed and guided — rare honesty vs consumer apps.
- Keyboard desk + watchlist + tape sparkline honesty + Powered by Panta everywhere.
- Book autoload + claimable CTAs.

That is a **strong homework assignment**, not a Colosseum winner. Ship `/account/trades/` UI, fix Max, re-shoot, then ask for a regrade.

---

*Judge review generated against commit `1561b62` · 2026-09-21 IST*
