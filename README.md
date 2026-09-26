# Panta Brief Command

Dark-glass **prediction desk** on Solana powered by the [Panta API](https://docs.panta.market/). Intel → Execute → Book.

**Repo:** https://github.com/rishu4436/panta-brief-command  
**Powered by Panta:** https://panta.market

## What ships

| Slice | Status |
| --- | --- |
| **Intel** — market catalog, detail odds, trade tape, AI Brief | Working |
| **Execute** — primary buy quote → build VT → pre-sign check → wallet sign → broadcast → on-chain confirm → submit → verify (polled ≤30s) → `POST /trades/` | Working |
| **Book** — positions list + win / creator-fee claim build → sign → broadcast | Working |
| **UI** — modern dark glass trading terminal | Working |
| Server proxy `/api/panta/*` — explicit route + method allowlist, server key only | Working |

### Stubbed / deferred

- Secondary-market routing (desk is primary-buy focused)
- Full claim attribution polling UI beyond optional `POST /trades/` after win claim
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
2. Click **Generate brief** — templated desk narrative from real detail + tape fields (or OpenAI if `OPENAI_API_KEY` is set).
3. **Execute** — connect Phantom/Solflare → Quote → Build VT → pre-sign check → Sign & send → confirm → Submit → Verify → report (`POST /trades/`). "Attributed" only shows when Panta returns `processed` or the trade appears in `GET /account/trades/`.
4. **Book** — Refresh positions (`GET /positions/?wallet=`) → claim build for win or creator fees.

## Env vars

| Var | Required | Notes |
| --- | --- | --- |
| `PANTA_API_KEY` | Yes | Server-only; never exposed to the browser |
| `PANTA_API_BASE_URL` | No | Default `https://live-api.panta.market/api/v1` |
| `NEXT_PUBLIC_DEFAULT_RPC` | No | Default Solana mainnet RPC |
| `OPENAI_API_KEY` | No | Optional LLM briefs |
| `OPENAI_MODEL` | No | Default `gpt-4o-mini` |

## API surface used

Base `https://live-api.panta.market/api/v1` (trailing slashes required):

- `GET /markets/`, `GET /markets/{id}/`, `GET /categories/`, `GET /markets/{id}/trades/`
- `POST /primaryorderquote/`, `POST /primaryorderbuild/`, `POST /primaryordersubmit/`, `POST /primaryorderverify/`
- `GET /positions/?wallet=`
- `POST /claim/build/`, `POST /claim/creator-fees/build/`
- `POST /trades/`, `GET /account/trades/`

Browser calls `/api/panta/*`; the Next.js route forwards **only** the routes and methods listed in `src/lib/panta/routes.ts` (403 `ROUTE_NOT_ALLOWED` otherwise, 405 on a wrong method) and attaches the server's `X-Api-Key`. Client-supplied keys are ignored.

`POST /api/brief` accepts only `{ marketId, tone }`; the server fetches market detail + tape from Panta, sanitizes and caps them, rate-limits per IP (5/min, in-memory), and caches per market+tone for 60s.

## Stack

Next.js App Router · TypeScript · Tailwind · `@solana/web3.js` · wallet-adapter (Phantom + Solflare)

## Scripts

```bash
npm run dev      # local desk
npm run build    # production build (webpack)
npm start        # serve build
```
