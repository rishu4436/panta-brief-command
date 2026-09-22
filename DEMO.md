# Brief Command — Colosseum + Superteam Earn Demo Notes

**One-line pitch:** Brief Command turns live Solana prediction markets into an operator path: scan the market, brief the evidence, execute a primary buy, and inspect the resulting book.

## 90-second judge click path

### 0:00–0:15 — Landing story (`/`)

1. Start on the hero: **“The operator desk that turns Solana prediction markets into briefed, executable decisions.”**
2. Point out that the composed desk and scroll journey are labeled **Illustrative**; live market data begins inside the desk.
3. Click **Enter the desk →**.

**Say:** “The landing teaches one path — Intel → Brief → Execute → Book — without presenting staged odds as live.”

### 0:15–0:32 — Live catalog (`/desk`)

1. Keep the phase filter on **All phases**.
2. Let the default ordering show labeled, priced, active markets first.
3. Open a titled market with a visible price. If a row remains thin, call out **Untitled market** or **No price yet** rather than treating an ID or zero as content.

**Say:** “This catalog is the live Panta `GET /markets/` response. Panta list rows are often sparse, so Brief Command hydrates visible rows from market detail and still leaves genuinely missing titles or prices explicit.”

### 0:32–0:53 — Detail, brief, and tape honesty (`/markets/[marketId]`)

1. Show the market question, phase, end time, context, oracle, and live YES/NO spot.
2. Show the auto-generated desk brief; switch Bull / Neutral / Bear only if time permits.
3. Point to the tape and tape-implied chart.
   - If trades exist, show the real prints.
   - If the tape is quiet, keep **No prints yet** on screen and say so.

**Say:** “The brief uses live market detail and trade prints. Blank spot means not priced yet; a quiet tape stays quiet. The app does not invent prints or OHLC.”

### 0:53–1:16 — Quote to attribution (`/execute`)

1. Open **Execute**, select the same market, choose YES or NO, and set a small USDC amount.
2. Click **Connect wallet to quote** and choose Phantom or Solflare.
3. In **Guided** mode, explain the single path before pressing **Buy · Quote → Attribute**:
   - **Quote:** Panta returns shares, average price, fee, and expiry.
   - **Build:** Panta returns transaction instructions and a recent blockhash — an unsigned transaction path.
   - **Sign:** the connected wallet signs locally.
   - **Broadcast:** the client sends the signed transaction to Solana.
   - **Submit + Verify:** the signature and order are reported back to Panta and verified.
   - **Attribute:** `POST /trades/` associates the live fill with this partner API key; `GET /account/trades/` is the read-back surface.
4. Only complete the buy when a funded demo wallet and a real market are prepared. Otherwise, show the quote path and do not imply a fill occurred.

**Say:** “Brief Command never receives a seed phrase or private key and never custodies funds. The wallet is the signer; the server proxy keeps the Panta API key out of the browser.”

### 1:16–1:30 — Book and empty-state honesty (`/book`)

1. Open **Book**.
2. If disconnected, show the explicit connect prompt. If connected with no positions, show **No positions yet**.
3. Show **Activity · attributed trades**. It may honestly be empty until a live transaction has been broadcast and attributed.
4. Mention that **Mark** is spot × shares, not profit and loss; there is no cost-basis P&L.

**Close:** “The same live lifecycle remains visible end to end: discovery, evidence, wallet-owned execution, attribution, and book — with missing upstream data shown as missing.”

## What judges should notice

| Surface | Panta integration | Proof in the product |
| --- | --- | --- |
| Markets | `GET /markets/`, `GET /markets/{id}/`, `GET /categories/`, `GET /markets/{id}/trades/` | Live catalog, hydrated detail, odds, context, and tape |
| Quote | `POST /primaryorderquote/` | Shares, average price, fee, slippage, and quote expiry |
| Unsigned transaction | `POST /primaryorderbuild/` | Instructions + recent blockhash are assembled into a versioned transaction client-side |
| Wallet + broadcast | Wallet adapter + Solana RPC | Phantom/Solflare signs locally; the browser broadcasts and exposes the signature/Solscan link |
| Report + verify | `POST /primaryordersubmit/`, `POST /primaryorderverify/` | Panta receives the order/signature report and verifies the primary order |
| Attribute | `POST /trades/`, `GET /account/trades/` | Partner-attributed buy/claim activity appears only after a real report succeeds |
| Book + claims | `GET /positions/?wallet=`, `POST /claim/build/`, `POST /claim/creator-fees/build/` | Wallet positions and wallet-signed claim broadcasts |
| Key boundary | Next.js `/api/panta/*` proxy with `X-Api-Key` | `PANTA_API_KEY` remains server-side; browser requests never contain it |

## Honest limits

- **Sparse catalog data:** most current Panta list rows can have empty titles/descriptions and null prices. Detail hydration improves the first screen, but truly absent values remain **Untitled market** / **No price yet**.
- **No cost-basis P&L:** Book can show shares and a live notional mark (spot × shares), not realized/unrealized P&L.
- **Attribution starts empty:** attributed trades remain empty until a real fill is broadcast and a successful `POST /trades/` lands for this API key.
- **Quiet tape stays quiet:** no mock trades, candles, or fake activity are inserted.
- **Execution scope:** the desk focuses on primary buys; secondary-market routing is out of scope.

## Dual-submit reminders

Submit the same project to both destinations:

- [ ] **Official Colosseum Crypto World’s Fair** — select/identify the **Panta API Sidetrack** in the official project submission.
- [ ] **Superteam Earn — Panta API Side Track:** <https://superteam.fun/earn/listing/panta-api-side-track>
- [ ] Confirm every team member is registered on Colosseum before the cutoff.
- [ ] Recheck both submission pages after saving; one submission does not automatically complete the other.

**Deadline:** 13 Oct 2026, 06:59 UTC (**12:29 PM IST**). This corresponds to 12 Oct 2026, 11:59 PM PT in the official Colosseum rules. Submit early and re-check the live listings in case the organizers amend requirements.

## Suggested video beats (no filming required here)

1. **0–8s — Hook:** hero promise, Powered by Panta, composed desk.
2. **8–22s — Live proof:** enter `/desk`; keep All phases; open the first strong titled/priced market.
3. **22–38s — Intelligence:** detail odds, context, generated brief, real or explicitly quiet tape.
4. **38–62s — Execution architecture:** quote card, six progress chips, wallet modal/sign request, signature/Solscan. Use a prepared funded wallet only for a real fill.
5. **62–76s — Attribution proof:** success toast and the attributed activity row; if there is no live fill, show the honest empty ledger instead of staging one.
6. **76–86s — Book:** positions/claim surface; explain Mark ≠ P&L and wallet-signed claims.
7. **86–90s — Close:** repo URL, live demo URL when deployed, “Wallet signs; Brief Command never custodies.”

**Capture notes:** record at 1440×900 or 1920×1080, enlarge the pointer, preload the catalog, use one prepared market ID, hide notifications, and keep the final cut under the limit shown by each submission form.
