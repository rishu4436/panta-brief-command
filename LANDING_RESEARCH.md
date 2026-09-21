# Brief Command landing research

**Scope:** product-first landing page for Brief Command. The home route (`/`) sells the operating model and the destination; it does **not** behave like a live market catalog.

## Reference set

- [Razorpay Sprint26](https://razorpay.com/sprint/26) — a scroll-led narrative that turns a large product story into one journey. Take the restrained palette, generous quiet space, and Rive-like stateful micro-interactions: reveal, assemble, and respond to intent instead of looping decoration. The [One Page Love review](https://onepagelove.com/razorpay-sprint-2026) is useful context for the scroll/3D treatment.
- [Wager Predict](https://wagerpredict.com/) — a clear four-step scroll path: pick a question, take a side, watch the move, resolve. Borrow the sequential teaching pattern, not the live-market merchandising.
- [Prediction Royale](https://tommycallen.com/projects/40) — dark fintech PM UI: mirrored outcomes, probability bars, liquidity/context, search, and dense cards. Use as a visual vocabulary for the product preview and the eventual desk, not as the home-page payload.
- [beUI Prediction Market](https://beui.dev/components/blocks/prediction-market) — motion cards with outcome CTAs, rolling odds, bookmarks, sparklines, and a trade ticket. Borrow card choreography and hierarchy; keep values clearly illustrative on `/`.
- [terminal.pm](https://terminal.pm/) and [Auspex](https://www.auspexterminal.com/) — the desk as destination: unified books, filters, alerts, keyboard-first navigation, and adjustable density. These justify a landing promise that ends at a serious workspace rather than an endless feed.

## What to translate into Brief Command

### 1. Hero: make the command model legible

- Lead with a decisive statement: Brief Command turns uncertain questions into monitored, explainable decisions.
- Show one composed product scene (brief → evidence → signal → action), not a wall of markets.
- Primary CTA: **Enter the desk**. Secondary CTA: **See how it works**.
- A small, static “desk snapshot” may establish texture, but must be labeled **Illustrative interface** and never imply current prices, volume, or outcomes.

### 2. Scroll narrative: four product beats

1. **Frame** — define a question, brief, or watch condition.
2. **Ground** — attach sources, assumptions, and the resolution rule.
3. **Command** — compare scenarios, confidence, and next actions in one view.
4. **Resolve** — return to the desk for monitoring, audit trail, and accountable follow-through.

Each beat gets one sentence, one visual state, and one interaction. The scroll should feel like moving through a workflow, not browsing inventory.

### 3. Proof: show the system underneath

- Source traceability, decision history, and explicit uncertainty are the proof points.
- Use a restrained “signal anatomy” diagram: question → evidence → interpretation → command.
- Include a compact keyboard/shortcut hint and density cue to foreshadow the desk destination.

### 4. Destination: the Brief Command desk

- Close with a calm, dense product frame: briefs, watch conditions, evidence, and actions sharing one workspace.
- Keep the desk preview static or staged; live data belongs after entry, in the product.
- CTA copy should set expectation: **Open the workspace**, not “trade now” or “browse markets.”

## Motion principles

- **Narrative before novelty:** every transition explains a workflow step or relationship.
- **Stateful, not ornamental:** prefer reveal, assemble, focus, pin, and compare states over perpetual loops.
- **Scroll as pacing:** scrub gently, with clear resting states and no hijacking of the user’s scroll.
- **Calm canvas, sharp signal:** keep backgrounds and surrounding composition quiet so one state change reads immediately.
- **Card choreography:** let an illustrative card expand, expose rationale, or reconcile two outcomes; do not make numbers race for attention.
- **Progressive density:** hero is spacious; proof becomes structured; the final desk is intentionally information-rich.
- **Fast and resilient:** motion must degrade to a readable static composition when assets, GPU, or network conditions are limited.
- **Accessibility:** honor `prefers-reduced-motion`; replace parallax/scrubbing with instant or short opacity/transform transitions, preserve focus order, and never hide meaning in motion.

## Do-nots / guardrails

- Do **not** put a live market catalog, trending feed, live order book, or real-time leaderboard on `/`.
- Do **not** show fake live odds, volume, timestamps, trader counts, or “today” language without a visible **Illustrative** label.
- Do **not** make illustrative values look connected to a venue or current market; use neutral sample questions and obvious staging.
- Do **not** copy trading urgency, leverage cues, flashing deltas, or gamified win language into the product introduction.
- Do **not** turn the landing page into a dashboard tour with tiny unreadable UI; reserve density for the destination preview.
- Do **not** require scroll to discover the product promise, CTA, or accessibility controls.
- Do **not** autoplay audio, trap keyboard focus, or make motion the only way to understand the four beats.
