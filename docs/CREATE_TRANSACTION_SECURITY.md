# Create Market: transaction security review (Phase 3, Stages A and B)

Status: **Stage A complete. Signing stays disabled** (`CREATE_SIGNING_ENABLED = false` in
`src/lib/panta/create-flow.ts`). Nothing in this review was signed, broadcast or paid.
No market was created. Captured 2026-10-06 against `https://live-api.panta.market/api/v1`
with the production partner key (never printed) and a read-only test wallet.

Fixture: `test/fixtures/create-build.live-2026-10-06.json` holds three real quote+build
pairs (Breaking, Standard, Breaking with the event already in progress) plus the on-chain
`MarketConfig` account bytes. `userId` / `apiKeyId` were removed. The Cloudinary upload
signature and API key were never stored.

## 1. Endpoints (confirmed in the docs, in the playground source, and with live calls)

| Step | Endpoint | Our proxy route | Per-IP limit/min |
| --- | --- | --- | --- |
| Image grant | `POST /markets/create/image-upload/` (body `{}`) | `create.imageUpload` | 10 |
| Quote | `POST /markets/create/quote/` | `create.quote` | 10 |
| Build | `POST /markets/create/build/` `{ createId, wallet }` | `create.build` | 6 |
| Register | `POST /markets/register/` `{ createId, signature }` | `create.register` | 10 |

Each route is an exact regex, POST only, and has its own rate-limit bucket. Bodies are
validated with zod `strictObject` on the server **before** the server key is used
(`src/lib/panta/create-requests.ts`), and only the parsed body is forwarded. The proxy
removes `userId` / `apiKeyId` from create responses. `GET /api/schema/` lists the paths
without body schemas.

## 2. Image upload

The grant returns `{ uploadUrl, publicId, expiresAt (~5 min), fields }`, where `fields` =
`folder, overwrite, public_id, timestamp, upload_preset ("panta-market-api-signed"),
api_key, signature`. The browser POSTs `multipart/form-data` (fields + `file`) **directly**
to `https://api.cloudinary.com/v1_1/dyvupboym/image/upload`. Image bytes never pass
through our JSON proxy, and our server never fetches a URL it was handed.

The client checks the following:

* `parseImageUploadGrant`: the upload URL must equal the pinned Cloudinary endpoint;
  `publicId` must match `balr-market/events/<id>/<id>` and equal `folder + "/" + public_id`;
  the grant must not be expired; fields must be primitive, the required keys must be
  present, and no `file` key is allowed.
* File: PNG/JPEG/WebP only, at most 5 MB.
* `parseCloudinaryUpload`: `public_id` must equal the grant's, `resource_type` must be
  `image`, the format must be allowed, and `secure_url` must be exactly
  `https://res.cloudinary.com/dyvupboym/image/upload/v<n>/<publicId>.<ext>`.
* On the server, the quote's `imageUrl` must pass the same exact delivery-path regex
  (`isAllowedImageUrl`).

**CSP change:** `connect-src` is now `'self' https://api.cloudinary.com/v1_1/dyvupboym/image/upload`.
This single path-pinned origin is the only addition. `test/p3-hardening.test.ts` still
asserts the exact directive.

## 3. Quote (live, account ids removed)

```json
{ "createId": "cr_3e37a805b2274a0a9e999f903679bb1d",
  "expectedEventPda": "54PEvqk2ZZEm4y2CGeSAdhggezwnnmsn9RxfL6VqyrLg",
  "paymentUsdc": "20000000", "liquidityInjectionUsdc": "5000000",
  "platformRevenueUsdc": "15000000", "marketType": "breaking",
  "expiresAt": "2026-10-06T06:19:42.967368Z", "blockhashExpiryHintSec": 60 }
```

The live Standard quote was `50000000 / 10000000 / 40000000`. The UI never hard-codes
amounts; it displays the live quote. `bindCreateQuote` blocks the quote if any of these
fail:

* the market type matches the request;
* `expectedEventPda` equals `PDA("event_usdc", wallet, sha256(question))`;
* liquidity + platform = payment, and payment > 0;
* the quote has not expired.

## 4. Build fields

`createId, expectedEventPda, transaction (base64), recentBlockhash, lastValidBlockHeight,
blockhashExpiryHintSec, buildFingerprint (64 hex), paymentUsdc, liquidityInjectionUsdc,
platformRevenueUsdc, marketType, expiresAt (~2 min), derived { event, vaultAuthority,
marketConfig, creatorWhitelist, creatorFeeVault, creatorPosition, creatorTokenAccount,
vaultTokenAccount, treasuryTokenAccount }`.

Every one of these fields is required, so a missing field blocks signing.

## 5. Transaction (decoded from the real builds)

* v0 message with no address lookup tables. Header `{ requiredSignatures: 1, readonlySigned: 0, readonlyUnsigned: 8 }`.
* There is exactly one signature slot and it is empty. **The fee payer is the creator
  wallet (static key 0), and it is the only signer.**
* There are 17 static keys. Their order varies between builds, so the validator matches
  keys by value, not by position.
* The transaction has two instructions:
  1. `ComputeBudget111…` `SetComputeUnitLimit(400000)` (data `02801a0600`).
  2. `6gM5afTQBq5VZCfgpGqcsqzfWd5maLSCKWtGjbEobZMp` (Panta USDC program) `create_breaking_event_usdc`
     (discriminator `19674bc6e0492c45`) or `create_event_usdc` (`5009ccd596db57a2`).
* Args (Borsh): `event_start_time i64, end_time i64, resolution_time i64, question string,
  payment_usdc u64, resolution_rule string, source_of_truth vec<string>` and, for Breaking
  only, `event_in_progress bool`.

### Accounts (IDL order; all are re-derived by `deriveCreateAccounts`)

| # | Account | Flags | Derivation |
| --- | --- | --- | --- |
| 0 | creator | signer, writable | the connected wallet |
| 1 | market_config | — | `PDA("market_config")` = `8mJjfx7S…` |
| 2 | creator_whitelist | — | `PDA("creator_whitelist")` |
| 3 | event | writable | `PDA("event_usdc", creator, sha256(question))` |
| 4 | vault_authority | writable | `PDA("vault_usdc", creator, sha256(question))` |
| 5 | vault_token_account | writable | `ATA(vault_authority, USDC)` |
| 6 | creator_fee_vault | writable | `PDA("creator_fee_vault_usdc", event)` |
| 7 | creator_fee_vault_token_account | writable | `ATA(creator_fee_vault, USDC)` |
| 8 | creator_position | writable | `PDA("position", event, creator)` |
| 9 | usdc_mint | — | `EPjFWdd5…Dt1v` |
| 10 | creator_token_account | writable | `ATA(creator, USDC)` |
| 11 | treasury_token_account | writable | `ATA(MarketConfig.treasury, USDC)` = `9hwZLD2J…` |
| 12–14 | Token, Associated Token, System programs | — | fixed ids |

These derivations reproduce Panta's `derived` map exactly in all three captures.

## 6. Payment binding: proven structurally

* `payment_usdc` is an explicit `u64` argument in the instruction. The validator requires
  it to equal the quote **and** the build's `paymentUsdc`.
* The on-chain `MarketConfig` (356 bytes, discriminator `77ffc858fc528018`, owner = the
  Panta program) currently stores `breaking 20000000 / 5000000`, `regular 50000000 / 10000000`,
  `minimum_start_delay 3600`. The program rejects any other amount with IDL error **6107
  `InvalidCreationPayment`** ("USDC payment does not match the fixed price for this market
  tier").
* Before signing, `verifyPaymentOnChain` reads `MarketConfig` through our RPC relay. It
  requires the owner, discriminator and USDC mint to match, and the tier price and
  liquidity to equal the quote. If the RPC call fails, signing stays blocked.
* The payment destinations (vault token account and treasury ATA) are fixed accounts that
  are re-derived from public seeds and from the config's treasury.
* No SOL or token transfer instruction, extra program, extra signer, or extra account is
  allowed.

**Residual trust:** the USDC transfer is a CPI inside the Panta program, so its internal
split logic and the program's upgrade authority are trusted. We do not reproduce them.
Recommendation for Stage B: add a pre-sign `simulateTransaction` (sigVerify off) that
requires the creator's USDC delta to equal exactly `-paymentUsdc`. That simulation needs a
funded wallet. During discovery, simulation failed with "insufficient funds" (≈117k CU
used).

## 7. Validator rules (`verifyCreateTransaction`, `checkCreateBuildMetadata`)

Signing is blocked if **any** of the following fail:

* The base64 decodes; size ≤ 1232 bytes; v0; no address lookup tables.
* Exactly one required signature, and it is unsigned (all zero).
* The fee payer is the wallet; no duplicate static keys; no unreferenced static keys.
* The blockhash equals the build's `recentBlockhash`.
* Instructions: at most 3; only ComputeBudget plus exactly one Panta create instruction,
  which comes last.
* Compute Budget: unit limit ≤ 600000; priority fee ≤ 0.005 SOL.
* The discriminator matches the quoted type. Borsh decoding is strict, with no trailing
  bytes. `question`, times, `resolution_rule`, `source_of_truth` and `event_in_progress`
  equal the reviewed input byte for byte, and `payment_usdc` equals the quote.
* The 15 accounts and their signer/writable flags equal the derived layout exactly, and
  the per-key header flags agree.
* Metadata: `createId`, `expectedEventPda`, `marketType` and payment/liquidity/platform all
  equal the quote; the build and the quote have not expired (5 s margin); the derived map
  equals our derivation.
* Immediately before signing (`preSignCreateCheck`): the wallet is unchanged, the inputs
  are unchanged (by fingerprint), the quote has not expired, mainnet genesis is confirmed,
  and the on-chain price matches.
* Registration uses only the frozen `{createId, signature}` pair. Retrying sends the
  identical body and never rebuilds. The response must echo the same `createId` and
  signature, have `marketId === expectedEventPda`, and have `status === "registered"`.

## 8. Input rules (client and server, `src/lib/panta/create-rules.ts`)

* Question 10–512 characters; rule 20–2048; 1–5 https sources in the UI (20 on the server
  side), each ≤ 512 characters. Source URLs may not be IP literals, localhost, or carry
  credentials. No oracle field.
* Timeline: start < end ≤ resolution. Breaking (not in progress): start ≥ now + 1 h and
  ≤ now + 72 h (on-chain `minimum_start_delay`, IDL 6008 / 6090). Breaking in progress:
  start ≤ now < end. Standard: start ≥ now + 72 h (our product rule, so that Standard
  and Breaking do not overlap), and `event_in_progress` is not allowed.
* **Transaction-size budget:** for the observed builds, transaction bytes = 728 (Breaking)
  or 727 (Standard) + question + rule + Σ(source + 4). Panta returned a **1239-byte**
  transaction for long text, which is over Solana's 1232-byte packet limit, so Panta's
  build does not check size. The UI therefore enforces a 500-byte on-chain text budget
  with a live meter, and the validator rejects any transaction over 1232 bytes.

## 9. Findings to flag

* The CSP adds one path-pinned Cloudinary upload endpoint (see §2).
* Panta's build does not enforce the transaction-size limit (see §8).
* The upstream intermittently returned `INVALID_MARKET_PARAMS` ("unexpected create
  quote/build failure") for a valid request with 2 sources. The same input succeeded on
  retry. The UI shows the upstream error and the user can retry the step.
* Side observation, out of scope: the vault authority's seeds are
  `("vault_usdc", creator, sha256(question))`. This could close the "*a* vault authority,
  not *this market's*" known limit in claim checks. The primary and claim code is
  **unchanged** in Stage A.

## 10. Stage A verdict

**SAFE TO PROCEED to Stage B (enable signing behind review)**, with these conditions:

* Every program, instruction, account, signer and the fee payer are identified, and none
  are unknown.
* The payment is an explicit, quote-bound and config-bound argument that the program
  enforces.
* Keep the residual trust in the Panta program (CPI transfer, upgrade authority) and add
  the simulation delta check before enabling signing.

## 11. Stage B: simulation as defense in depth (`src/lib/panta/create-simulation.ts`)

The structural validator (§7) stays authoritative. Simulation is an *additional* gate:
if it cannot prove everything below, signing is blocked. "Simulation unavailable" never
means "continue".

### Request

`simulateTransaction(tx, { encoding: "base64", sigVerify: false, replaceRecentBlockhash:
false, commitment: "confirmed", innerInstructions: true, accounts: { encoding: "base64",
addresses: [wallet, creatorUsdcAccount] } })`. These are the exact validated bytes:
the blockhash is not replaced and signatures are not checked (the transaction is unsigned).

### Discovery (read-only, 2026-10-06 12:20 IST, public mainnet RPC)

Two fresh real builds were simulated, and nothing was signed. The fixtures are in
`test/fixtures/create-sim.live-2026-10-06.json`.

* **Funded public wallet** `5tzFkiKs…uAi9` (creator pubkey only, read-only). Result:
  `err: null`, 137 203 CU.
  * Logs: `Program 6gM5… invoke [1]` → `Instruction: CreateBreakingEventUsdc` → `success`.
  * Creator USDC `preTokenBalances` 1 950 381 799 767 → `postTokenBalances`
    1 950 361 799 767, i.e. **exactly −20 000 000**.
  * Inner `spl-token transfer`s with authority = wallet, source = the creator ATA:
    5 000 000 to the vault token account and 15 000 000 to the treasury token account.
  * 6 `system createAccount`s funded by the wallet: event (space 2982), vault authority,
    vault ATA, fee vault, fee-vault ATA, position. Total rent 22 250 400 lamports.
  * Wallet SOL delta −22 255 400 = fee 5 000 + rent.
* **Test wallet** `41Vs…aGZ` (1.54 USDC). The Token program returned
  `Error: insufficient funds` (`0x1`), and the fee was still charged in simulation.
  This maps to **Insufficient USDC**.

The RPC returns every field needed (`err`, `logs`, `fee`, pre/post SOL balances,
pre/post token balances with owner/mint/programId, parsed inner instructions, account
post-state) from **one bank/slot**. Pre and post therefore cannot race each other.

### What `analyzeCreateSimulation` requires (each missing item → blocked)

1. `err === null`. An error maps to Insufficient USDC, Insufficient SOL, an expired
   blockhash, the event account already existing, or a generic failure.
2. Logs present and not truncated. Panta `invoke [1]` → the expected instruction name →
   `success`, in that order. The only other top-level program allowed is Compute Budget.
   No log line may contain ` failed: `.
3. Pre/post SOL balances for every static key.
4. Creator USDC account: exactly one pre and one post token-balance entry, with mint
   USDC, owner the wallet, decimals 6, and the classic Token program. **post − pre ===
   −payment exactly**, as bigint base units. This is cross-checked against the decoded
   account post-state.
5. No other wallet-owned token balance decreases.
6. Inner-instruction allowlist. Panta's self-CPI event log is skipped. Otherwise only:
   * system `createAccount` from the wallet, for one of the 6 expected accounts, each
     once, owned by Panta or Token, on a previously empty account, with lamports ≤
     (space + 128) × 6960;
   * ATA create / createIdempotent for the 2 expected token accounts;
   * Token `getAccountDataSize`, `initializeImmutableOwner`, `initializeAccount3` for
     those accounts;
   * Token `transfer` / `transferChecked` from the creator ATA with authority = wallet,
     to the vault or the treasury only.

   Anything else is blocked.
7. The transfers sum to the payment, the vault receives the liquidity portion and the
   treasury the platform portion. Total rent ≤ 0.05 SOL.
8. `fee` ≤ the fee computed from the message (signatures × 5000 + priority).
   **Wallet SOL delta === −(fee + rent) exactly.**

The exact USDC delta **is proven** by item 4 and corroborated by items 6 and 7.

### Limits (explicit)

* **Token-2022 / other token accounts.** The runtime can only write to accounts listed
  in the transaction. The validator pins every static key and allows no lookup tables,
  and the creator's classic USDC ATA is the only wallet-owned token account in the list.
  No Token-2022 account of the wallet *can* be touched. Token-balance entries for any
  other wallet-owned account must not decrease (item 5).
* Simulation runs against the RPC's bank at one slot. The real execution can differ
  if state changes in between, for example a concurrent spend from the same wallet.
  The program still enforces the payment (§6), and the post-sign confirmation is what
  matters. Simulation is defense in depth, not a guarantee.
* The analysis trusts the RPC's report. The relay forwards it to the configured
  provider (public mainnet in local development).
* The wallet's signature is not cryptographically verified client-side. Only the
  message bytes and the presence of exactly one non-zero 64-byte signature are checked.
  An invalid signature fails at preflight or on chain.

## 12. Stage B: flow (`create-flow.ts`, `create-machine.ts`, `create-recovery.ts`)

* **State machine:** DEFINE → QUOTED → BUILT → VALIDATED → SIMULATED → REVIEW →
  WALLET_APPROVAL → BROADCAST → CONFIRMATION → CONFIRMED_ON_CHAIN → REGISTER → SUCCESS.
  There is also REGISTRATION_NEEDS_ATTENTION ⇄ RETRY_REGISTER → SUCCESS. No phase after
  a possible broadcast can reach a build or signing phase (tested).
* **Final check** (before simulation and again immediately before the wallet opens):
  * mainnet genesis;
  * same wallet, inputs, createId, PDA, type and exact payment;
  * quote and build unexpired with a 5 s margin;
  * full validator, including ≤ 1232 bytes;
  * on-chain tier price === payment;
  * USDC ≥ payment and SOL ≥ fee + simulated rent (no buffer).

  The review snapshot (including the sha-256 of the transaction bytes) must match the
  simulated one. On any mismatch signing is blocked, with no silent requote.
* **Signing:** the validated bytes are deserialized and signed. The signed message must
  be byte-equal to the validated message, otherwise nothing is broadcast. A wallet
  rejection is a normal terminal state (nothing is persisted or sent).
* **Persist, then broadcast:** a recovery record `{createId, signature, PDA, blockhash
  window, …}` is written to localStorage (keyed by wallet) *before* `sendRawTransaction`
  (preflight on, no skipPreflight). If the write fails, the UI says so and shows the
  signature. A send error or a different returned signature is **uncertain**, not failure.
* **Confirmation:** uses the existing `confirmSignature` (`getSignatureStatuses` +
  `getBlockHeight` against `lastValidBlockHeight`). The outcomes are:
  * confirmed;
  * failed on chain (record cleared);
  * expired: only terminal if the event PDA account does not exist, otherwise uncertain;
  * pending, timeout or RPC error → uncertain, with **Check status**
    (`checkSignatureOnce` + event account). A createId that was signed is never signed
    again in the page, and while a record exists no new creation can be signed for
    that wallet.
* **Register** sends exactly `{createId, signature}` from the record. The response must
  have the same createId, the same signature if echoed, marketId === the expected
  event PDA, and status `registered`. Failure → needs attention (persisted). Retry is
  single-flight with the same pair and never quotes, builds, simulates, signs or
  broadcasts.
* **Success** invalidates the catalog, market, positions, USDC and trades queries. It
  adds no catalog row. If the market is not yet in Panta's catalog the UI shows
  "Created successfully · waiting for Panta indexing".

## 13. Relay change (deliberate)

`/api/rpc` now also allows `simulateTransaction`, scoped by `checkSimulateParams`:
* exactly `[base64 tx ≤ 1232 decoded bytes, config]`;
* config keys limited to encoding / sigVerify / replaceRecentBlockhash / commitment /
  innerInstructions / accounts / minContextSlot;
* `encoding: base64`, `sigVerify: false`, `replaceRecentBlockhash: false`;
* `accounts`: base64 with ≤ 4 pubkeys.

Anything else gets a 400 before the upstream. The rate limits, body limit and batch
cap are unchanged. No other relay behavior changed.

## 14. Stage B remaining risks

* **Program trust.** The Panta program and its upgrade authority are trusted. The
  payment is a program-enforced argument, and simulation confirms the current program's
  behavior only.
* **Genesis cache.** `checkMainnet` caches a successful genesis check per endpoint, so
  the "recheck" is a cached comparison after the first success.
* **Registration timing.** Register can fail with `CREATE_EXPIRED` if it happens after
  Panta's ~5-minute session. The transaction is still on chain; recovery shows *needs
  attention*.
* **Recovery storage.** The recovery record is per browser (localStorage). Another
  browser or a cleared storage loses it, although the signature is shown on screen.
* **Upstream flakiness.** The upstream intermittently returns `INVALID_MARKET_PARAMS`.
  This is shown to the user, with no automatic retry.
