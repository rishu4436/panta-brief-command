# Panta Brief Command

Dark-glass **prediction desk** on Solana powered by the [Panta API](https://docs.panta.market/). Intel → Execute → Book.

**Repo:** https://github.com/rishu4436/panta-brief-command  
**Powered by Panta:** https://panta.market

## What ships

| Slice | Status |
| --- | --- |
| **Intel** — market catalog, detail odds, trade tape, AI Market Brief (deterministic signals + interpretation) | Working |
| **Execute** — primary buy quote → build VT → pre-sign check → wallet sign → broadcast → on-chain confirm → submit → verify (polled ≤30s) → `POST /trades/` | Working |
| **Book** — positions list + win / creator-fee claim build → sign → broadcast; win claims reported → attributed, creator-fee claims labelled not attributed | Working |
| **UI** — modern dark glass trading terminal | Working |
| Server proxy `/api/panta/*` — explicit route + method allowlist, server key only | Working |

### Stubbed / deferred

- Secondary-market routing (desk is primary-buy focused)
- Attribution for creator-fee claims (Panta rejects them on `POST /trades/` with `TX_MISMATCH`, so the desk labels them as not attributed)
- Market creation flow (out of scope for this desk)

## Judge runbook

```bash
git clone https://github.com/rishu4436/panta-brief-command.git
cd panta-brief-command
cp .env.example .env.local
# paste PANTA_API_KEY from https://docs.panta.market/ (pk_test_… / pk_live_…)
npm install
npm run build
npm run dev
```

Open http://localhost:3000

### Demo path

1. **Intel** — catalog loads via `GET /markets/`. Open a market for detail odds (`GET /markets/{id}/`) + tape (`GET /markets/{id}/trades/`).
2. **AI Market Brief** (auto-runs on the market page) — pick **Desk read**, **Flow**, **Risk** or **Catalysts**. The card blocks (YES/NO, flow, signal, price vs flow, risk, execution, data quality) come from deterministic signals; the interpretation below them comes from OpenAI when `OPENAI_API_KEY` is set, otherwise from a template built on the same signals.
3. **Execute** — connect Phantom/Solflare → Quote → Build VT → pre-sign check → Sign & send → confirm → Submit → Verify → report (`POST /trades/`). "Attributed" only shows when Panta returns `processed` or the trade appears in `GET /account/trades/`.
4. **Book** — Refresh positions (`GET /positions/?wallet=`) → claim build for win or creator fees. Win claims are reported with `POST /trades/` ("reported for attribution"), then "attributed" once Panta returns `processed` or the claim appears in `GET /account/trades/?kind=claim`. Creator-fee claims are not reported and are labelled as not attributed.

## Env vars

| Var | Required | Notes |
| --- | --- | --- |
| `PANTA_API_KEY` | Yes | Server-only; never exposed to the browser |
| `PANTA_API_BASE_URL` | No | Default `https://live-api.panta.market/api/v1` |
| `NEXT_PUBLIC_DEFAULT_RPC` | No | Default Solana mainnet RPC |
| `OPENAI_API_KEY` | No | Optional LLM interpretation of the signals (template fallback otherwise) |
| `OPENAI_MODEL` | No | Default `gpt-4o-mini` |

## API surface used

Base `https://live-api.panta.market/api/v1` (trailing slashes required):

- `GET /markets/`, `GET /markets/{id}/`, `GET /categories/`, `GET /markets/{id}/trades/`
- `POST /primaryorderquote/`, `POST /primaryorderbuild/`, `POST /primaryordersubmit/`, `POST /primaryorderverify/`
- `GET /positions/?wallet=`
- `POST /claim/build/`, `POST /claim/creator-fees/build/`
- `POST /trades/`, `GET /account/trades/`

Browser calls `/api/panta/*`; the Next.js route forwards **only** the routes and methods listed in `src/lib/panta/routes.ts` (403 `ROUTE_NOT_ALLOWED` otherwise, 405 on a wrong method) and attaches the server's `X-Api-Key`. Client-supplied keys are ignored.

`POST /api/brief` accepts only `{ marketId, mode }` (`desk` | `flow` | `risk` | `catalysts`, default `desk`). The server fetches market detail + up to 50 tape rows from Panta, sanitizes them, rate-limits per IP (5/min, in-memory), and caches per market+mode for 60s. It returns `{ market, tape, signals, narrative, source, mode, generatedAt }`.

## AI Market Brief: signal engine

`src/lib/panta/signals.ts` is a pure function of (market detail, tape, now) that returns structured evidence. It makes no network calls and uses no randomness or model:

- YES/NO probability and its source (live spot, settled, or primary curve)
- tape count, YES/NO print counts and ratio, primary vs secondary prints, window, last-print age, top-wallet concentration
- flow imbalance, share-weighted from `shares`/`sharesBase` (print-weighted only if sizes are missing)
- recent volume in shares (USDC only when every print carries it), plus lifetime catalog volume
- minutes to resolution
- market price vs recent-flow divergence in points
- `dataQuality` (`high` / `medium` / `low`) with reasons
- `riskFlags`: thin tape, resolution < 24h, no price, primary quote vs spot, stale last print, one-sided or concentrated flow, divergence, and so on
- factual execution lines, e.g. "Primary YES and NO available · quote required before sizing"

Anything that can't be derived is `null` with a reason. For example, `probabilityChange` is always null because tape rows carry no per-trade price. The LLM receives this JSON and is told to interpret it, not recompute it, and never to give buy/sell or sizing advice. Every brief has four sections: **Observation / Evidence / Risk / Execution considerations**. If an LLM answer is missing a section or contains advice-like wording, the desk falls back to the template, which renders from the same signals, so the demo reads the same without an OpenAI key. **Catalysts** mode uses only the catalog description and resolution time, and says so when there is little to go on.

## Stack

Next.js App Router · TypeScript · Tailwind · `@solana/web3.js` · wallet-adapter (Phantom + Solflare)

## Scripts

```bash
npm run dev      # local desk
npm run build    # production build (webpack)
npm start        # serve build
```
