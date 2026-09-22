# Brief Command — Landing Research V2

**Date:** 2026-09-22 (IST)  
**Scope:** Product-story landing `/` only (not live markets). Desk is `/desk`.  
**Commit under review:** `69eb6dd` — immersive framer-motion scroll  
**Artifacts read:** `LANDING_RESEARCH.md`, `LandingExperience.tsx`, `mocks.tsx`, judge PNGs `landing-immersive-{hero,path,mid,cta}.png`, prior `JUDGE_REVIEW.md` / `UX_SCORE.md`, desk PNG for risk contrast.  
**Method:** Cold-judge read of shipped UI + fresh 2025–2026 web research (Polymarket, Kalshi, panta.market, Wager Predict, terminal.pm, Auspex, Razorpay Sprint26, Linear, Raycast, Vercel/Stripe density patterns).

---

## Executive verdict

| Surface | Cold-judge score | Notes |
| --- | --- | --- |
| **Landing `/` (now)** | **74 / 100** | Directionally correct immersive story; motion & structure beat Pass-5 static. Still short of best-in-show craft + decisive promise. |
| **Landing if Top-5 gaps closed** | **~92–95** | Achievable without pivoting aesthetic. |
| **Desk `/desk` (context)** | Still the larger podium risk | Landing sells an operator terminal; cold catalog / quiet tape / ID titles break the promise on entry. |

**Recommendation:** **Keep iterating this immersive direction.** Do not pivot to Polymarket/Kalshi catalog-home aesthetics (forbidden on `/` and wrong for a Panta Earn “operator desk” entry). Do not retreat to a static Linear brochure. Escalate *narrative fidelity* and *product chrome realism* inside the same scroll scaffold.

---

## 1. What shipped (cold read of screenshots + code)

### Structure (good bones)
1. **Hero** — Full-viewport dark canvas, BrandMark + Powered by Panta, display wordmark, dual CTAs, illustrative YES/NO probability bar, “Scroll the path.”
2. **Path** — Four beats: Intel → Brief → Execute → Book with zig-zag copy + `MockFrame` chrome.
3. **Immersion** — Sticky scroll runway that morphs panel (card / brief / ticket / book).
4. **Final CTA** — “Enter the desk.” + Open live desk / Docs.

### Craft already present
- Framer Motion: scroll progress bar, cursor glow, particle field, magnetic CTAs, parallax hero grid, `whileInView` path beats, sticky immersion crossfade.
- `prefers-reduced-motion` branches (particles/glow/progress stripped; immersion falls back to static grid).
- Illustrative labeling on mocks and dual bars (honesty vs fake live).
- Shell keeps ⌘K + Open desk + Powered by Panta + Select Wallet on landing chrome.

### What a harsh judge sees in 10 seconds
- **Taste:** Dark SaaS / Linear-adjacent — competent, not unique.
- **Promise:** Category tagline (“operator desk for Solana prediction markets…”) not a command-model thesis.
- **Motion:** Visible effort (particles, looping bar, magnetic buttons) — reads as *decoration* more than *workflow reveal*.
- **Proof:** Wireframe-ish mocks with grey placeholder bars; no composed desk destination; no keyboard/signal anatomy.
- **Meta smell:** Subcopy literally says “Product story here. Live markets on /desk.” Path subcopy name-drops “Wager Predict energy.” Judges punish self-aware hackathon copy.

---

## 2. Competitor bar — what judges notice in ~10 seconds

### Prediction-market products

| Site | 10s read | Steal for Brief Command | Do **not** steal on `/` |
| --- | --- | --- | --- |
| **Polymarket** | Live *news terminal*: carousel heat, probability as headline, Breaking News sidebar, volume arrows. Dark, data-dense, Inter, restrained accents. | Desk density language; probability as meaning; scan hierarchy. | Live catalog / trending feed on product-story home. |
| **Kalshi** | Brokerage trust: categories, contract specs, CFTC/regulatory cues, green/black brand discipline. Product *is* the homepage. | Trust through specificity (resolution rules, phases). | KYC/brokerage onboarding theater; regulated-exchange density as marketing filler. |
| **panta.market** | Live Solana PM dashboard (`#0b0d0f`), green trade accents, card grid, Featured/Explore — **sponsor surface**. | Align accent discipline + card anatomy with Panta DNA; “Powered by Panta” must feel native, not sticker. | Cloning their live home onto `/`. |
| **Wager Predict** | As of 2026-09-22: teaser only (“Something’s coming”). Prior pattern (from V1 research): four-step teach path. | Keep the **four-beat teaching path** (already shipped). | Name-dropping them in UI copy. |
| **terminal.pm** | Fetch errored (500); historically: unified books, filters, alerts, keyboard-first desk-as-destination. | Landing promise that *ends* at a workstation. | Claiming multi-venue scope Brief Command doesn’t have. |
| **Auspex** | Best peer for this hackathon. Hero: “The terminal for traders who price the future.” Live slice table + latency/markets/ticks stats. Feature depth (unified book, arb, BP alerts, Kelly, CLV). Proof = live sample + operator vocabulary. | **Destination terminal framing**; live *illustrative* slice; keyboard-first workspace foreshadow; one sharp promise sentence. | Inventing multi-venue arb/CLV features you don’t ship. |

### Fintech / product-story landings

| Site | 10s read | Steal |
| --- | --- | --- |
| **Razorpay Sprint26** | Awwwards-tier scrollytelling: one metaphor (shopper walk), two-color restraint (#0039FF + near-black), **100+ stateful Rive triggers**, products assemble on scroll — not looping particles. | Narrative before novelty; one continuous journey; stateful reveal/assemble; color discipline. |
| **Linear** | `#010102` canvas, one lavender accent, surface ladder, no atmospheric chaos. Product chrome *is* the marketing. | One accent; surface hierarchy; motion 200–420ms opacity/transform only; kill rainbow gradients. |
| **Raycast** | Marketing page = oversized product screenshot; red stripe motif; ⌘ palette chrome at hero scale; mono shortcut chips. | **Show real desk chrome in hero**, not abstract YES/NO toy; keyboard as proof. |
| **Vercel** | Sparse monochrome, Geist, one gradient escape; proof via concrete product frames. | Quiet canvas; one hero product moment. |
| **Stripe (density ref)** | Bento / multi-product tiles; interactive product demos over scrolly fluff. | Progressive density; proof tiles without endless scroll hijack. |

### Pattern synthesis (hackathon-relevant)
1. **Hero promise is one sentence of power**, not a feature list.
2. **Motion explains a state change** (assemble, focus, morph workflow). Looping ornaments lose points.
3. **Proof is product chrome or live-looking sample**, labeled if staged.
4. **CTA hierarchy:** one primary destination + one secondary that teaches the path.
5. **Density climbs:** hero sparse → path structured → destination intentionally rich.
6. **Trust:** sponsor/API honesty, reduction of meta copy, keyboard foreshadow, resolution/attribution language.

---

## 3. Cold-judge score of CURRENT landing (separate from desk)

### Rubric (landing only)

| Criterion | Score | Comment |
| --- | --- | --- |
| Hero promise (clarity + magnetism) | 12/20 | Brand mark strong; thesis soft; meta `/desk` line hurts. |
| Motion quality (narrative vs ornamental) | 14/20 | Framer infrastructure real; particles + looping bar = decoration. Immersion sticky is the best beat. |
| Proof / product fidelity | 11/20 | Illustrative honesty good; grey-bar catalog mock and thin frames undercut “operator desk.” |
| CTA hierarchy | 15/20 | Open desk is clear; secondary = API docs (wrong); wallet competes on story page. |
| Density / pacing | 13/20 | Hero spacing OK; Path + Immersion overlap; no climax desk frame. |
| Trust / brand discipline | 14/20 | Powered by Panta present; rainbow gradient + three glow hues vs Linear/Panta restraint. |
| **Total** | **79 raw → calibrate to 74** | Harsh Colosseum curve: dunk ~5 for meta copy + wireframe mocks vs podium bar. |

**Honest landing score now: 74/100.**  
Pass-5 static landing was ~legible/not magnetic (~60). Immersive pass is a real jump. Still not “best-in-show” until promise + fidelity + narrative motion land.

### What would make 95+
1. One decisive hero line a judge can quote.
2. Hero visual = staged *composed desk scene* (brief + tape + ticket), not a floating dual bar.
3. Single scroll narrative (merge Path + Immersion) where mocks **assemble statefully** per beat.
4. High-fidelity mocks matching real `/desk` chrome (or a frozen export), still labeled Illustrative.
5. Proof strip: ⌘K / j·k / Enter · signal anatomy · attribution ledger teaser.
6. Accent discipline: cyan primary + emerald/rose only for YES/NO meaning (Linear/Panta rule).
7. Zero meta/hackathon copy; secondary CTA = “See how it works” (scroll/hash to path).
8. Final section = dense desk destination frame, then “Enter the desk.”

---

## 4. Keep vs pivot (opinion)

**Keep the immersive scroll direction.** The user already rejected earlier taste; `69eb6dd` correctly moved toward Sprint26/Wager-path energy. The scaffold (Hero → Path → Morph → Enter) matches how Colosseum judges *feel* craft in under a minute. Pivoting now to (a) Polymarket live-home, (b) minimal Linear static, or (c) another greenfield aesthetic burns the only recent taste win and wastes framer investment.

What must change inside the keep: treat motion as **workflow cinema**, not particle wallpaper; treat mocks as **real product photography**; treat copy as **operator thesis**, not build log. That is iteration, not pivot.

---

## 5. Top 5 gaps (ranked by judge impact) + concrete fixes

### Gap 1 — Hero promise is category soup (highest impact)
**Symptom:** “The operator desk for Solana prediction markets — intel, AI briefs, primary executes, and book claims. Product story here. Live markets on /desk.”  
**Why it hurts:** 10s test fails; sounds like a README. Meta `/desk` line is developer-facing.

**Fix (copy):**
- H1 stays **Brief / Command** (gradient only on *Command*, or kill gradient → solid white + cyan underline).
- Subhead → one line, e.g. **“Turn a market into intel, a brief, a primary buy, and a claimable book — one operator path on Panta.”**
- Kill “Product story here…” entirely.
- Eyebrow chip: `Powered by Panta` only (already there).

**Fix (visual):** Replace `FloatingDualBars` as hero centerpiece with a single **composed desk snapshot** (`MockFrame` titled `desk · composed` showing brief strip + YES/NO + 3 tape rows + sticky ticket chrome). Keep dual bar as a small secondary flourish under CTAs if needed.

**Fix (CTA):** Primary `Open desk →`. Secondary `See how it works` → `#path` (smooth scroll). Move API docs to footer/nav only.

---

### Gap 2 — Mock fidelity too low (wireframe vs Raycast “chrome is the product”)
**Symptom:** Catalog chrome shows grey placeholder bars; brief/ticket/book are thin schematic panels. Screenshots read as concept art, not a shipped terminal.

**Fix:**
- Rebuild mocks from real desk components’ *layout tokens* (row height, ProbBar, PhaseBadge, HotTape quiet state, PrimaryBuy step list) with **hardcoded illustrative content** (never live API on `/`).
- Catalog mock: 3 real-looking market titles (crypto/politics/sports), phase pills, mirrored YES/NO micros, volume/ends — still `ILLUSTRATIVE`.
- Brief mock: real markdown-ish lines + Bull/Neutral/Bear tone chips (match `AiBrief`).
- Ticket mock: Quote→…→Attribute checklist with one filled step glowing cyan (stateful, not static list).
- Book mock: 2 attributed fill rows + one claimable win row.
- Optional: one full-bleed **destination** frame before Final CTA — denser than path mocks (Stripe/Raycast proof move).

---

### Gap 3 — Motion is ornamental; Path and Immersion duplicate
**Symptom:** 28 floating particles, cursor glow, infinitely looping YES width; Path teaches four beats then Immersion re-teaches four panels. Razorpay bar = *stateful assemble*.

**Fix:**
- **Delete or heavily thin** `ParticleField` and `CursorGlow` (keep scroll progress + magnetic CTA).
- Dual-bar: animate **once on enter** to resting 58/42; no infinite loop (or loop only on hover).
- **Merge Path + Immersion into one sticky scrolly section:** left = step list (01–04); right = single mock stage that **morphs** (shared layout animation) Intel→Brief→Execute→Book. Remove the second 220vh runway or keep one runway only.
- Per-beat motion: catalog rows stagger in; brief lines type/fade; ticket steps check off; book ledger rows slide — each tied to scroll progress ranges, not `whileInView` once + separate sticky.

---

### Gap 4 — No proof / trust layer (Auspex gap)
**Symptom:** No stats strip, no keyboard foreshadow in body, no signal anatomy, no attribution proof. Auspex opens with markets·venues·ticks·latency.

**Fix (add a thin proof band under hero or after path):**
- Chips: `⌘K command` · `j / k scan` · `Primary Quote→Attribute` · `Illustrative only on /` · `Live on /desk`.
- Mini “signal anatomy” row: `Question → Odds/tape → Brief → Execute → Book` with hairline connectors (static SVG, cyan active node).
- One sentence trust: “Wallet signs once. Server proxy keeps the Panta API key dark. Attribution posts when the fill lands.”
- Do **not** invent fake volume/trader counts.

---

### Gap 5 — Accent / density / CTA discipline
**Symptom:** Emerald + cyan + rose atmospheric blurs + rainbow wordmark = crypto-generic. Final CTA is strong but arrival lacks dense product climax. Header Wallet on story page competes with “Open desk.”

**Fix:**
- Canvas `#0a0a0b` keep. **One brand accent:** cyan `#22d3ee`. Emerald/rose **only** for YES/NO meaning (ProbBar / outcome buttons).
- Wordmark: white “Brief” + cyan “Command” (or white + subtle cyan underline) — drop three-stop gradient.
- Progressive density: hero sparse → path medium → **pre-CTA desk frame dense** → final CTA sparse again.
- Landing Shell: prefer single primary `Open desk`; demote Wallet to desk/execute (or ghost outline). Secondary in hero = See how it works, not Docs.

---

## 6. Competitors that matter most for *this* hackathon

**Ranked for Colosseum / Panta Earn judges:**

1. **Auspex** — closest “terminal as product” narrative; proof via live slice + operator lexicon.  
2. **Razorpay Sprint26** — craft ceiling for scroll narrative (stateful, restrained, memorable).  
3. **Raycast / Linear** — taste judges already have internalized; real chrome > brochure.  
4. **panta.market** — sponsor alignment; green/dark card language; don’t fight the host aesthetic.  
5. **Polymarket / Kalshi** — vocabulary for *desk* density and trust, **not** for `/` layout.  
6. **Wager Predict / terminal.pm** — conceptual (path teaching / desk destination); Wager currently teaser-only; terminal.pm unstable at fetch time.

Ignore for landing: generic Web3 “glassmorphism + token ticker” templates.

---

## 7. Is desk still the bigger risk?

**Yes.** Landing at 74 can be pushed to ~95 with the fixes above. The desk PNG still shows:

- Many ID/truncated titles (`sports - AESrMo…`)
- `0 USDC` volume column
- Empty `···` probabilities on rows
- Hot tape: “Tape quiet…”

A judge who loves the landing and then opens `/desk` experiences **promise collapse**. That hurts overall entry score more than another 8 points of landing polish.

**Implication for sequencing:**  
- Landing: implement Top-5 gaps (especially 1–3) for wow + shareability.  
- Parallel / higher priority for podium: desk title hydration reliability, primary-first rows with real prices when API has them, attributed trades surface when fills exist, tape/hot-rail not dead-looking, connected-wallet screenshot for judges.

Landing sells the movie trailer. Desk is the film. Trailer can be gorgeous; if the film is cold, you don’t win best-in-show.

---

## 8. Implementation checklist (landing only — for next pass)

- [ ] Rewrite hero subhead; remove meta `/desk` sentence and Wager Predict name-drop  
- [ ] Secondary CTA → See how it works (`#path`)  
- [ ] Composed desk mock replaces dual-bar as hero centerpiece  
- [ ] High-fidelity illustrative mocks (catalog/brief/ticket/book)  
- [ ] Merge Path + Immersion into one sticky morph narrative  
- [ ] Kill/thin particles + cursor glow; one-shot bar animation  
- [ ] Proof chip strip + signal anatomy  
- [ ] Accent discipline (cyan brand; YES/NO only dual chroma)  
- [ ] Dense destination frame before final CTA  
- [ ] Re-capture `landing-immersive-*.png` after changes  
- [ ] Reduced-motion: still fully readable; no meaning only in scroll scrub  

---

## 9. Score summary for parent agent

| Question | Answer |
| --- | --- |
| Score now | **74/100** (landing only) |
| 95+ requires | Decisive promise + real desk chrome mocks + stateful single narrative + proof strip + accent/CTA discipline |
| Keep vs pivot | **Keep immersive**; escalate fidelity & narrative, don’t re-skin |
| Top gaps | (1) Hero copy/visual (2) Mock fidelity (3) Ornamental→stateful motion / merge sections (4) Proof strip (5) Accent/density/CTA |
| Competitors that matter | Auspex, Sprint26, Raycast/Linear, panta.market; Polymarket/Kalshi for desk vocab only |
| Desk bigger risk? | **Yes** — cold catalog + quiet tape still outranks landing polish for podium |



---

## Shipped note

**2026-09-22:** Top-5 gaps implemented in landing Top-5 polish pass. See `LANDING_PASS.md`.
