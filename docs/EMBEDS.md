# Embeddable Prediction Room widgets

Phase 4 ("Market Everywhere") lets a room's community forecast appear on any
website as a small read-only widget:

```html
<iframe src="https://briefcommand.vercel.app/embed/rooms/<slug>?theme=dark&amp;layout=standard&amp;dist=1&amp;market=1"
        title="<room title> · community forecast on Brief Command"
        width="100%" height="540" style="border:0;max-width:560px;width:100%;color-scheme:normal"
        loading="lazy" referrerpolicy="strict-origin-when-cross-origin"
        sandbox="allow-popups allow-popups-to-escape-sandbox"></iframe>
```

The widget shows the room title, the market question, the market lifecycle,
the community mean YES and participant count, the distribution, and (when
the data is real) Panta's price. It links back to the room with
"Add your forecast on Brief Command". There is no wallet, no forecasting
inside the frame, no cookies and no script.

## 1. Audit (before Phase 4)

| Surface | Who can read | Missing / archived | Notes |
| --- | --- | --- | --- |
| `/rooms/:slug` (page) | anyone with the link (public + unlisted) | `notFound()` | unlisted → `robots: noindex` |
| `GET /api/rooms` | anyone | n/a | lists only `public` + `active` |
| `GET /api/rooms/:slug` | anyone with the link | 404 `ROOM_NOT_FOUND` | |
| `GET /api/rooms/:slug/forecasts`, `/leaderboard` | anyone with the link | 404 `ROOM_NOT_FOUND` | writes need the SIWS session |
| `GET /api/rooms/:slug/forecasts/me` | session wallet | 404 | |
| `GET /api/arena`, `/api/forecasters/:wallet` | anyone | n/a | room slug/title shown only for listed rooms |

* Visibility model: `visibility` is `public` (listed in the directory) or
  `unlisted` (link-only). `status` is `active` or `archived` (disabled).
  There is **no "private" visibility**; "private" in the spec maps to
  "not viewable by the public", which today is only `archived`.
* Before Phase 4 the arena showed a room's slug/title when the room was
  `public` even if it was archived. It now uses `isListedRoom` = `public && active`,
  so archived rooms are anonymised exactly like unlisted ones
  (src/lib/arena/public.ts).
* Headers: every route got CSP `frame-ancestors 'none'` + `X-Frame-Options: DENY`
  from next.config (`/:path*`).
* Rate limits: `limitShared` (Upstash when configured, else per-instance memory).
* Room page metadata built the canonical URL from configuration *or* the
  request Host header. It now uses the configured origin only (see §6).

## 2. Delivery architecture

`/embed/rooms/[slug]` is a **route handler that returns a server-rendered HTML
string** (src/app/embed/rooms/[slug]/route.ts, src/lib/embed/*), not a React page.

Why:

* Zero client JavaScript, no root layout, no Providers / wallet adapter /
  AppShell code in the frame. The CSP can therefore forbid script entirely.
* No file moves: a route-group refactor to give `/embed` its own root layout
  would have moved the financial pages (execute / create / book). Phase 4
  must not touch financial execution paths.
* The handler sets its own headers, so the framing exception is exactly the
  `/embed/**` handlers and nothing else.

`src/app/embed/[...rest]/route.ts` answers every other `/embed/**` path with
the same not-found widget (and the embed headers), so no `/embed/` URL ever
falls through to an app page.

Data flow per request (read-only):

1. Parse options (allowlist, §4). Per-IP rate limit (`embed:<ip>`,
   120 / min) → 429 `no-store` with `Retry-After`.
2. Decode + lowercase the slug; `slugProblem` → 404.
3. `getRoomBySlug`; missing or not `active` → the same 404.
4. In parallel: the persisted forecast aggregate, the arena finalization
   record, and the bounded market snapshot (§5).
5. `buildEmbedModel` (pure) → `renderEmbed` (pure, every value escaped).

The repository calls are exactly `getRoomBySlug`, `getForecastAggregate`,
`getFinalization` (tested). The embed never finalizes, never gathers
resolution evidence, never writes.

## 3. Visibility semantics

| Room | Embed |
| --- | --- |
| public + active | 200 |
| unlisted + active | 200 (same as viewing by link; widget is `noindex`) |
| archived (disabled) | 404 "Room not available" |
| missing / malformed slug / any other `/embed/**` path | the same 404 |

The 404 body and headers are byte-identical for archived and missing rooms
with the same options (tested), so an embed can't be used to probe whether a
disabled room exists. These rules match `/rooms/:slug` and
`/api/rooms/:slug*`; the directory and arena show only listed rooms.

## 4. Options

| Param | Values | Default |
| --- | --- | --- |
| `theme` | `dark` \| `light` | `dark` |
| `layout` | `standard` \| `compact` | `standard` |
| `dist` | `1` \| `0` (distribution chart, standard layout only) | `1` |
| `market` | `1` \| `0` (market question + Panta line) | `1` |

Values must match exactly (case-sensitive). **Invalid values fall back to the
default** (no 400, so an old or mangled snippet still renders); unknown keys
are ignored; nothing from the query string is ever echoed into the page. The
generator writes the parameters in the fixed order above.

Suggested heights (`embedHeight`): standard 340 + 100 (dist) + 100 (market),
compact 270 / 340 with market. The widget scrolls inside the frame if a very
narrow host wraps more.

Development only: `_dev_market=unavailable` renders the widget as if Panta
and the chain were unreachable (used by the local host page). It is honoured
only when `NODE_ENV === "development"` (so never in production or tests), and
it bypasses the snapshot cache so it can't poison it.

## 5. Content rules and market data

* **Community numbers** come from the persisted aggregate (mean = sum / n,
  half-up to whole bps, shown to 0.1 %; participants; ten 10 % buckets), the
  same numbers the room page shows.
* **Panta price** only when it is genuine: a primary market shows the
  implied YES probability; a secondary market shows the last observed USDC
  prices labelled "(prices, not probabilities)"; resolved / cancelled /
  unknown markets show no price.
* **Resolution**: "Verified: YES/NO" only when (a) the arena finalized the
  market as `scored` (Panta record + on-chain account agreed, persisted with
  the slot), or (b) the snapshot read both Panta's record and the on-chain
  account and they agree. A blocked arena record shows "Resolution sources
  disagree" with no side; a one-sided "resolved" shows "Awaiting verification"
  with no side.
* **Never blocks on slow Panta.** `getMarketSnapshot` keeps a bounded
  in-memory cache (500 markets): fresh for 45 s, then served stale (with an
  age label) while one background refresh runs, dropped after 10 min. A cold
  request waits at most 1.2 s; if the on-chain account answers first, a
  provisional chain-only entry is shown with "Panta's market record didn't
  load in time". With nothing at all, the widget renders the community part
  and "Panta market data is unavailable right now · community data is current".
* The snapshot is display data only. It is **never used for authorization**:
  forecast writes are checked with a per-write chain read
  (`checkForecastWindowForWrite`, see PREDICTION_ROOMS.md).

## 6. Canonical origin

Snippets, room links, the widget's own links and the room page's canonical /
Open Graph URL use `appOrigin()` (src/lib/embed/origin.ts):

1. `APP_ORIGIN`, else 2. `NEXT_PUBLIC_APP_ORIGIN`, else
3. production: `https://briefcommand.vercel.app`; development: `http://localhost:3100`.

A configured value must be an origin only (no path, query, fragment or
credentials) and `https:` in production (`http://localhost` / `127.0.0.1` is
accepted outside production). Anything else is ignored in favour of the
fallback. The request's Host / X-Forwarded-Host is never used.

## 7. Creator generator

The "Embed this room" panel (src/components/rooms/EmbedGenerator.tsx) appears
on the room page only when the signed-in wallet is the room's creator, and it
loads its settings from `GET /api/rooms/:slug/embed`, which checks the
HttpOnly SIWS session server-side: no session 401 `ROOM_AUTH_REQUIRED`,
another wallet 403 `ROOM_CREATOR_ONLY`, missing/archived 404. Hiding the UI is
cosmetic; the API is the gate. (The snippet itself isn't secret: anyone can
build the public URL.)

It offers theme / layout / distribution / market toggles, a live preview
(sandboxed iframe of the relative embed path, full width or 320 px), the
escaped snippet, copy buttons for the code, the embed URL and the room link,
and "Where to paste it" notes for WordPress, Webflow, Ghost, Notion and
Substack.

Builder notes:

* WordPress (self-hosted): Custom HTML block (WordPress.com only on plans that allow custom code). Webflow: Code Embed element. Ghost: HTML card.
* Notion: `/embed` with the embed URL (Notion builds its own iframe).
* Substack doesn't allow custom iframes in posts: share the room link.
* Keep `sandbox` and `referrerpolicy` as generated. `color-scheme:normal`
  keeps the frame background transparent on sites that declare
  `color-scheme: dark`.

## 8. Security headers per route

`/embed/**` (both handlers, every status including 404 / 429 / 503):

```
Content-Security-Policy: default-src 'none'; style-src 'sha256-<EMBED_CSS>'; img-src 'self' data:;
  base-uri 'none'; form-action 'none'; frame-ancestors https: [dev: http://localhost:* http://127.0.0.1:*];
  sandbox allow-popups allow-popups-to-escape-sandbox
Referrer-Policy: strict-origin-when-cross-origin
X-Content-Type-Options: nosniff
X-Robots-Tag: noindex, nofollow
Cache-Control: public, max-age=30, s-maxage=30, stale-while-revalidate=60   (404 too; 429/503: no-store)
(no X-Frame-Options, no Set-Cookie, no Access-Control-Allow-Origin)
```

* No script at all (`default-src 'none'`, no `script-src`); the one inline
  `<style>` is allowed by its hash; SVG uses geometry attributes, not inline styles.
* The CSP `sandbox` directive gives the page an opaque origin with scripts
  and forms disabled even when someone frames it without a sandbox
  attribute or opens it directly; links still open a normal new tab
  (`target=_blank rel="noopener noreferrer"`).
* `frame-ancestors https:` allows any https site (the product goal is
  "embed anywhere"); plain-http hosts are refused except localhost in dev.
* The widget never reads cookies or the session (tested by source scan) and
  emits no cookies. All links are built from the configured origin plus an
  encoded slug, so there is no redirect parameter to abuse.

Every other route (next.config `source: "/((?!embed/).*)"`): the app CSP with
`frame-ancestors 'none'` and `X-Frame-Options: DENY`, unchanged, including
`/embed` itself and look-alikes such as `/embedx`. The app CSP's `frame-src`
gained `'self'` so the creator's preview iframe can load.

Verified in a real browser: a page on `http://localhost:3200` frames every
embed case; framing `/`, `/rooms/:slug`, `/desk` or `/api/arena` from the
same page is refused by Chrome ("violates frame-ancestors 'none'").

## 9. Sharing

* The room page's existing share button and the generator's "Copy room
  link" both use the canonical room URL.
* Room page Open Graph / Twitter metadata now uses real data: the market
  question from the bounded snapshot and "Community forecast: X% YES from
  N forecasters" from the persisted aggregate.
* Embeds are `noindex,nofollow` (meta + header) and carry
  `<link rel="canonical">` to the room page.

## 10. Local testing

```
npm run dev                                   # :3100
python3 -m http.server 3200 --bind 127.0.0.1  # in /workspace/qa/embed-host (QA only, not in the repo)
open http://localhost:3200/
```

## 11. Limitations

* The snapshot cache is per server instance (in memory); each instance warms
  its own. Public HTTP caching (30 s) does most of the work on Vercel.
* Fixed iframe height (no auto-resize: that would need script in the frame
  and `postMessage`).
* The embed rate limit is per IP; behind a shared proxy many readers share a budget.
* `frame-ancestors https:` cannot be narrowed per creator (no allowlist
  setting exists yet).
* Notion and other builders that re-wrap iframes may drop `sandbox`; the
  CSP `sandbox` directive still applies.
