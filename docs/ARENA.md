# Forecasting Arena: scoring, finalization and reputation

The arena scores the free community forecasts made in Prediction Rooms
(docs/PREDICTION_ROOMS.md) and turns them into a public, accuracy-only
reputation. It has no money in it: no rewards, no trading PnL and no win rate.
Scores exist only for markets whose outcome was **verified**, and once written
they never change.

## 1. Score formula and rounding

For a forecast `p` (YES probability) and verified outcome `o` (YES = 1, NO = 0):

    Brier loss  = (p − o)²            (0 = perfect, 1 = maximally wrong)
    score       = 100 × (1 − loss)    (shown with 2 decimals; higher is better)

Everything is integer fixed point, identical in both storage adapters
(`src/lib/arena/scoring.ts`):

| quantity | unit | computation |
|---|---|---|
| probability | basis points `bps` ∈ [0, 10000] (integer, as stored) | |
| `diffBps` | bps | `|bps − (o ? 10000 : 0)|` |
| `brierE8` | 1e-8 | `diffBps²`, which is exact and lies in [0, 100 000 000] |
| `displayScoreC` | hundredths | `roundHalfUp((1e8 − brierE8) / 1e4)` (BigInt) |
| mean Brier | 1e-8 | `roundHalfUp(ΣbrierE8 / n)`, shown with 4 decimals, half-up |

Examples: 80% → YES: diff 2000, brierE8 4 000 000, score **96.00**; NO: diff
8000, brierE8 64 000 000, score **36.00**. 50% always scores 75.00. 100% on the
winning side scores 100.00, and on the losing side 0.00. Rounding is half-up on
exact integers, so there is no float drift: 99.9975 → 100.00 and 99.9775 → 99.98.

## 2. Which forecast is scored (the cutoff)

- **Cutoff** = the earliest `endTime` / `primaryPhaseEndTime` reported by
  either source. A `primaryPhaseEndTime` is required. It is the same rule the
  forecast window uses (forecasting closes at the primary phase end), so no
  forecast should exist after it. The scorer checks anyway.
- Each wallet's **final revision with `createdAt` strictly before the cutoff**
  (server time, unix ms) is scored. Revisions at or after the cutoff are
  ignored, and an earlier revision never counts if a later pre-cutoff one exists.
- **No eligible forecast means no score.** Nothing is imputed.

## 3. Verified resolution (two sources)

`gatherResolutionEvidence` (`src/lib/arena/evidence-server.ts`) reads both
sources fresh, with no caches:

1. **Panta's market record**: `GET /markets/{id}/`, 8 s timeout, retries at
   400 ms and 900 ms for partial records. It is used only if it is a full record
   with `resolved === true` and an explicit winning side (`yesWins` → outcome).
2. **The on-chain `Event` account**: `getAccountInfo` at `confirmed`
   commitment. The owner must be the Panta program `6gM5afTQ…`, and the 8-byte
   discriminator is checked. It supplies `is_resolved`, `is_cancelled` and
   `yes_wins`, plus the context **slot**.

`decideResolution` (`src/lib/arena/evidence.ts`, pure):

| situation | result | persisted? |
|---|---|---|
| either source cancelled | `cancelled` | no (nothing is ever scored) |
| a source unreadable / not found / partial | `missing_evidence` | no (retry later) |
| neither source resolved | `not_resolved` | no |
| only one source resolved (or no winning side) | `missing_evidence` | no |
| both final, **different** sides | `blocked` | **yes**: a blocked finalization with no scores |
| both final, same side, no cutoff | `missing_evidence` | no |
| both final, same side | `resolved` | **yes**: finalization + scores |

An outcome is never inferred from prices (a 100% price is not resolution),
expiry, timestamps or AI.

**Provenance** is stored with every finalization: for each source its
status, resolved flag, outcome, timestamps and `fetchedAt`, plus the chain
account, program owner and slot, and `decidedAt`. It is shown (slot and
time) on the room leaderboard.

## 4. Finalization service and trigger

`finalizeMarket` (`src/lib/arena/finalize.ts`) is the **only** code that
creates scores. The unit is a market, so all rooms on it are finalized together
and global de-duplication is deterministic.

1. If a finalization already exists, it is returned (`already_finalized`) with
   **no evidence fetch and no rescoring**.
2. Evidence is gathered and a decision made. Only `resolved` and `blocked` write.
3. On `resolved`, the service re-snapshots every room on the market (full
   revision history), computes the room scores and global scores, and commits
   everything in **one atomic step**. A concurrent run gets `exists` and
   reports `already_finalized`.

Before writing, each adapter re-verifies every score against the stored
revision (revision, bps, createdAt, forecastId) and that the room belongs to the
market. A forged or inconsistent score aborts the whole commit
(`FinalizationIntegrityError`, HTTP 500 `ARENA_INTEGRITY_CHECK_FAILED`).

**Trigger.** Finalization is triggered explicitly; it is never run by a page
load or a polling loop:

- `POST /api/arena/finalize` with header `Authorization: Bearer $ROOMS_ADMIN_TOKEN`
  and body `{"marketId": "…"}`, `{"roomSlug": "…"}` or `{"pending": true, "limit": 1..10}`.
  The schema is strict, so a body carrying an outcome, score or other field is
  rejected with 400. Every attempt is IP rate-limited (20/min) before the token
  check, and valid calls are limited to 10/min. Responses are `no-store`.
- `npm run arena:finalize -- --market <id> | --room <slug> | --pending [--limit N] [--url http://localhost:3100]`
  is a thin client for that endpoint. The service runs inside the app with the
  configured store. The token is read from the environment only and never printed.

**Admin token** (`ROOMS_ADMIN_TOKEN`): server-only, at least 32 random characters
(`openssl rand -hex 32`). If it is unset or shorter, the endpoint answers 503
`ARENA_ADMIN_UNCONFIGURED` (it fails closed). A wrong or missing token gets 401.
The comparison uses SHA-256 digests with `timingSafeEqual` (constant time). The
token is accepted only in a header, never in a cookie, so it can't be ridden
cross-site. Never expose it as `NEXT_PUBLIC_*`.

## 5. Records and global de-duplication

- **Room score**: immutable and unique per `(roomId, wallet)`. It records the
  scored revision, bps, its time, the wallet's first forecast time in that room,
  the outcome, `brierE8`, `displayScoreC` and `finalizedAt`.
- **Global score**: one per `(wallet, marketId)`. It is the room score from the
  wallet's **earliest room participation** on that market (earliest
  revision-1 `createdAt`; ties go to the lower `roomId`). That room's own final
  pre-cutoff revision is used. Forecasting the same market in several rooms
  therefore counts once toward reputation, while each room's leaderboard still
  shows its own score.

## 6. Reputation and ranking

Each wallet has a maintained aggregate: `scoredCount`, `ΣbrierE8`,
`firstScoredAt` and `lastScoredAt`. It is updated in the same atomic step as
the scores and is never decreased or deleted.

- Mean Brier = Σ / n. Average score = `roundHalfUp((n·1e8 − Σ) / (n·1e4))`.
- **Adjusted score** (used for ranking) shrinks small samples toward a prior of
  75.00 with weight 5: `roundHalfUp((n·1e8 − Σ + 7500·5·1e4) / ((n+5)·1e4))`.
  One perfect market therefore gives 79.17, not 100.
- **Ranked** requires at least 5 scored markets. Below that the wallet is
  **Provisional** (listed separately, with no rank).
- Order: higher adjusted score, then more scored markets, then lower mean
  Brier, then earlier first score, then wallet (byte order). This is encoded as
  one lexicographic `rankKey`, used identically by SQLite `ORDER BY` and the
  Redis ZSET (score 0, lex order).
- Categories are not shown. Panta's category labels are not reliable enough to
  split reputation by.

## 7. Storage (no full scans)

**SQLite** (migration v3, `src/lib/rooms/store/sqlite-arena.ts`):
`market_finalizations` (PK market), `forecast_scores` (UNIQUE room+wallet,
FK to the scored `forecast_revisions` row), `global_scores` (PK wallet+market,
FK to the score) and `reputation` (indexed on `ranked, rank_key`). Triggers
reject UPDATE/DELETE on finalizations, scores and global scores, and reject any
reputation change that lowers the count or deletes a row. Rank queries use the
index, and pending counts use the `forecasts(wallet)` index.

**Redis** (`src/lib/rooms/store/redis-arena.ts`, one `{arena}` hash tag): hashes
`final`, `score`, `global` and `rep`. ZSETs `rank:ranked` and
`rank:provisional` (lex), `rscore:<room>`, `wglobal:<wallet>`,
`wrooms:<wallet>`, `mrooms:<market>` and `markets`. There is also a SET
`pending:<wallet>`. `FINALIZE_SCRIPT` (Lua) writes everything atomically only if
the market has no finalization and the reputations are unchanged (optimistic
retry ×5). It refuses existing score fields. Participation indexes are written
**before** each forecast (`PARTICIPATION_SCRIPT`), so a stored forecast is always
reachable by finalization. If indexing fails, the forecast is not saved.

## 8. Public surfaces

- `/arena` (`GET /api/arena?tier=ranked|provisional&limit≤50&offset`) shows
  the ranked and provisional lists and the methodology.
- `/rooms/[slug]` → **Room leaderboard** (`GET /api/rooms/[slug]/leaderboard`).
  Before finalization it shows "Forecasting competition in progress — scores
  available after verified resolution." with the pending forecasts (unranked,
  no outcome). After finalization it shows the room's scores ranked by Brier
  loss. A blocked market is shown as blocked, with no scores.
- `/forecasters/[wallet]` (`GET /api/forecasters/[wallet]`) validates the
  base58 32-byte key. It shows the reputation, rank or provisional status,
  pending markets, an accuracy sparkline, the global scored markets, and for
  each room the current forecast, its revision history and the finalized room
  score (and whether it counts globally). Unlisted rooms are shown without their
  link or title.

## 9. Abuse resistance and limits

- Clients cannot supply outcomes, scores or wallets. Finalization takes only an
  id (strict schema), and evidence comes from the two sources.
- Finalized records are immutable at the storage level (SQLite triggers, and the
  Lua script refuses existing records), and a retry never rescores.
- **No Sybil resistance is claimed.** Wallets are pseudonymous and one person
  can use many. The minimum sample and shrinkage only stop a short lucky streak
  from topping the table.
- A **blocked** market is terminal. Reconciliation (an admin override with an
  audit record) is not built.
- The Redis scripts have been run in a real Lua VM (fengari) in tests, **not
  against live Upstash**.
- If a forecast write fails after its participation was indexed, the Redis
  indexes can hold a stale entry. Pending counts self-correct at finalization,
  and profile readers check the current forecast.
