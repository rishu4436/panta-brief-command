# Prediction Rooms (Phase 1 foundation)

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

## Required configuration for production

- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (durable rooms on Vercel)
- `ROOMS_SESSION_SECRET` (≥ 32 random chars)
