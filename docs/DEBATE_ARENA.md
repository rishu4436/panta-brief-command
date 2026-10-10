# AI Debate Arena (Prediction Rooms, Phase 5)

The Debate section of `/rooms/[slug]` (`#debate`) shows, for the room's
market, the strongest **sourced** case for YES, the strongest sourced case for
NO, an **Evidence Referee** that audits both, every citation with its
provenance, and **claim challenges** from verified wallets.

It is a research aid. It is not an oracle, adviser, resolver or trader: it
gives no probability, declares no winner, never says how the market will
resolve, never recommends a position, and has no wallet or financial tools.
It is separate from the AI Brief (market-activity narrative), which it may
cite only as one evidence item ("AI Brief deterministic signals").

## Architecture

```
src/lib/debate/
  domain.ts    client-safe types + strict zod schemas (Debate, DebateClaim,
               DebateEvidence, DebateChallenge), limits, labels
  ids.ts       content-derived ids (sha-256): ev_, clm_, dbt_, chl_, src_
  evidence.ts  evidence assembly, declared-source URLs, search-provider plug-in
  prompts.ts   VERSIONED prompts (debate-gen-v1, debate-challenge-v1), model
               input builders (untrusted text sanitized + delimited), output schemas
  validate.ts  model output → stored record, or rejection
  model.ts     model boundary (OpenAI chat completions; mocked only in tests)
  service.ts   read view / generate / challenge
  deps.ts      live dependencies (+ __setDebateDepsForTests)
  types.ts     DebateRepository contract
  client.ts    TanStack hooks
src/lib/rooms/store/sqlite-debate.ts, redis-debate.ts   storage
src/app/api/rooms/[slug]/debate/route.ts                 GET (read) / POST (generate)
src/app/api/rooms/[slug]/debate/challenges/route.ts      POST (challenge)
src/components/rooms/DebateArena.tsx                     UI
src/lib/net/safe-fetch.ts                                SSRF-safe fetcher
```

Records are referenced, never duplicated: a debate stores the room id and
market id; Panta market data is not copied into room tables beyond the
evidence excerpts the debate actually cited.

## Who may generate, and when

- **Never on page views.** `GET /api/rooms/:slug/debate` only reads.
- `POST /api/rooms/:slug/debate {idempotencyKey}`: any wallet with a verified
  SIWS session (HttpOnly cookie), same origin, rate limited: 6/min per IP
  (body bucket), **3 per hour per wallet** and **6 per hour per IP** (replays of
  the same key don't count).
- Only while the market is **open or trading** and not resolved (fresh
  on-chain read at generation time; a recorded arena finalization also blocks).
- A **current debate is reused**, not regenerated (fresh: < 6 h old, same
  lifecycle, same prompt version). Same `Idempotency-Key` → the debate it
  produced. One generation per room at a time (lock, 120 s TTL, released by its
  holder's token); a concurrent request gets `409 GENERATION_IN_PROGRESS`.
- No model key → `503 AI_UNAVAILABLE` **before any source is fetched**.
- Model failure or an answer that fails validation → `502 GENERATION_FAILED`;
  **nothing is persisted**.

## Evidence and provenance

The closed evidence set (max 16 items) is built by our server:

| provenance | verification | source |
| --- | --- | --- |
| `panta_metadata` | verified | Panta market record (question, category, phase, times), description (creator-written, labelled) |
| `panta_resolution_rule` | verified | resolution rule (on-chain account if present), labelled "creator-written; defines resolution, not outcome" |
| `onchain_event` | verified | the market's Solana Event account (flags, times, totals, slot); link: Solscan account page |
| `brief_signals` | verified | the AI Brief's deterministic template (prices, prints, volume); "prices are not forecasts" |
| `declared_source` | retrieved | https URLs from the market's on-chain/Panta `oracle` field and the rule (max 3), fetched with the safe fetcher |
| `search_result` | retrieved | optional search provider (none ships) |
| `user_submitted` | user_submitted | a link supplied with a challenge (safe fetcher), labelled unverified |

Each item has `evidenceId`, `sourceUrl` (null when there is no public page —
we never invent one), `sourceTitle`, `publisher`, `publishedAt` (only when
known), `retrievedAt`, `excerpt` (≤ 1500 chars, sanitized), `note`.

**The model is never a source.** It may cite only evidence ids from this set.

### Search provider (plug-in)

No search provider is configured by default, and we do not pretend to
research: each debate's limitations say "No external search provider is
configured…". To add one, implement `SearchProvider` (`evidence.ts`) and
register it in `SEARCH_PROVIDERS`; select it with `DEBATE_SEARCH_PROVIDER`.
Result URLs are fetched with the safe fetcher like any other source.

### Safe fetcher (`src/lib/net/safe-fetch.ts`)

https only, port 443, no credentials in URLs, blocked internal host names,
every DNS answer must be a public address (IPv4/IPv6 incl. mapped / NAT64 /
6to4 forms), connection pinned to the validated address (SNI kept), manual
redirects re-validated per hop (max 3), 8 s default timeout (6 s for debate
sources), 1 MB cap after decompression, allowed content types: HTML, XHTML,
plain text, JSON. HTML is reduced to text.

## Generation output

Per side: thesis, `sufficiency` (supported / limited / insufficient) and note,
≤ 5 claims, ≤ 4 assumptions, ≤ 4 "what would weaken this case". No forced
balance: a side may be "insufficient". Per claim: text, rationale, evidence
ids (≤ 4), uncertainty (low/medium/high, qualitative), kind (verified fact,
source-supported interpretation, hypothesis, unknown) and a status decided by
our validator, not the model.

### Validation (`validate.ts`)

- strict schema (lengths, counts, enums); JSON only;
- every string: advice language, prompt-injection echoes, probability / odds /
  winner language, percentages not present in the evidence, and **any URL or
  domain** → rejected (the UI renders source links itself);
- unknown evidence ids are removed and the claim flagged; > 2 invented ids →
  the whole answer is rejected;
- a "verified fact" or "interpretation" with no valid evidence → unsupported;
- final bundle integrity (every claim cites known evidence; sides list known claims).

### Evidence Referee

Model findings merged with deterministic ones: unsupported claims, claims
flagged for invented citations, the same source read by both sides
(contradiction), truncated sources (weak), unreadable declared sources
(missing information), plus the model's source-bias notes, "what would change
this analysis" and points of agreement. Evidence quality is a qualitative
label (strong / moderate / thin). **No winner.**

## Challenges

`POST /api/rooms/:slug/debate/challenges {debateId, claimId, text, sourceUrl?, idempotencyKey}`

- verified session, same origin; a body naming a wallet is rejected;
- 10/min per IP (body bucket), **5 per 10 min per wallet**, **10 per 10 min per IP**;
- 10–500 characters of plain text; optional https link (safe fetcher; failure → 422);
- only a claim in the room's **latest** debate, room active, market unresolved;
- ≤ 10 challenges per claim, ≤ 60 per debate (enforced atomically by storage
  and pre-checked so no model call is spent on a refused challenge);
- the answer's verdict (claim stands / weakened / unsupported / insufficient
  evidence) must cite evidence ids from the debate (or the submitted link);
  otherwise it is recorded as "insufficient evidence";
- model unavailable → 503; failure → 502; nothing persisted.
- History is append-only and durable.

## Storage

SQLite (migration v4) and Upstash Redis (Lua) behind `DebateRepository`:

- `debates` (immutable rows; UPDATE aborted by trigger), `debate_idempotency`,
  `debate_locks`, `debate_challenges` (append-only; deleted only with their
  debate), `debate_challenge_idempotency`;
- Redis keys `pbc:rooms:v1:dbt:{roomId}:…` (`idx` ZSET, `d:<id>`, `lock`,
  `idem:<key>`, `ch:<debateId>` LIST, `chn:<debateId>` HASH, `chidem:<wallet>:<key>`);
  `SAVE_DEBATE_SCRIPT` and `ADD_CHALLENGE_SCRIPT` run atomically; tests run
  the real Lua in fengari;
- retention: newest **5** debates per room, trimmed (with their challenges)
  in the same atomic step as the insert; all reads bounded; no scans;
- records are schema-validated on write and on read.

## Freshness and resolution

A debate is **stale** when it is older than 6 h, the market's lifecycle
changed, the prompt version changed, or a newer debate exists. After
resolution, debates are kept and labelled **pre-resolution**; nothing new is
generated and challenges close.

## Sharing

`#debate`, `#claim-<claimId>`, `?debate=<debateId>#debate` (retained debates
only; otherwise the latest is shown with a note). Visibility follows the room:
archived rooms → 404; unlisted rooms → reachable by link only. **Embeds stay
AI-free** (no debate content in `/embed/rooms/...`).

## Cost controls

Model: `OPENAI_MODEL` (default `gpt-4o-mini`), `response_format: json_object`,
temperature 0.2, no tools.

| call | input (approx.) | output cap | timeout | est. cost (gpt-4o-mini) |
| --- | --- | --- | --- | --- |
| generation | ≲ 8k tokens (16 × 1.5k-char excerpts max) | 2,200 tokens | 45 s | ≈ $0.0025 |
| challenge | ≲ 8k tokens | 700 tokens | 25 s | ≈ $0.0016 |

Estimates use list prices of $0.15 / 1M input and $0.60 / 1M output tokens;
check current pricing. Worst case per wallet: 3 generations/hour and 30
challenges/hour; a fresh debate is reused, so most "refresh" clicks cost nothing.

## Configuration

- `OPENAI_API_KEY` — shared with the AI Brief. Unset → "AI unavailable".
- `OPENAI_MODEL` — optional.
- `DEBATE_SEARCH_PROVIDER` — optional; none ships.

No CSP change: the model and sources are called server-side only.

## Known limitations

- Without a search provider, debates rely on Panta data, the on-chain account,
  market-activity signals and the market's declared sources.
- Declared sources are often APIs (e.g. FPL JSON) whose excerpts are flattened
  key/value text; large pages are truncated at 1 MB / 1,500 chars per excerpt.
- In the development sandbox used for Phase 5 all DNS answers resolve to a
  benchmark-range address (198.18.0.0/15), which the safe fetcher correctly
  refuses, so declared sources show as "address not allowed" locally.
