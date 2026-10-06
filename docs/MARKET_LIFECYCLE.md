# Market lifecycle: one market, one identity, from discovery to verification

This doc was written before any Stage D code (audit first), then updated once the
code landed. It maps every place a Panta market shows up in this app, lists the
shapes that duplicate or conflict, and sets the rules that keep **one** market
coherent across Discover → Inspect → Quote → Trade → Confirm → Verify →
Position → Activity, including a market created on `/create`.

Panta and Solana stay authoritative throughout. Nothing here creates rows,
prices, positions or verification states that the APIs didn't return.

---

## 1. Audit (before Stage D)

### 1.1 The representations we found

| Concept | Where it lives | Shape |
|---|---|---|
| Catalog market | `/api/catalog` → `catalog-server.ts` → `CatalogPayload.items: Market[]` | REST list ∪ on-chain `Event` accounts ∪ detail records, merged by `mergeCatalog` / `withDetail` / `resolveAuthoritativeMarket` |
| Market detail | `fetchMarket` (`GET /markets/{id}/`) → `parseMarket` → `Market`; `useMarket` merges catalog row + raw detail with `selectMergedMarket` | `Market` (`domain.ts`) |
| Panta market id | `Market.marketId`, `Position.marketId`, `Trade.marketId`, `AccountTrade.marketId`, `Quote.marketId`, `PrimaryBuild.marketId`, decoded order `verified.marketId`, `RegisterReceipt.marketId`, create `expectedEventPda` | base58 string |
| Event / market PDA | `chain-events.ts` (`ChainEvent.marketId` = Event account address); create quote `eventPda`; registration enforces `marketId === expectedEventPda` | base58 string, **the same value as the Panta market id** |
| Route | `/markets/[...marketId]` (segments joined, decoded) | built in 17 places, some with `encodeURIComponent`, some raw |
| YES/NO price | `Market.yesPrice/noPrice` (probability-scale strings), `primaryYesPrice/primaryNoPrice`, `secondaryYesPrice/secondaryNoPrice` (1e9-scaled, independent per side) | interpreted only by `prices.ts` (`marketProbability`, `secondaryLastObservedPrices`) |
| Liquidity / volume | `volumeUsdc`, `totalVolumeUsdc` (+ base); `catalogVolume()` in `format.ts` | strings, null when absent |
| Status / phase | `Market.phase`, `Market.status`, `Market.resolved`, `endTime`, `primaryPhaseEndTime` | raw strings + `marketLifecycle()` → `open/trading/unknown/ended/resolved/cancelled` |
| Resolution / outcome | `Market.resolved`; before Stage D the outcome was **not modelled** on `Market` (detail and the on-chain Event carry `yesWins`); `Position.outcome` | — |
| Quote | `requestQuote` → `Quote` (`orders.ts`) | human decimal strings |
| Trade (tape) | `fetchMarketTrades` → `TapePage.trades: Trade[]` | per-market, includes `wallet` + `signature` |
| Position | `fetchPositions` → `Position[]` (`positions.ts`) | human `shares`, Panta valuation fields |
| Activity | `fetchAccountTrades` → `AccountTrade[]` (attribution ledger, all wallets of this app) | `status` = Panta attribution status |
| Signature | ticket state in `PrimaryBuyPanel` (`signature`), tape rows, ledger rows, create receipt | base58 |
| Verification state | `PrimaryBuyPanel` `verifyPhase` from `POST /primaryorderverify/` polling | `idle/polling/confirmed/failed/timeout` |
| Created-market state | `CreateMarketWorkspace` component state (`receipt`, `indexing`) + durable recovery record (`create-recovery.ts`, cleared on registration success) | — |

### 1.2 Duplicate or incompatible shapes

1. **Header status vs lifecycle.** The detail header used `PhaseBadge(market.phase)`, the raw
   phase. The catalog, sidebar and positions use `marketLifecycle()`. A primary market whose
   buy window had closed read "Primary" in the header and "Closed · awaiting result" in the catalog.
2. **Route construction.** `/markets/${id}` was built by hand in 17 places, some encoded and
   some not. Base58 ids encode to themselves, so links worked, but there was no single helper.
3. **Outcome.** A resolved market carried `resolved: true` with no outcome. The UI showed the
   post-resolution 0/1 prices as if they were probabilities.
4. **Attribution vs verification.** The Activity table labelled every attribution-ledger row
   **"Verified"**. The ledger proves attribution, not Panta order verification.
5. **Ticket terminal state.** `deriveTradeState` returned `attributed` ("Verified and
   attributed") when attribution succeeded even if Panta verification had **timed out**, and its
   copy claimed "Your position shows in your Book" before positions were refetched.
6. **Per-market "my activity".** Nothing combined the three sources of a user's actions on a
   market: the tape (`wallet` + `signature`), the ledger (attribution status) and the
   in-session ticket (confirmation + Panta verification).

### 1.3 The ten questions

1. **Canonical Panta market id.** `marketId` (base58 32–44 chars), which is also the Event PDA.
   It is the key for catalog rows, `qk.market`, `qk.trades`, routes, quotes, builds, the decoded
   order, positions, the tape and the ledger. Registration already refuses a `marketId` that
   differs from the quoted `expectedEventPda`.
2. **Fields from Panta (REST).** Title/question, category, description, resolutionRule, images,
   phase, status, resolved, marketType, start/end/resolution time, region, volumes, all price
   fields, creator, oracle, primaryPhaseEndTime, `yesWins` (detail), positions (shares, outcome,
   claimable/claimed, valuation), tape trades, ledger rows, quotes, builds, order verify status.
3. **Fields from Solana.** Event accounts via `getProgramAccounts` (catalog: question, end time,
   lifecycle flags, curve price stored only as `primary*`), the decoded transaction (pre-sign
   checks), the vault authority owner check, signature confirmation, USDC balance.
4. **Locally derived.** `marketLifecycle` (from phase/status/resolved/end/primary window),
   `marketProbability` (only when YES+NO are valid probabilities summing to 1 ± 0.02),
   `secondaryLastObservedPrices`, completeness/partial flags, position marks (`bookMark`), trade
   ticket state, and (new) `marketState` plus per-market activity rows.
5. **Duplicated across adapters/components.** The status label (fixed in §1.2.1), route strings
   (fixed in §1.2.2), and Solscan URL strings (left as they were: identical everywhere).
6. **Where stale or conflicting state can appear.**
   - The CDN-cached catalog (120 s) lags detail.
   - The detail can be partial or priceless, in which case the list lifecycle is kept.
   - Positions and tape lag a confirmed trade (Panta indexing).
   - The ledger lags a report.
   - A freshly created market can be registered but not yet in the catalog.
7. **How a successful trade refreshed position/activity.** Before Stage D it didn't. The ticket
   only invalidated `["accountTrades"]` after attribution. Market, tape, positions and USDC
   balance stayed cached until their staleTime ran out.
8. **How /create refreshes the catalog after registration.** `invalidateAfterCreate(marketId)`
   invalidates catalog, `market(id)`, positions, usdc and accountTrades, then `checkIndexedFor`
   calls `fetchMarket` once and shows "Created successfully · waiting for Panta indexing" if
   Panta doesn't return it.
9. **When indexing lags.** Before Stage D, `/markets/{id}` showed "Couldn't load this market"
   (`MARKET_NOT_FOUND`), the same treatment as an API failure. The receipt was lost when the
   user left `/create`.
10. **Unresolved / closed / resolved.**
    - `marketLifecycle`: `open` (primary window open), `trading` (secondary), `ended` ("Closed ·
      awaiting result": end time passed or the primary window closed), `resolved` (explicit
      `resolved` / phase / status only, never from expiry), `cancelled`, `unknown`.
    - Resolution is one-way in `mergeMarket`.

### 1.4 Preserved as-is

`mergeMarket`, `resolveAuthoritativeMarket`, `selectMergedMarket`, `keepListLifecycle`, one-way
resolution, "secondary prices are independent USDC values, not probabilities", and the primary
vs secondary phase distinction. Create V1 and the trade execution path are unchanged, except for
the integration hooks listed in §6.

---

## 2. Canonical market

`Market` (`src/lib/panta/domain.ts`) stays the single internal model. Stage D adds one Panta
field and one derived view. There is no parallel model.

- **`Market.outcome?: "yes" | "no"`.** Taken from the detail's `yesWins` only when
  `resolved === true`, or from the on-chain Event's `yesWins` only when `isResolved`. It is never
  inferred from prices or expiry. `mergeMarket` carries it through, detail first.
- **Resolved prices** are labelled "Settlement · Panta's final prices after resolution", not a
  live probability.
- **`marketState(input)`** in `src/lib/panta/lifecycle.ts`. A pure view over
  `{ market, error, notFound, quoteError, createdEvidence, registrationNeedsAttention }` that
  returns one `MarketState` (§3).
- **Identity:** `canonicalMarketId(raw)` (base58 check) and `marketHref(id)`. Every market link
  in the app goes through `marketHref`.

Unknown is never zero:

- Missing prices give `marketProbability(...)` with `yes`/`no` null and a `reason`, and the UI shows "—".
- A missing position (query failed) shows "Position data unavailable". An empty position list
  (query succeeded) shows "No position on this market".
- Missing shares on a tape row stay `null`.

## 3. Lifecycle states

| State | Evidence | Tradable here |
|---|---|---|
| `active` (primary) | `marketLifecycle === "open"` | yes (primary buy) |
| `active` (secondary) | `marketLifecycle === "trading"` | no, trade on panta.market |
| `quote_unavailable` | active primary market, and the last quote returned `PANTA_PRICING_UNAVAILABLE` | not right now (temporary) |
| `closed` | `ended` (end time or primary window passed, not resolved) | no |
| `resolved` | explicit `resolved` / phase / status; outcome from `yesWins` when present | no (claims in Book) |
| `cancelled` | phase/status cancelled | no |
| `unknown` | Panta returned a phase we don't recognise | no |
| `awaiting_indexing` | a local registration receipt (`marketId` returned by `POST /markets/register` and checked against the quoted Event PDA), and Panta doesn't return the market yet | no |
| `registration_needs_attention` | a create recovery record for this Event PDA in `confirmed` / `registration_needs_attention`, and Panta has no record | no, finish on `/create` |
| `unavailable` · `not_found` | Panta returned no record and there's no create evidence | no |
| `unavailable` · `api_error` | the detail/catalog fetch failed | no (unknown, never "closed") |

Rules: expiry alone never gives `resolved`. An API failure never gives `closed` or `resolved`.
A quote failure never gives "0 %". Once Panta returns the market, its record wins over any local
evidence: `awaiting_indexing` turns into the normal lifecycle, and the local receipt is pruned.

## 4. Refresh and invalidation rules

| Event | Invalidate (refetch now) | Mark stale only | Bounded follow-up |
|---|---|---|---|
| Trade **confirmed on-chain** (`confirmSignature` → confirmed) | `market(id)`, `trades(id)`, `positions(wallet)`, `usdc(wallet)`, `["accountTrades"]` | `catalog()` | up to 4 refetches of `positions(wallet)` + `trades(id)` at 2.5 s / 5 s / 10 s / 20 s, stopping as soon as the position reflects the trade |
| Trade verified by Panta (`/primaryorderverify/` confirmed) | session record updated, no extra fetch | — | the running follow-up continues |
| Trade failed / expired / uncertain / rejected | **nothing** (no optimistic mutation) | — | — |
| Attribution report / ledger hit | `["accountTrades"]` (existing) | — | existing ledger poll |
| Create **registered** | existing `invalidateAfterCreate` (catalog, market(id), positions, usdc, accountTrades) + receipt remembered | — | none: manual "Check again" |
| Manual refresh | the query behind the button | — | — |

Guarantees:

- One follow-up loop per signature (single-flight), at most 4 attempts.
- No polling after the loop ends, no full reloads, no hidden optimistic state.
- The catalog is never force-refetched by a trade, which keeps Panta read load low.

## 5. Trade → position reconciliation

1. Before invalidating, the reconciler snapshots the cached shares for `(marketId, side)`. This
   is the *baseline*: known or unknown.
2. The position counts as *reflected* when the refetched `/positions/` row for that market and
   side exists, and:
   - its shares differ from a known baseline, or
   - the baseline was unknown and Panta's tape already lists the signature.
3. Until then the detail page shows the trade as confirmed (and verified, if Panta verified it),
   and the position as **"Refresh pending · Panta hasn't indexed this trade yet"**. The quoted
   shares never replace Panta's.
4. After 4 attempts the state becomes **stale**, with a manual refresh. No loop continues.

## 6. Trade execution integration (what changed in the execution path)

`PrimaryBuyPanel.tsx` keeps its Quote → Build → checkBuild → vault check → Sign → Broadcast →
Confirm → Submit → Verify → Report pipeline byte-for-byte. Stage D adds calls that run
**after** a step has completed and never throw into the flow:

- After `confirmSignature` returns `confirmed`: `reconciler.onConfirmed(...)`, with the
  expected market, side and amount taken from the **decoded transaction** (`checkBuild` →
  `verified`).
- After `/primaryorderverify/` settles: `reconciler.onVerify(signature, phase, status)`.

`trade-state.ts`: an attribution success no longer reads as "Verified" while Panta verification
is still pending. That case gets its own state, `attributed_unverified`, and a verify failure
stays `verify_failed`.

## 7. Activity and verification

`buildMarketActivity` (`src/lib/panta/market-activity.ts`) merges, by signature, for one
market and one wallet:

- **Tape row** (Panta-indexed on-chain trade). The only source of authoritative shares.
  Means "confirmed on-chain · indexed by Panta".
- **Ledger row** (`/account/trades/`). Attribution status ("Attributed" when `processed`).
- **Session record** (this tab only, in memory). Confirmation, and Panta order verification.

Verification labels:

- `verified` only when Panta's `/primaryorderverify/` returned a success status for this
  signature, **and** no tape or ledger row for it contradicts the expected market, side or
  wallet.
- `mismatch` when a row contradicts the expected market, side or wallet.
- `not_checked` for historic trades (no order id in this session).
- Plain RPC confirmation is never labelled verified.

## 8. Created markets

| Case | Behaviour |
|---|---|
| Indexed immediately | `/create` success shows "Open market". `/markets/{id}` is the normal detail page with trading |
| Registered, not indexed | The receipt (`marketId`, signature, question) is remembered locally. The catalog shows "Created successfully · waiting for Panta indexing" with the id. `/markets/{id}` shows the same with "Check again". There's no fabricated Market. When Panta returns it, the normal lifecycle takes over and the receipt is pruned |
| Confirmed, registration needs attention | The existing recovery on `/create` handles it. `/markets/{pda}` and the catalog show "Registration needs attention" and never a trading panel, until Panta has a record |
