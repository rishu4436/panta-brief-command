# Creator Growth Studio (Phase 6)

`/studio` is where a room creator manages their Prediction Rooms and sees how
people take part in them and find them. It is wallet-authenticated (SIWS
session), read-mostly, and never touches trading, funds or any financial page.

## 1. Audit summary (state before Phase 6)

| Area | Finding |
| --- | --- |
| Ownership / visibility | `rooms.creator_wallet` is set from the verified session at create time and never changes. Visibility `public` / `unlisted`; status `active` / `archived` (archived was reserved and never produced before Phase 6). |
| SIWS sessions | `pbc_rooms_session` is an HMAC-signed cookie (wallet + expiry) issued after a one-time signed challenge. `currentSession(req)` is the only source of a wallet on the server. |
| `PATCH /api/rooms/:slug` | Same-origin + session required; strict body (title, description). The repository re-checks `creatorWallet === session wallet`. Redis did a plain read-modify-write with no index maintenance. |
| SQLite / Redis repos | One `RoomRepository` interface; SQLite (local dev / self-hosted, whole-file atomic rewrite per write) and Upstash Redis (production, Lua per multi-key change). Redis keeps `creator:<wallet>` (all of a creator's rooms) and `public` ZSETs; directory reads re-check visibility + status. |
| Forecasts | Current forecast per (room, wallet) + immutable revision history + per-room aggregate (count, sum, 10 buckets). The store refuses forecasts for non-active rooms. |
| Arena | Finalization per market (scored / blocked), immutable room scores, `isListedRoom` keeps unlisted and archived room details out of public disclosures. |
| Embeds | `/embed/rooms/:slug`: no script, own strict CSP (`default-src 'none'`, sandbox), cached `public, max-age=30, s-maxage=30, stale-while-revalidate=60`. 404 for archived rooms. Creator-only generator API. |
| Debates / challenges | Routes refuse archived rooms. **Gap found:** the store only checked the room existed, so a room archived during a (slow) AI generation or challenge answer could still get the debate / challenge saved. Fixed at the store level (SQLite transaction check, Redis Lua check) with a regression test, in a separate commit. |
| Rate limiting | Per-IP buckets via the shared store (`limitShared`), memory fallback only for rate limits (never for data). |
| Canonical origin | `appOrigin()` from configuration only (never Host / X-Forwarded-Host). |
| Nav / design | Panels, StatusBadge with glyphs, `field` inputs, TanStack Query hooks; nav item added: **Studio** (desktop at xl+, always in the mobile menu). |

### Data availability

| Metric | Source | Available for history? |
| --- | --- | --- |
| Total / active / archived / public / unlisted rooms | room records | yes |
| Unique forecasting wallets (deduplicated across the creator's rooms) | forecasts | yes |
| Returning wallets (forecast in ≥ 2 distinct rooms of the creator) | forecasts | yes |
| Current forecasts | forecast aggregates | yes |
| Revisions | revision history (SQLite) / maintained index + backfill (Redis) | yes |
| New forecasting wallets by day | first forecast time per wallet per creator | yes |
| Community forecast + distribution | forecast aggregate (10 buckets) | yes |
| Scored / pending / blocked | finalization + room score records | yes |
| Debate challenges | challenges on retained debates (latest 5 per room) | yes (retained debates only) |
| Observed room views | **new** room-view beacon | **no — from Phase 6 on** |
| Embed requests (approximate) | **new** server counter in the embed route | **no — from Phase 6 on** |
| Widget click-throughs (`?ref=embed`) | **new** beacon attribution | **no — from Phase 6 on** |
| Campaign visits (`?c=<id>`) | **new** beacon attribution | **no — from Phase 6 on** |
| Referrer source buckets | **new** beacon (host name only) | **no — from Phase 6 on** |

Distribution analytics start when Phase 6 is deployed. There is no historical
traffic data and the UI says so ("Not tracked yet") instead of showing 0.

## 2. Access

- `/studio` and `/studio/rooms/:slug` are client pages behind `StudioGate`:
  disconnected → connect wallet; connected but no session (or a session for a
  different wallet) → free sign-in signature; signed in → dashboard.
- Every `/api/studio/*` route reads the wallet **only** from the signed session
  cookie (`studioAuth`), never from query, body or headers; `?wallet=` and the
  like are ignored. 401 without a valid session; `Cache-Control: no-store`.
- `/api/studio/rooms/:slug` answers one identical 404 for "missing" and "not
  yours" (including other creators' unlisted and archived rooms).

## 3. Overview metrics (definitions shown in the UI)

All defined once in `src/lib/studio/domain.ts` (`DEFINITIONS`):

- **Forecasting wallets**: distinct wallets with a current forecast in at least one of the creator's rooms. A wallet is not necessarily a person.
- **Returning wallets**: wallets that forecast in two or more *different* rooms of the creator. Editing a forecast is not "returning".
- **Current forecasts**: one per wallet per room. **Revisions**: every saved version, including the first.
- **Scored**: room score records after verified finalization. **Pending**: current forecasts in rooms whose market has no finalization. Blocked finalizations are shown separately.
- **Debate challenges**: challenges on the debates still retained (latest 5 per room).
- Distribution numbers (views, embed requests, click-throughs, campaigns) are labelled approximate and shown as "Not tracked yet" when nothing was recorded in the 30-day window.

### Per-creator indexes

- **SQLite** derives everything with indexed joins (`rooms_creator_created`, the forecasts / revisions primary keys); nothing is maintained.
- **Redis** keeps one hash-tagged index set per creator (`st:{c:<wallet>}:first|pairs|wrc|stats|rrev|v`, see `redis-studio.ts`), updated by one Lua script after each successful forecast write (created / revised; replays don't count). The SADD-based parts are idempotent.
- **One-time bounded backfill (Redis):** the first time a creator opens the Studio and the marker `v` is missing, existing current forecasts of their rooms are scanned (at most 5,000 records, 200 rooms) and merged; revisions per room are set from the scanned revision numbers; then the marker is set. If the cap is hit, stats are flagged *approximate* in the UI. A forecast written in the milliseconds between the backfill's read of a room and the marker write can be missed (undercount by one); a failed index update after a saved forecast is logged and never fails the forecast (also an undercount). To rebuild a creator's indexes, delete their `st:{c:<wallet>}:*` keys (an operator action, not automated); the next Studio visit backfills again.
- **Existing local data:** `.data/rooms.sqlite` migrates to schema v5 (two new tables) automatically on first open; no data is changed.

## 4. Room management

- Editable by the creator only: **title, description, visibility, archive / unarchive**. `PATCH /api/rooms/:slug` (same-origin, session; strict schema rejects `marketId`, `slug`, `creatorWallet` and anything else).
- **Slug changes are not allowed in V1**: shared links, embeds and canonical URLs depend on the address and there is no redirect table (and no open redirects are wanted).
- **marketId is immutable**: forecasts, scores and finalization are bound to it.
- **Archive** (`status: "archived"`):
  - the room page, `GET /api/rooms/:slug`, the embed, forecasts, leaderboard and debate routes answer 404 to everyone; it leaves the directory and arena disclosures (`isListedRoom`);
  - new forecasts, debate generations and challenges are refused (routes **and** store);
  - nothing is deleted: forecasts, revisions, scores, debates and challenges stay; the creator still sees the room and its numbers in the Studio;
  - non-creators get 404 from PATCH as well (no existence leak).
- **Unarchive** (`status: "active"`) restores the room exactly as it was (same slug, visibility, history). Forecasting reopens only if the market's window is still open (the server re-checks Panta on every forecast). Unlisted rooms stay link-only.
- Redis: the room record is updated with a compare-and-set Lua script (retried on concurrent edits), then the `public` index is synced (ZADD when public + active, else ZREM). The record is authoritative; a failed index sync can only hide a public room until its next save, never list an unlisted or archived one.

## 5. Event instrumentation (privacy-conscious)

| Event | How | Label in UI |
| --- | --- | --- |
| Room view | `RoomViewBeacon` → `navigator.sendBeacon` (same-origin) → `POST /api/rooms/:slug/events` | Observed room views |
| Embed request | counted in `/embed/rooms/:slug` after the response (`after()`), no script in the widget, embed CSP unchanged | Embed requests (approximate) |
| Widget click-through | widget links are `…/rooms/<slug>?ref=embed`; counted when the room page loads with it | Widget click-throughs |
| Campaign | `…/rooms/<slug>?c=<id>` with `id` = `[a-z0-9-]{1,32}`; counted when the room page loads with it | Campaign visits |

Rules:

- Body: `{schemaVersion: 1, event: "room_view", ref?: "embed", campaign?: id, referrerHost?: host}` (strict, ≤ 512 bytes). Server timestamp; the room must be active; same-origin required.
- Referrer → bucket: `direct`, `embed`, `same-site`, or the external **host name** (validated, ≤ 100 chars). URLs, paths and query strings are never accepted or stored; an invalid host counts as "other".
- Not counted: Do Not Track / Global Privacy Control, prefetch / prerender headers (`Purpose`, `Sec-Purpose`, `X-Purpose`, `X-Moz`, `Next-Router-Prefetch`), and automated user agents (heuristic regex: bots, crawlers, headless browsers, curl, HTTP libraries…). Same-origin embed loads (the creator's own previews) are not counted.
- Dedupe: `HMAC(dailySalt, ip | user agent | room | event)` where `dailySalt = HMAC(ROOMS_SESSION_SECRET, "studio-dedupe:v1:" + UTC day)`; kept 26 h. Raw IPs and user agents are never stored; keys can't be linked across days. Without a session secret nothing is counted.
- Dedupe is approximate by design: the same person on two browsers, or whose IP changes during the day (mobile networks, IPv4/IPv6 dual stack; locally `localhost` can resolve to either `::1` or `127.0.0.1`), counts more than once. In development the session secret is random per process, so the daily salt also changes on every dev-server restart.
- The client sends at most one beacon per room per page load (keyed by slug, so React strict mode's double effect run in development doesn't send a second, unattributed beacon after `?ref`/`?c` are stripped).
- Rate limit: 60 beacons / minute / IP (plus the embed route's own limit).
- No wallet, no cookies set, no localStorage, no third-party requests. The beacon reuses CSP `connect-src 'self'`; no security header changed anywhere (financial pages untouched).
- The beacon removes `ref` / `c` from the address bar after reading them, so re-shared links aren't attributed again.
- Production undercount: the embed is cached by the CDN for 30 s (`s-maxage=30`, plus stale-while-revalidate), so repeat loads within that window never reach the server. Treat embed requests as a lower bound.

## 6. Storage

- **SQLite** (migration v5): `studio_counters(creator_wallet, day, room_id, metric, count)` PK on all four keys, and `studio_dedupe(dedupe_key, expires_at)`. One write transaction per event; counters older than 90 days and expired dedupe keys are pruned on write.
- **Redis**: `ev:{c:<wallet>}:d:<YYYY-MM-DD>` hash (`<roomId>|<metric>` → count) with `PEXPIRE` 91 days, plus `ev:{c:<wallet>}:dd:<hmac>` (`SET NX PX 26h`). One Lua script per event: dedupe, caps and increments are atomic.
- Caps: 2,000 counter fields per creator per day; 25 dynamic fields (referrer hosts + campaign ids) per room per day, the rest fold into `src:other` / `c:other`. A duplicate dedupe key increments nothing.
- No volatile fallback: on Vercel without Redis the store is "unavailable" (Studio answers 503; beacons are silently dropped, never kept in memory).

## 7. Visualizations

Inline SVG, no chart library (`StudioCharts.tsx`): new forecasting wallets per day,
daily distribution counters, activity by room, source / campaign breakdown, and the
forecast distribution. Each chart has an `aria-label` summary (and a visually
hidden table for the daily charts) and renders only when real data exists; empty,
sparse, unavailable (archived), missing-Panta ("Market status unavailable") and
storage-error states are explicit.

## 8. Distribution toolkit

Share link, campaign link builder (validated id, canonical URL + `?c=`), the
Phase 4 `EmbedGenerator` (embed code + live preview), debate link (only if a debate
exists), room leaderboard, Arena and the creator's forecaster profile. No
redirects; nothing claims conversions: views are never linked to wallets or
forecasts.

## 9. Insights

`src/lib/studio/insights.ts`: deterministic rules over the measured numbers (no
AI). Each insight shows the numbers it is based on and the relevant limitation
(wallets ≠ people, referrers often missing, embed undercount). With fewer than 3
forecasting wallets, ratios are suppressed.

## 10. Performance & scaling limits

- Studio reads at most the creator's newest **200 rooms** (`MAX_STUDIO_ROOMS`); the rooms list is filtered and paginated server-side (10 per page) over that set.
- Overview cost is O(rooms) small reads (aggregate, finalization per market, challenge count, scores total when scored) with concurrency 8, plus one stats read and one counter read (30 day hashes in one Lua call on Redis).
- Market data comes from the shared snapshot cache (`getMarketSnapshot`, ≤ 800 ms wait), only for the 10 rooms on the current page.
- Charts read at most 30 UTC days; new-forecaster times are capped at 5,000 per creator.
- SQLite rewrites the whole file on each event: fine locally, not for production traffic (production uses Redis).

## 11. Security checklist

Cross-creator denial (404), forged / expired sessions (401), client wallet ignored,
event injection (strict schema, 400), duplicate inflation (HMAC dedupe), unbounded
storage (field caps, retention), unsafe referrers (host-only), arbitrary params
(strict; `ref` must be `embed`, campaign regex), visibility leaks (archived 404 for
others; public APIs return no metrics), archived access blocked at routes and
store, CSRF (same-origin on PATCH and beacon), XSS (React text rendering; embed
HTML escaped, no script), no session data in responses, no financial actions.
