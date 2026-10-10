# Prediction Rooms (Phase 1 foundation + Phase 2 community forecasting)

A Prediction Room is a wallet-owned community destination built around exactly
one canonical Panta market. Phase 1 ships the foundation only: create, browse,
share and view rooms. Forecasts, discussion, leaderboards and activity are
shown as labelled "coming soon" sections with no data.

## Authority

- The room stores a **market reference** (`marketId`, the Panta Event PDA) and
  nothing else about the market: no prices, outcome, lifecycle or settlement.
- Every room surface reads the market live through the existing data layer
  (`useCatalog` / `useMarket`, Stage D `marketState()`, `marketHref()`), so a
  room always agrees with the market page.
- On create, the server re-validates the market with Panta's detail endpoint
  (server key). Unknown ids → 422 `MARKET_NOT_FOUND`; cancelled → 422
  `MARKET_CANCELLED`; Panta unreachable → 503, nothing saved.

## Model

| field | notes |
| --- | --- |
| `roomId` | `room_` + 24 hex (96 random bits), immutable |
| `slug` | 3–48 chars, `^[a-z0-9]+(-[a-z0-9]+)*$`, unique, reserved words rejected |
| `title` | 4–80 chars, control/bidi chars stripped |
| `description` | ≤ 500 chars, optional |
| `creatorWallet` | from the verified session only; the body can't name it (strict schema) |
| `marketId` | canonical Panta market id, validated server-side |
| `visibility` | `public` (directory) or `unlisted` (link only) |
| `status` | `active` (`archived` reserved) |
| `createdAt` / `updatedAt` | unix ms in storage, ISO in the API |

Duplicate slugs are **rejected** (409 `SLUG_TAKEN`), never silently suffixed;
the create form checks availability as you type (`/api/rooms/slug-check`).

Idempotency: each reviewed payload gets one client key. Same key + same payload
→ the original room (200 `replayed`); same key + different payload → 409.

## Storage (`src/lib/rooms/store/`)

One `RoomRepository` interface, three adapters, chosen by `store/index.ts`:

1. **Upstash Redis** when `UPSTASH_REDIS_REST_URL` / `_TOKEN` (or `KV_REST_API_*`)
   are set. Slug uniqueness `SET NX`, idempotency `SET NX` (7 days), nonce
   consumption `GETDEL`, room + indexes in one `MULTI`. Keys: `pbc:rooms:v1:*`.
2. **Vercel without Redis → unavailable**: reads 503, creation fails closed.
3. **SQLite file** (`sql.js`, WebAssembly, no native build) at
   `ROOMS_SQLITE_PATH`, or `.data/rooms.sqlite` in development. Gitignored.
4. Production with neither → unavailable.

### SQLite schema (migration v1)

```sql
CREATE TABLE rooms (
  room_id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '', creator_wallet TEXT NOT NULL,
  market_id TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('public','unlisted')),
  status TEXT NOT NULL CHECK (status IN ('active','archived')),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE room_idempotency (creator_wallet TEXT, idem_key TEXT,
  request_hash TEXT NOT NULL, room_id TEXT NOT NULL REFERENCES rooms(room_id),
  created_at INTEGER NOT NULL, PRIMARY KEY (creator_wallet, idem_key));
CREATE TABLE auth_challenges (nonce TEXT PRIMARY KEY, wallet TEXT NOT NULL,
  message TEXT NOT NULL, domain TEXT NOT NULL, issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL);
```

Later migrations: v2 forecasts, v3 arena, v4 AI debates (`store/sqlite-debate.ts`).

Migrations live in `MIGRATIONS` (`store/sqlite.ts`), are append-only and are
applied automatically on open (`schema_migrations` table). Writes run in a
transaction under an in-process queue + `<db>.lock` file, then replace the file
atomically (temp file, fsync, rename). All statements are parameterised.

## Wallet ownership (`src/lib/rooms/auth.ts`)

Sign-In-With-Solana style, no transaction:

1. `POST /api/rooms/auth/challenge {wallet}` → server nonce (128 bits, hex) and
   a strictly standard SIWS message (Phantom rejects anything else): header with
   the request host, wallet, one-line statement, then only `URI`, `Version: 1`,
   `Chain ID: mainnet`, `Nonce`, `Issued At`, `Expiration Time` (5 min, UTC `Z`,
   second precision) and `Request ID: prediction-rooms-auth` (the purpose).
   Verified against `@solana/wallet-standard-util` `parseSignInMessageText` in
   `test/rooms.test.ts`.
2. Wallet `signMessage` (Ed25519).
3. `POST /api/rooms/auth/verify {nonce, signature}` → the challenge is consumed
   atomically first (single use), then expiry, Origin host = challenge domain,
   and the Ed25519 signature (Node `crypto.verify`) against the wallet stored in
   the challenge are checked.
4. Success sets `pbc_rooms_session`: HMAC-SHA256 signed with
   `ROOMS_SESSION_SECRET`, HttpOnly, SameSite=Strict, Secure in production,
   30 min. Production without the secret: sign-in answers 503.

All mutations also require a same-host `Origin` header (CSRF), are rate limited
per IP with the shared limiter, and bodies are capped (1 KB auth, 4 KB rooms).

## API

| route | auth | |
| --- | --- | --- |
| `GET /api/rooms[?creator=]` | public | public rooms newest first (owner also sees unlisted) |
| `POST /api/rooms` | session | create |
| `GET /api/rooms/:slug` | public | one room |
| `PATCH /api/rooms/:slug` | session, creator only | title / description |
| `GET /api/rooms/slug-check?slug=` | public | advisory availability |
| `POST /api/rooms/auth/challenge`, `/verify` | — | sign-in |
| `GET / DELETE /api/rooms/auth/session` | — | who am I / sign out |
| `GET /api/rooms/:slug/forecasts[?limit&offset]` | public | community forecast, histogram, current forecasts (≤ 50 per page), forecast window |
| `POST /api/rooms/:slug/forecasts` | session | submit / revise own forecast |
| `GET /api/rooms/:slug/forecasts/me` | session (else `wallet: null`) | own current forecast + revision history |
| `GET /api/rooms/:slug/debate[?debate=]` | public | AI debate (read-only, never generates), see docs/DEBATE_ARENA.md |
| `POST /api/rooms/:slug/debate` | session | generate or reuse the room's debate |
| `POST /api/rooms/:slug/debate/challenges` | session | challenge a claim |

## Community forecasting (Phase 2)

Free YES-probability forecasts by verified wallets on the room's Panta
market. No money, no transaction, no scoring yet.

**Model** (`src/lib/forecasts/domain.ts`): `forecastId, roomId, wallet,
probabilityBps (int 0..10000), reasoning (≤ 1000 chars, plain text),
revision, createdAt, updatedAt` (server clock). One CURRENT forecast per
(room, wallet); every accepted submission appends one immutable history entry.

**Writes** (`POST`): wallet only from the HttpOnly SIWS session (a body that
names `wallet`/`walletAddress`/… → 400); same-origin only; strict schema;
per-IP (20/min) and per-wallet (12/min) limits; `idempotencyKey` (same key +
same payload replays the first result); `expectedRevision` (0 = first
forecast) guards against lost updates → 409 `FORECAST_REVISION_CONFLICT`
with `currentRevision`. Room creators have no power over others' forecasts.

**Forecast window / cutoff** (`src/lib/forecasts/window.ts`). Writes are
accepted only while the market is open for primary participation and before
the cutoff. Cutoff = Panta's `primaryPhaseEndTime` (end of the primary buy
window, the timestamp the canonical lifecycle uses to close "Primary · open"),
or the event `endTime` if earlier; the earliest value any source reports wins.
Each write re-checks server-side with the server clock (`window-server.ts`):

- **Authorising read: the market's on-chain `Event` account**, fetched fresh
  for every check (`getAccountInfo`, commitment `confirmed`, 3 s timeout; the
  account must be owned by the Panta program). Every write issues its own
  request (`readEventAccountFresh`), so the deciding read always starts after
  the write arrived; only page-view reads share an in-flight request. The
  result is never cached.
- **Panta detail** may only add restrictions. One in-flight request per
  market; full records are reused for up to 120 s; with a fresh chain read the
  check waits at most 750 ms for it. A cached record can't re-open anything:
  the most advanced phase from any source wins.
- **Catalog row**: used only if the catalog is already built (no cold-build
  wait).
- **Chain unreadable**: a FULL detail fetched for this check is required
  (bounded at 8 s; reused records don't count). A thin record (partial or
  priceless) is closed (`unavailable`) even if the catalog row says open,
  because the catalog is a cache and caches never authorise.
- The cutoff is compared with the server clock read after the source awaits.

Secondary, ended, resolved, cancelled, unknown, `is_active = false` →
409 `FORECASTING_CLOSED`; no Event account / unknown to Panta, no published
`primaryPhaseEndTime`, or nothing could be read → closed (503
`FORECAST_WINDOW_UNAVAILABLE` when sources couldn't be reached). Reads are
never gated; page reads may reuse a computed window for 15 s (re-checked
against the clock, "unavailable" never cached), writes never do.

Why (measured 10 Oct 2026, local): Panta's detail endpoint took 3–8 s per call
(some hit the 10 s timeout) and the old check waited up to 8 s for a cold
catalog, so a submit took 3–10 s and a cold start could end in "Panta couldn't
be reached". With the chain as the fresh authorising read, warm submits take
~30–70 ms end to end.

The submit response includes the committed community aggregate (`consensus`,
read right after the write), which the client puts straight into its cache.

**Community forecast**: unweighted mean of CURRENT forecasts, one per wallet,
computed server-side from maintained aggregates (SQL `COUNT/SUM/GROUP BY` on
the indexed current table; Redis counters updated in the submit script). No
forecasts → no mean ("No community forecasts yet"). Histogram: 10 buckets of
10 points (100 % in the last). Never labelled as a market price or probability
from Panta.

**SQLite (migration v2)**: `forecasts` (UNIQUE (room_id, wallet), CHECKs on
range/length), `forecast_revisions` (PRIMARY KEY (room_id, wallet, revision);
UPDATE/DELETE aborted by triggers), `forecast_idempotency`. Submit runs inside
the repository's exclusive write (lock + transaction); the revision UPDATE is
conditional on the expected revision.

**Redis**: per room, under the `{roomId}` hash tag: `meta` (wallet →
revision|bps), `cur` (wallet → JSON), `hist:<wallet>` (append-only list),
`agg` (count, sum, b0..b9), `order` (ZSET by updatedAt), `idem:<wallet>:<key>`
(24 h). One Lua script (`SUBMIT_SCRIPT`) re-checks idempotency and revision,
then appends history, replaces current, adjusts counters and records the
idempotency result atomically. Tests run that script in a Lua VM (fengari)
over an in-memory keyspace; it has not been run against live Upstash.

## Required configuration for production

- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (durable rooms on Vercel)
- `ROOMS_SESSION_SECRET` (≥ 32 random chars)
- `ROOMS_ADMIN_TOKEN` (≥ 32 random chars; enables arena finalization, see docs/ARENA.md. Optional: without it nothing is ever scored)
- `OPENAI_API_KEY` (optional: enables the AI Debate Arena, same key as the AI Brief; without it the arena says "AI unavailable")
- `APP_ORIGIN` (canonical https origin for embed snippets, share links and room metadata, see docs/EMBEDS.md. Optional: falls back to https://briefcommand.vercel.app; set it for any other domain)
