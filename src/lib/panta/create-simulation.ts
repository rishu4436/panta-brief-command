/**
 * Create Market: balance pre-checks and simulation evidence (defense in
 * depth on top of the structural validator in create-market.ts, which stays
 * mandatory and authoritative).
 *
 * Evidence source (read-only discovery, 6 Oct 2026, mainnet RPC apiVersion
 * 4.3.0, sigVerify false, nothing signed): `simulateTransaction` with
 * `innerInstructions: true` returns, from ONE simulated bank/slot:
 *   err, logs, fee, unitsConsumed, preBalances / postBalances (lamports per
 *   static key), preTokenBalances / postTokenBalances (token accounts in the
 *   message, with owner + mint + exact base-unit amount), jsonParsed inner
 *   instructions, and the post-state of requested `accounts`.
 * Pre and post therefore come from the same slot: no cross-call race.
 * See docs/CREATE_TRANSACTION_SECURITY.md §11.
 *
 * Rules (all must hold, otherwise signing is blocked — never "continue
 * without simulation"):
 *  - err === null, the Panta create instruction is invoked at depth 1, logs
 *    the expected Anchor instruction name and succeeds; logs not truncated;
 *  - creator USDC account: pre − post === paymentUsdc EXACTLY (base units),
 *    cross-checked against the requested post-state account data;
 *  - no other wallet-owned token account changes. Proof is structural: the
 *    runtime only lets a transaction write accounts it lists, the validator
 *    pins the list (no lookup tables) to the 15 derived accounts, and the
 *    creator's USDC ATA is the only wallet-owned token account in it — so no
 *    Token or Token-2022 account of the wallet outside the list can move.
 *    The simulation additionally shows no other wallet-owned token balance
 *    falling;
 *  - every inner instruction is on an allowlist: system createAccount paid
 *    by the wallet for one of the six expected new accounts (pre-balance 0,
 *    rent-bounded), ATA create for the two expected vault token accounts,
 *    SPL init helpers, and USDC transfers from the creator's account to the
 *    vault / treasury that add up to the payment; anything else fails;
 *  - wallet SOL: pre − post === fee + Σ rent of those createAccounts EXACTLY.
 */

import { Buffer } from "buffer";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { sha256 } from "@/lib/sha256";
import { PANTA_USDC_PROGRAM_ID } from "./instructions";
import { SYSTEM_PROGRAM, TOKEN_PROGRAM, ATA_PROGRAM, USDC_MINT, COMPUTE_BUDGET_PROGRAM } from "./primary-order";
import { formatUsdcBaseUnits, type CreateAccounts } from "./create-market";
import type { CreateMarketType } from "./create-rules";

/** Protocol base fee per signature (lamports). */
export const BASE_FEE_PER_SIGNATURE = BigInt(5_000);
/**
 * Upper bound on the rent the creator may fund for the six new accounts.
 * Observed in simulation (funded read-only creator): 22 250 400 lamports
 * (≈0.0223 SOL) for 6 accounts at (space + 128) × 5 080 lamports. 0.05 SOL leaves room for a rent change but
 * caps any surprise.
 */
export const CREATE_MAX_RENT_LAMPORTS = BigInt(50_000_000);
/** Historic (pre-2026) rent-exempt rate; current mainnet is lower. Per-account upper bound: (space + 128) × this. */
const RENT_RATE_UPPER = BigInt(6_960);
const ACCOUNT_STORAGE_OVERHEAD = BigInt(128);
const MAX_ACCOUNT_SPACE = 10_240;

export class SimulationBlocked extends Error {}

const blocked = (why: string) => ({ ok: false as const, reason: `${why} Signing blocked.` });

// ---------------------------------------------------------------------------
// Fee + balances
// ---------------------------------------------------------------------------

/** Exact fee the message will pay: base fee per required signature + priority fee (ceil). */
export function messageFeeLamports(txBase64: string): bigint {
  const tx = VersionedTransaction.deserialize(Buffer.from(txBase64, "base64"));
  const m = tx.message;
  const keys = m.staticAccountKeys.map((k) => k.toBase58());
  let limit: bigint | null = null;
  let price = BigInt(0);
  for (const ci of m.compiledInstructions) {
    if (keys[ci.programIdIndex] !== COMPUTE_BUDGET_PROGRAM) continue;
    const d = Buffer.from(ci.data);
    if (d[0] === 2 && d.length === 5) limit = BigInt(d.readUInt32LE(1));
    if (d[0] === 3 && d.length === 9) price = d.readBigUInt64LE(1);
  }
  const units = limit ?? BigInt(200_000 * m.compiledInstructions.length);
  const priority = (price * units + BigInt(999_999)) / BigInt(1_000_000);
  return BASE_FEE_PER_SIGNATURE * BigInt(m.header.numRequiredSignatures) + priority;
}

/** SPL token account (165 bytes, classic Token program): mint @0, owner @32, amount u64 @64. */
export function decodeTokenAccount(data: Uint8Array): { mint: string; owner: string; amount: bigint } | null {
  const b = Buffer.from(data);
  if (b.length < 72) return null;
  return { mint: new PublicKey(b.subarray(0, 32)).toBase58(), owner: new PublicKey(b.subarray(32, 64)).toBase58(), amount: b.readBigUInt64LE(64) };
}

export type BalanceReader = {
  getAccountInfo(k: PublicKey): Promise<{ lamports: number; owner: PublicKey; data: Uint8Array | Buffer } | null>;
};

export type Balances = { lamports: bigint; usdcBase: bigint };

/** Read wallet SOL and the creator USDC account (the only USDC account the transaction can debit). RPC failure throws. */
export async function readCreateBalances(rpc: BalanceReader, wallet: string, creatorTokenAccount: string): Promise<Balances> {
  const [w, t] = await Promise.all([rpc.getAccountInfo(new PublicKey(wallet)), rpc.getAccountInfo(new PublicKey(creatorTokenAccount))]);
  const lamports = BigInt(w?.lamports ?? 0);
  let usdcBase = BigInt(0);
  if (t) {
    if (t.owner.toBase58() !== TOKEN_PROGRAM) throw new SimulationBlocked("Your USDC account is not a standard token account. Signing blocked.");
    const acc = decodeTokenAccount(t.data);
    if (!acc || acc.mint !== USDC_MINT || acc.owner !== wallet) throw new SimulationBlocked("Your USDC account could not be read. Signing blocked.");
    usdcBase = acc.amount;
  }
  return { lamports, usdcBase };
}

export const INSUFFICIENT_USDC = "Insufficient USDC";
export const INSUFFICIENT_SOL = "Insufficient SOL for network fee";

/** Exact comparison, no buffer: USDC ≥ payment; SOL ≥ fee (+ rent once known from simulation). */
export function balanceProblem(b: Balances, paymentBase: bigint, feeLamports: bigint, rentLamports: bigint = BigInt(0)): string | null {
  if (b.usdcBase < paymentBase) {
    return `${INSUFFICIENT_USDC}: this creation needs ${formatUsdcBaseUnits(paymentBase)} USDC and your wallet holds ${formatUsdcBaseUnits(b.usdcBase)} USDC.`;
  }
  const needSol = feeLamports + rentLamports;
  if (b.lamports < needSol) {
    return `${INSUFFICIENT_SOL}${rentLamports > BigInt(0) ? " and account rent" : ""}: needs ${lamportsToSol(needSol)} SOL, wallet holds ${lamportsToSol(b.lamports)} SOL.`;
  }
  return null;
}

export function lamportsToSol(l: bigint): string {
  const whole = l / BigInt(1_000_000_000);
  const frac = (l % BigInt(1_000_000_000)).toString().padStart(9, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

// ---------------------------------------------------------------------------
// Simulation request + analysis
// ---------------------------------------------------------------------------

/** JSON-RPC params for simulateTransaction: the exact validated bytes, no blockhash replacement, signatures not verified (unsigned). */
export function createSimulationParams(txBase64: string, wallet: string, creatorTokenAccount: string): [string, Record<string, unknown>] {
  return [
    txBase64,
    {
      encoding: "base64",
      sigVerify: false,
      replaceRecentBlockhash: false,
      commitment: "confirmed",
      innerInstructions: true,
      accounts: { encoding: "base64", addresses: [wallet, creatorTokenAccount] },
    },
  ];
}

type TokenBal = { accountIndex: number; mint: string; owner?: string; programId?: string; uiTokenAmount: { amount: string; decimals: number } };
type Parsed = { program?: string; programId: string; parsed?: { type?: string; info?: Record<string, unknown> }; stackHeight?: number | null };

export type SimEvidence = Readonly<{
  txHash: string;
  slot: number;
  unitsConsumed: number | null;
  feeLamports: bigint;
  rentLamports: bigint;
  walletSolDelta: bigint;
  usdcPre: bigint;
  usdcPost: bigint;
  usdcDelta: bigint;
  transfers: readonly { destination: string; amount: bigint }[];
  createdAccounts: readonly string[];
  instructionLog: string;
}>;

export type SimulationContext = {
  txBase64: string;
  wallet: string;
  accounts: CreateAccounts;
  marketType: CreateMarketType;
  paymentBase: bigint;
  liquidityBase: bigint | null;
  platformBase: bigint | null;
};

export function txHash(txBase64: string): string {
  return Buffer.from(sha256(Buffer.from(txBase64, "base64"))).toString("hex");
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const U64_RE = /^\d{1,20}$/;
const big = (v: unknown): bigint | null => (typeof v === "string" && U64_RE.test(v) ? BigInt(v) : typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? BigInt(v) : null);

const INSTRUCTION_NAME: Record<CreateMarketType, string> = { breaking: "CreateBreakingEventUsdc", standard: "CreateEventUsdc" };

/**
 * Analyse a raw simulateTransaction JSON-RPC `result` ({ context, value }).
 * Returns the evidence or the reason signing is blocked. Missing evidence
 * is a failure, never a pass.
 */
export function analyzeCreateSimulation(raw: unknown, ctx: SimulationContext): ({ ok: true } & { evidence: SimEvidence }) | { ok: false; reason: string } {
  if (!isObj(raw) || !isObj(raw.value) || !isObj(raw.context)) return blocked("Simulation returned no result.");
  const slot = raw.context.slot;
  if (typeof slot !== "number") return blocked("Simulation returned no slot.");
  const v = raw.value;

  // --- outcome
  if (v.err !== null) {
    const errText = JSON.stringify(v.err ?? "missing").slice(0, 160);
    const logs = Array.isArray(v.logs) ? (v.logs as unknown[]).filter((l): l is string => typeof l === "string") : [];
    if (logs.some((l) => /insufficient funds/i.test(l))) return blocked(`${INSUFFICIENT_USDC}: simulation failed with "insufficient funds".`);
    if (logs.some((l) => /insufficient lamports/i.test(l)) || /InsufficientFundsForFee|InsufficientFundsForRent/.test(errText)) {
      return blocked(`${INSUFFICIENT_SOL} and account rent: simulation could not pay them.`);
    }
    if (/BlockhashNotFound/.test(errText)) return blocked("Simulation: the build's blockhash is no longer valid. Rebuild.");
    if (/AccountAlreadyInUse|already in use/i.test(errText) || logs.some((l) => /already in use/i.test(l))) {
      return blocked("Simulation: this market's event account already exists (same wallet + question was already created).");
    }
    return blocked(`Simulation failed (${errText}).`);
  }
  const logs = Array.isArray(v.logs) ? (v.logs as unknown[]) : null;
  if (!logs || logs.some((l) => typeof l !== "string")) return blocked("Simulation returned no program logs.");
  const L = logs as string[];
  if (L.some((l) => /log truncated/i.test(l))) return blocked("Simulation logs were truncated.");
  const P = PANTA_USDC_PROGRAM_ID;
  const iInvoke = L.indexOf(`Program ${P} invoke [1]`);
  const iName = L.indexOf(`Program log: Instruction: ${INSTRUCTION_NAME[ctx.marketType]}`);
  const iOk = L.lastIndexOf(`Program ${P} success`);
  if (iInvoke < 0 || iName < iInvoke || iOk < iName) return blocked(`Simulation logs do not show Panta's ${INSTRUCTION_NAME[ctx.marketType]} instruction running to success.`);
  if (L.filter((l) => / invoke \[1\]$/.test(l)).some((l) => l !== `Program ${P} invoke [1]` && l !== `Program ${COMPUTE_BUDGET_PROGRAM} invoke [1]`)) {
    return blocked("Simulation shows an unexpected top-level program.");
  }
  if (L.some((l) => / failed: /.test(l))) return blocked("Simulation logs show a failed program.");

  // --- static keys (same order as pre/postBalances)
  let keys: string[];
  try {
    keys = VersionedTransaction.deserialize(Buffer.from(ctx.txBase64, "base64")).message.staticAccountKeys.map((k) => k.toBase58());
  } catch {
    return blocked("Simulated transaction could not be decoded.");
  }
  const A = ctx.accounts;
  const W = ctx.wallet;
  if (keys[0] !== W) return blocked("Simulated fee payer is not your wallet.");

  // --- lamports
  const pre = Array.isArray(v.preBalances) ? (v.preBalances as unknown[]).map(big) : null;
  const post = Array.isArray(v.postBalances) ? (v.postBalances as unknown[]).map(big) : null;
  if (!pre || !post || pre.length !== keys.length || post.length !== keys.length || pre.some((x) => x == null) || post.some((x) => x == null)) {
    return blocked("Simulation did not return pre/post SOL balances for every account (needed to prove what leaves your wallet).");
  }
  const preB = pre as bigint[];
  const postB = post as bigint[];

  // --- token balances (same slot)
  const preT = Array.isArray(v.preTokenBalances) ? (v.preTokenBalances as TokenBal[]) : null;
  const postT = Array.isArray(v.postTokenBalances) ? (v.postTokenBalances as TokenBal[]) : null;
  if (!preT || !postT) return blocked("Simulation did not return token balances (needed to prove the exact USDC debit).");
  const ctaIndex = keys.indexOf(A.creatorTokenAccount);
  if (ctaIndex < 0) return blocked("Your USDC account is not in the simulated transaction.");
  const tb = (list: TokenBal[], idx: number) => list.filter((t) => isObj(t) && t.accountIndex === idx);
  const preC = tb(preT, ctaIndex);
  const postC = tb(postT, ctaIndex);
  if (preC.length !== 1 || postC.length !== 1) return blocked("Simulation did not report your USDC account balance before and after.");
  for (const t of [preC[0], postC[0]]) {
    if (t.mint !== USDC_MINT || t.owner !== W || !isObj(t.uiTokenAmount) || t.uiTokenAmount.decimals !== 6) return blocked("Simulated USDC account is not your USDC account.");
    if (t.programId !== undefined && t.programId !== TOKEN_PROGRAM) return blocked("Simulated USDC account is not a standard token account.");
  }
  const usdcPre = big(preC[0].uiTokenAmount.amount);
  const usdcPost = big(postC[0].uiTokenAmount.amount);
  if (usdcPre == null || usdcPost == null) return blocked("Simulated USDC balance is unreadable.");
  const usdcDelta = usdcPost - usdcPre;
  if (usdcDelta !== -ctx.paymentBase) {
    return blocked(`Simulated USDC change is ${formatSigned(usdcDelta)} base units, not exactly −${ctx.paymentBase} (the quoted payment).`);
  }
  // No other wallet-owned token account may change.
  const walletTokenIdx = new Set<number>();
  for (const t of [...preT, ...postT]) if (isObj(t) && t.owner === W) walletTokenIdx.add(t.accountIndex);
  for (const idx of walletTokenIdx) {
    if (idx === ctaIndex) continue;
    const a = tb(preT, idx)[0]?.uiTokenAmount?.amount ?? "0";
    const b = tb(postT, idx)[0]?.uiTokenAmount?.amount ?? "0";
    if (big(b) == null || big(a) == null || big(b)! < big(a)!) return blocked("Simulation shows another of your token accounts losing tokens.");
  }
  // Cross-check with the requested post-state accounts (wallet + USDC account).
  const accts = Array.isArray(v.accounts) ? (v.accounts as unknown[]) : null;
  if (!accts || accts.length !== 2) return blocked("Simulation did not return the requested account post-state.");
  const [wPost, cPost] = accts as (Record<string, unknown> | null)[];
  if (!isObj(wPost) || big(wPost.lamports) !== postB[0]) return blocked("Simulated wallet post-state is inconsistent.");
  if (!isObj(cPost) || cPost.owner !== TOKEN_PROGRAM || !Array.isArray(cPost.data) || cPost.data[1] !== "base64") return blocked("Simulated USDC account post-state is missing.");
  const decoded = decodeTokenAccount(Buffer.from(String(cPost.data[0]), "base64"));
  if (!decoded || decoded.amount !== usdcPost || decoded.owner !== W || decoded.mint !== USDC_MINT) return blocked("Simulated USDC account post-state disagrees with the token balances.");

  // --- inner instructions (allowlist)
  const inner = Array.isArray(v.innerInstructions) ? (v.innerInstructions as unknown[]) : null;
  if (!inner) return blocked("Simulation did not return inner instructions (needed to see every transfer).");
  const NEW = new Set([A.event, A.vaultAuthority, A.vaultTokenAccount, A.creatorFeeVault, A.creatorFeeVaultTokenAccount, A.creatorPosition]);
  const NEW_TOKEN = new Set([A.vaultTokenAccount, A.creatorFeeVaultTokenAccount]);
  const DEST = new Set([A.vaultTokenAccount, A.treasuryTokenAccount]);
  const created: string[] = [];
  let rent = BigInt(0);
  const transfers: { destination: string; amount: bigint }[] = [];
  for (const group of inner) {
    if (!isObj(group) || !Array.isArray(group.instructions)) return blocked("Simulation inner instructions are malformed.");
    for (const raw of group.instructions as unknown[]) {
      if (!isObj(raw) || typeof raw.programId !== "string") return blocked("Simulation inner instruction is malformed.");
      const ix = raw as Parsed;
      const type = ix.parsed?.type;
      const info = ix.parsed?.info ?? {};
      const pid = ix.programId;
      if (pid === P) continue; // Panta self-CPI (e.g. event emission): its effects are covered by the balance checks
      if (pid === SYSTEM_PROGRAM) {
        if (type !== "createAccount") return blocked(`Simulation shows an unexpected system instruction (${String(type ?? "unparsed")}).`);
        const src = info.source;
        const acct = String(info.newAccount ?? "");
        const lamports = big(info.lamports);
        const space = typeof info.space === "number" ? info.space : -1;
        if (src !== W) return blocked("Simulation shows an account funded by someone other than your wallet.");
        if (!NEW.has(acct) || created.includes(acct)) return blocked(`Simulation creates an unexpected account (${acct.slice(0, 8)}…).`);
        if (info.owner !== P && info.owner !== TOKEN_PROGRAM) return blocked("Simulation creates an account for an unexpected program.");
        if (lamports == null || space < 0 || space > MAX_ACCOUNT_SPACE) return blocked("Simulated account creation is unreadable.");
        if (lamports > (BigInt(space) + ACCOUNT_STORAGE_OVERHEAD) * RENT_RATE_UPPER) return blocked("Simulated account rent is above the rent-exempt amount.");
        const k = keys.indexOf(acct);
        if (k < 0 || preB[k] !== BigInt(0)) return blocked("Simulation creates an account that already holds SOL.");
        created.push(acct);
        rent += lamports;
        continue;
      }
      if (pid === ATA_PROGRAM) {
        if (type !== "create" && type !== "createIdempotent") return blocked("Simulation shows an unexpected associated-token instruction.");
        if (info.source !== W || !NEW_TOKEN.has(String(info.account)) || info.mint !== USDC_MINT) return blocked("Simulation creates an unexpected token account.");
        continue;
      }
      if (pid === TOKEN_PROGRAM) {
        if (type === "getAccountDataSize" || type === "initializeImmutableOwner") continue;
        if (type === "initializeAccount3" || type === "initializeAccount") {
          if (!NEW_TOKEN.has(String(info.account)) || info.mint !== USDC_MINT) return blocked("Simulation initialises an unexpected token account.");
          continue;
        }
        if (type === "transfer" || type === "transferChecked") {
          const amount = big(type === "transfer" ? info.amount : isObj(info.tokenAmount) ? info.tokenAmount.amount : null);
          if (info.source !== A.creatorTokenAccount || info.authority !== W) return blocked("Simulation shows a token transfer that is not from your USDC account.");
          if (!DEST.has(String(info.destination))) return blocked("Simulation sends USDC to an unexpected account.");
          if (type === "transferChecked" && info.mint !== USDC_MINT) return blocked("Simulation transfers a token other than USDC.");
          if (amount == null || amount <= BigInt(0)) return blocked("Simulated transfer amount is unreadable.");
          transfers.push({ destination: String(info.destination), amount });
          continue;
        }
        return blocked(`Simulation shows an unexpected token instruction (${String(type ?? "unparsed")}).`);
      }
      return blocked(`Simulation shows a call to an unexpected program (${pid.slice(0, 8)}…).`);
    }
  }
  const sent = transfers.reduce((s, t) => s + t.amount, BigInt(0));
  if (sent !== ctx.paymentBase) return blocked(`Simulated USDC transfers add up to ${sent} base units, not the quoted ${ctx.paymentBase}.`);
  const toVault = transfers.filter((t) => t.destination === A.vaultTokenAccount).reduce((s, t) => s + t.amount, BigInt(0));
  const toTreasury = transfers.filter((t) => t.destination === A.treasuryTokenAccount).reduce((s, t) => s + t.amount, BigInt(0));
  if (ctx.liquidityBase != null && toVault !== ctx.liquidityBase) return blocked("Simulated liquidity transfer differs from the quote.");
  if (ctx.platformBase != null && toTreasury !== ctx.platformBase) return blocked("Simulated platform transfer differs from the quote.");
  if (rent > CREATE_MAX_RENT_LAMPORTS) return blocked(`Simulated account rent ${lamportsToSol(rent)} SOL is above the ${lamportsToSol(CREATE_MAX_RENT_LAMPORTS)} SOL cap.`);

  // --- SOL: exactly fee + rent, nothing else
  const maxFee = messageFeeLamports(ctx.txBase64);
  const fee = v.fee === undefined ? maxFee : big(v.fee);
  if (fee == null || fee > maxFee) return blocked("Simulated network fee is unreadable or above the message's fee.");
  const walletSolDelta = postB[0] - preB[0];
  if (walletSolDelta !== -(fee + rent)) {
    return blocked(`Simulated SOL change is ${formatSigned(walletSolDelta)} lamports, not exactly −(fee ${fee} + rent ${rent}).`);
  }

  return {
    ok: true,
    evidence: Object.freeze({
      txHash: txHash(ctx.txBase64),
      slot,
      unitsConsumed: typeof v.unitsConsumed === "number" ? v.unitsConsumed : null,
      feeLamports: fee,
      rentLamports: rent,
      walletSolDelta,
      usdcPre,
      usdcPost,
      usdcDelta,
      transfers: Object.freeze(transfers),
      createdAccounts: Object.freeze(created),
      instructionLog: INSTRUCTION_NAME[ctx.marketType],
    }),
  };
}

function formatSigned(n: bigint): string {
  return n >= BigInt(0) ? `+${n}` : `${n}`;
}
