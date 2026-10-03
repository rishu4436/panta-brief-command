/**
 * Strict verification of a Panta primary-buy build before signing.
 *
 * Layout of `primary_order_usdc` (Panta USDC program), derived from mainnet
 * and a live build — there is no published IDL:
 *  - 9 mainnet PrimaryOrderUsdc txs from GET /markets/{id}/trades/ on 4
 *    markets (5cyMGU…, 4J6WxF…, 6yEBmx…, 4yiz9y…), decoded via getTransaction;
 *  - one live POST /primaryorderbuild/ (3 Oct 2026, unfunded throwaway wallet,
 *    nothing signed): amountUsdc "2.50", side no → data
 *    2e89447431590df7 01 a025260000000000.
 *
 * data (17 bytes) = discriminator sha256("global:primary_order_usdc")[0..8]
 *                 | side u8 (0 = yes, 1 = no)
 *                 | amount u64 LE, USDC base units (6 decimals) = the quote's
 *                   amountUsdc (the deposit; the fee is taken inside it).
 *
 * accounts (12):
 *   0 buyer (signer, writable)             = connected wallet
 *   1 market / event (writable)            = quote.marketId
 *   2 market config                        = PDA(["market_config"])
 *   3 vault authority                      = per-market Panta account (seeds
 *                                            not recovered; checked on-chain,
 *                                            see verifyVaultAuthorityOnChain)
 *   4 vault token account (writable)       = ATA(vault authority, USDC)
 *   5 user position (writable)             = PDA(["position", market, wallet])
 *   6 USDC mint                            = EPjFWdd5…
 *   7 user USDC account (writable)         = ATA(wallet, USDC)
 *   8 treasury token account (writable)    = 9hwZLD… (same on every observed
 *                                            tx; ATA of the treasury owner
 *                                            stored in market config)
 *   9 SPL Token · 10 Associated Token · 11 System
 *
 * Slippage / price protection (docs orders/build + the 17-byte layout above):
 * maxSlippageBps is enforced by Panta at BUILD time only ("Rejected if the
 * curve has moved beyond maxSlippageBps (QUOTE_STALE)"). The instruction
 * carries no minimum-shares argument and no limit account (all 12 accounts
 * are identified above; 13 real orders decode to disc|side|amount only), so
 * NOTHING on-chain protects against the curve moving between build and
 * landing: the buyer gets whatever the curve gives for the deposit.
 * build.expectedShares is Panta's estimate at build time and can legitimately
 * differ from quote.shares. Client-side we only enforce what is bound: the
 * build's own estimate must be within the user's max slippage of the quote,
 * and the build fee may not exceed the quoted fee (see checkPrimaryEconomics).
 *
 * Amount tolerance: ZERO base units. Quote and build amounts are decimal
 * strings ("2.50"); both are converted exactly (no floats) to USDC base units
 * (1e-6) and must be equal to each other and to the instruction amount.
 * Anything missing or unreadable fails closed.
 */

import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";
import type { BuiltInstruction, PrimaryBuild, Quote } from "./domain";
import { PANTA_USDC_PROGRAM_ID, validatePantaInstructions, type InstructionCheck } from "./instructions";

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
export const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
export const MEMO_PROGRAMS = new Set(["MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo"]);
/** Observed on every primary order (13 txs, 5 markets incl. the live build). */
export const PANTA_TREASURY_TOKEN_ACCOUNT = "9hwZLD2JZuWFDDQXEnHsnny7EF2LeyHqwcMFVssYEGpC";
/** sha256("global:primary_order_usdc")[0..8] */
export const PRIMARY_ORDER_DISCRIMINATOR = "2e89447431590df7";
/** Anchor account discriminator of the vault-authority account (9 bytes: disc + bump). */
export const VAULT_AUTHORITY_DISCRIMINATOR = "790754fe97e42b90";
export const USDC_DECIMALS = 6;
/** Priority-fee cap for an optional ComputeBudget price: 0.005 SOL. */
const MAX_PRIORITY_FEE_LAMPORTS = BigInt(5_000_000);
const DEFAULT_CU_PER_IX = BigInt(200_000);
const MAX_CU_LIMIT = BigInt(1_400_000);

const PANTA = new PublicKey(PANTA_USDC_PROGRAM_ID);
const USDC = new PublicKey(USDC_MINT);
const TOKEN = new PublicKey(TOKEN_PROGRAM);
const ATA = new PublicKey(ATA_PROGRAM);

/** Exact decimal USDC → base units (bigint). null for anything not a plain non-negative ≤6dp decimal. */
export function usdcToBase(v: unknown): bigint | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).trim();
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(s);
  if (!m) return null;
  return BigInt(m[1]) * BigInt(10 ** USDC_DECIMALS) + BigInt((m[2] || "").padEnd(USDC_DECIMALS, "0"));
}

export function ataAddress(owner: PublicKey, mint: PublicKey = USDC): PublicKey {
  return PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN.toBuffer(), mint.toBuffer()], ATA)[0];
}
export function marketConfigAddress(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("market_config")], PANTA)[0];
}
export function userPositionAddress(market: PublicKey, wallet: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("position"), market.toBuffer(), wallet.toBuffer()], PANTA)[0];
}

/** Exact non-negative decimal (≤ 9 dp) scaled to 1e9; null if unreadable. */
export function decimalToNano(v: unknown): bigint | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const str = String(v).trim();
  const m = /^(\d+)(?:\.(\d{1,9}))?$/.exec(str);
  if (!m) return null;
  return BigInt(m[1]) * BigInt(1_000_000_000) + BigInt((m[2] || "").padEnd(9, "0"));
}

function nanoToStr(n: bigint): string {
  const neg = n < BigInt(0);
  const a = neg ? -n : n;
  const whole = a / BigInt(1_000_000_000);
  // Truncated to 6 dp (a floor never rounds up), trailing zeros dropped.
  const frac = (a % BigInt(1_000_000_000)).toString().padStart(9, "0").slice(0, 6).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

export type PrimaryEconomics = {
  quotedShares: string;
  /** Panta's estimate when the order was built (not a guaranteed fill). */
  expectedShares: string;
  /** quote.shares × (1 − maxSlippageBps): the floor Panta checked at build. */
  slippageFloorShares: string;
  maxSlippageBps: number;
  feeUsdc: string;
  /** Always false: primary_order_usdc has no on-chain minimum-shares limit. */
  onChainMinShares: false;
};

/**
 * Economic consistency of a build vs its quote. Bound values fail closed;
 * values that may legitimately move (expected shares within slippage, a lower
 * fee) are passed through for the review to label as estimates.
 */
export function checkPrimaryEconomics(
  built: PrimaryBuild,
  quote: Quote,
  maxSlippageBps: number | null | undefined,
): PrimaryEconomics | { ok: false; reason: string } {
  if (maxSlippageBps == null || !Number.isInteger(maxSlippageBps) || maxSlippageBps < 0 || maxSlippageBps > 5000) {
    return fail("Max slippage for this build is unknown.");
  }
  const quoted = decimalToNano(quote.shares);
  if (quoted == null || quoted <= BigInt(0)) return fail("Quoted shares are missing or unreadable.");
  const expected = decimalToNano(built.expectedShares);
  if (expected == null || expected <= BigInt(0)) return fail("Build did not report readable expected shares.");
  const floor = (quoted * BigInt(10_000 - maxSlippageBps)) / BigInt(10_000);
  if (expected < floor) {
    return fail(
      `Build expects ${built.expectedShares} shares, below your ${(maxSlippageBps / 100).toFixed(2)}% slippage floor (${nanoToStr(floor)}) from the quoted ${quote.shares}.`,
    );
  }
  const amount = usdcToBase(quote.amountUsdc);
  const qFee = usdcToBase(quote.feeUsdc);
  const bFee = usdcToBase(built.feeUsdc);
  if (qFee == null) return fail("Quoted fee is missing or unreadable.");
  if (bFee == null) return fail("Build fee is missing or unreadable.");
  if (bFee > qFee) return fail(`Build fee (${built.feeUsdc} USDC) is higher than the quoted fee (${quote.feeUsdc} USDC).`);
  if (amount == null || bFee >= amount) return fail("Build fee is not smaller than the amount.");
  return {
    quotedShares: quote.shares,
    expectedShares: built.expectedShares,
    slippageFloorShares: nanoToStr(floor),
    maxSlippageBps,
    feeUsdc: built.feeUsdc,
    onChainMinShares: false,
  };
}

export type PrimaryOrderData = { side: "yes" | "no"; amountBase: bigint };

/** Decode primary_order_usdc data; null unless it is exactly the known layout. */
export function decodePrimaryOrderData(b64: string): PrimaryOrderData | null {
  let d: Buffer;
  try {
    d = Buffer.from(b64, "base64");
  } catch {
    return null;
  }
  if (d.length !== 17) return null;
  if (d.subarray(0, 8).toString("hex") !== PRIMARY_ORDER_DISCRIMINATOR) return null;
  const sideByte = d[8];
  if (sideByte !== 0 && sideByte !== 1) return null;
  return { side: sideByte === 0 ? "yes" : "no", amountBase: d.readBigUInt64LE(9) };
}

export type VerifiedPrimaryBuy = {
  ok: true;
  count: number;
  programs: string[];
  /** What was proven against the quote / wallet (shown in the review). */
  verified: {
    amountBase: string;
    side: "yes" | "no";
    marketId: string;
    wallet: string;
    vaultAuthority: string;
    vaultTokenAccount: string;
    treasuryTokenAccount: string;
    memoBindsQuote: boolean;
    economics: PrimaryEconomics;
  };
};
export type PrimaryBuyCheck = VerifiedPrimaryBuy | { ok: false; reason: string };

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason: `${reason} Signing blocked.` });

function key(v: string): PublicKey | null {
  try {
    return new PublicKey(v);
  } catch {
    return null;
  }
}

type Acc = BuiltInstruction["accounts"][number];
export function accIs(a: Acc | undefined, expected: string | PublicKey, opts: { writable?: boolean; signer?: boolean } = {}) {
  if (!a) return false;
  const want = typeof expected === "string" ? expected : expected.toBase58();
  if (a.pubkey !== want) return false;
  if (opts.signer !== undefined && a.isSigner !== opts.signer) return false;
  if (opts.writable !== undefined && a.isWritable !== opts.writable) return false;
  return true;
}

/** Optional ComputeBudget instructions: only SetComputeUnitLimit / Price, bounded. */
export function checkComputeBudget(ixs: BuiltInstruction[]): string | null {
  let limit: bigint | null = null;
  let price: bigint | null = null;
  for (const ix of ixs) {
    const d = Buffer.from(ix.data, "base64");
    if (ix.accounts.length !== 0) return "Compute-budget instruction has accounts.";
    if (d[0] === 2 && d.length === 5) limit = BigInt(d.readUInt32LE(1));
    else if (d[0] === 3 && d.length === 9) price = d.readBigUInt64LE(1);
    else return "Unexpected compute-budget instruction.";
  }
  if (limit != null && limit > MAX_CU_LIMIT) return "Compute-unit limit above 1.4M.";
  if (price != null) {
    const units = limit ?? DEFAULT_CU_PER_IX * BigInt(4);
    const lamports = (price * units) / BigInt(1_000_000);
    if (lamports > MAX_PRIORITY_FEE_LAMPORTS) return "Priority fee above 0.005 SOL.";
  }
  return null;
}

/**
 * CreateIdempotent (1) / Create (0 or empty) of the wallet's own USDC account,
 * paid by the wallet. The only Associated-Token instruction a build may carry.
 */
export function isCreateOwnUsdcAta(ix: BuiltInstruction, wallet: PublicKey): boolean {
  const w = wallet.toBase58();
  const d = Buffer.from(ix.data, "base64");
  const okData = d.length === 0 || (d.length === 1 && (d[0] === 0 || d[0] === 1));
  const a = ix.accounts;
  return (
    okData &&
    a.length === 6 &&
    accIs(a[0], w, { signer: true }) &&
    accIs(a[1], ataAddress(wallet)) &&
    accIs(a[2], w) &&
    accIs(a[3], USDC_MINT) &&
    accIs(a[4], SYSTEM_PROGRAM) &&
    accIs(a[5], TOKEN_PROGRAM)
  );
}

/**
 * Full pre-sign check of a primary-buy build against the approved quote and
 * the connected wallet. Fails closed on any missing or mismatched field.
 */
export function verifyPrimaryBuyBuild(
  built: PrimaryBuild,
  quote: Quote | null,
  wallet: PublicKey,
  maxSlippageBps: number | null | undefined,
): PrimaryBuyCheck {
  const w = wallet.toBase58();
  if (!quote) return fail("No approved quote to check the build against.");
  // --- metadata: every field required, every field must match
  if (!built.wallet) return fail("Build did not say which wallet it is for.");
  if (built.wallet !== w) return fail("Build wallet does not match the connected wallet.");
  if (!built.quoteId) return fail("Build did not include its quoteId.");
  if (built.quoteId !== quote.quoteId) return fail("Build does not match the active quote.");
  if (!built.marketId) return fail("Build did not include its market.");
  if (built.marketId !== quote.marketId) return fail("Build market differs from the quoted market.");
  if (!built.side) return fail("Build did not include its side.");
  if (built.side !== quote.side) return fail("Build side differs from the quoted side.");
  if (!built.orderId) return fail("Build did not include an orderId.");
  const quoteBase = usdcToBase(quote.amountUsdc);
  if (quoteBase == null || quoteBase <= BigInt(0)) return fail("Quote amount is missing or unreadable.");
  const buildBase = usdcToBase(built.amountUsdc);
  if (buildBase == null) return fail("Build amount is missing or unreadable.");
  if (buildBase !== quoteBase) {
    return fail(`Build amount (${built.amountUsdc} USDC) differs from the approved quote (${quote.amountUsdc} USDC).`);
  }
  const market = key(quote.marketId);
  if (!market) return fail("Quoted market id is not a valid address.");
  const economics = checkPrimaryEconomics(built, quote, maxSlippageBps);
  if ("ok" in economics) return economics;

  // --- generic allowlist (programs, signers, sizes)
  const generic: InstructionCheck = validatePantaInstructions(built.instructions, wallet);
  if (!generic.ok) return generic;

  // --- every instruction must be one of the known primary-buy shapes
  const panta = built.instructions.filter((ix) => ix.programId === PANTA_USDC_PROGRAM_ID);
  if (panta.length !== 1) return fail(`Build has ${panta.length} Panta instructions (expected exactly 1).`);
  const userAta = ataAddress(wallet);
  const budget: BuiltInstruction[] = [];
  let memoBindsQuote = false;
  for (const ix of built.instructions) {
    if (ix.programId === PANTA_USDC_PROGRAM_ID) continue;
    if (ix.programId === COMPUTE_BUDGET_PROGRAM) {
      budget.push(ix);
      continue;
    }
    if (ix.programId === ATA_PROGRAM) {
      if (!isCreateOwnUsdcAta(ix, wallet)) return fail("Associated-token instruction is not 'create my USDC account'.");
      continue;
    }
    if (MEMO_PROGRAMS.has(ix.programId)) {
      const text = Buffer.from(ix.data, "base64").toString("utf8");
      // Panta attribution memo: panta:v1:<userId>:<quoteId>:<orderId>
      if (!text.startsWith("panta:v1:")) return fail("Memo is not a Panta attribution memo.");
      const qt: string[] = text.match(/\bqt_[A-Za-z0-9]+/g) ?? [];
      const ord: string[] = text.match(/\bord_[A-Za-z0-9]+/g) ?? [];
      if (qt.some((q) => q !== quote.quoteId) || ord.some((o) => o !== built.orderId)) {
        return fail("Memo references a different quote or order.");
      }
      if (ix.accounts.some((acc) => acc.pubkey !== w)) return fail("Memo lists an account other than your wallet.");
      memoBindsQuote = qt.includes(quote.quoteId);
      continue;
    }
    // System / SPL Token / Token-2022 etc. are allowed as accounts, never as
    // top-level instructions in a buy (a bare transfer would move funds).
    return fail(`Unexpected top-level instruction for a primary buy (${ix.programId}).`);
  }
  const cb = checkComputeBudget(budget);
  if (cb) return fail(cb);

  // --- the Panta instruction itself
  const order = panta[0];
  const data = decodePrimaryOrderData(order.data);
  if (!data) return fail("Panta instruction is not a recognisable primary_order_usdc.");
  if (data.side !== quote.side) return fail("Instruction side differs from the quoted side.");
  if (data.amountBase !== quoteBase) {
    return fail(`Instruction amount (${data.amountBase} base units) differs from the approved quote (${quoteBase}).`);
  }
  const a = order.accounts;
  if (a.length !== 12) return fail(`Panta instruction has ${a.length} accounts (expected 12).`);
  const vaultAuthority = key(a[3]?.pubkey ?? "");
  if (!vaultAuthority) return fail("Vault authority is not a valid address.");
  const checks: [boolean, string][] = [
    [accIs(a[0], w, { signer: true, writable: true }), "buyer is not your wallet"],
    [accIs(a[1], market, { writable: true }), "market account differs from the quote"],
    [accIs(a[2], marketConfigAddress()), "market config is not Panta's"],
    [!PublicKey.isOnCurve(vaultAuthority.toBytes()) && a[3].pubkey !== w && !a[3].isSigner, "vault authority is not a program address"],
    [accIs(a[4], ataAddress(vaultAuthority), { writable: true }), "vault token account is not the vault's USDC account"],
    [accIs(a[5], userPositionAddress(market, wallet), { writable: true }), "position account is not yours for this market"],
    [accIs(a[6], USDC_MINT), "mint is not USDC"],
    [accIs(a[7], userAta, { writable: true }), "paying account is not your USDC account"],
    [accIs(a[8], PANTA_TREASURY_TOKEN_ACCOUNT, { writable: true }), "treasury account is not Panta's known treasury"],
    [accIs(a[9], TOKEN_PROGRAM), "token program mismatch"],
    [accIs(a[10], ATA_PROGRAM), "associated-token program mismatch"],
    [accIs(a[11], SYSTEM_PROGRAM), "system program mismatch"],
  ];
  for (const [ok, why] of checks) if (!ok) return fail(`Panta instruction: ${why}.`);

  return {
    ok: true,
    count: generic.count,
    programs: generic.programs,
    verified: {
      amountBase: quoteBase.toString(),
      side: data.side,
      marketId: quote.marketId,
      wallet: w,
      vaultAuthority: vaultAuthority.toBase58(),
      vaultTokenAccount: a[4].pubkey,
      treasuryTokenAccount: a[8].pubkey,
      memoBindsQuote,
      economics,
    },
  };
}

/** Minimal RPC surface (Connection.getAccountInfo). */
export type AccountInfoReader = {
  getAccountInfo(k: PublicKey): Promise<{ owner: PublicKey; data: Uint8Array | Buffer } | null>;
};

/**
 * The vault authority's seeds are not public, so prove it on-chain instead:
 * it must be an account owned by the Panta program carrying the
 * vault-authority discriminator (9 bytes: discriminator + bump). Only the
 * Panta program can create such an account. RPC failure fails closed.
 *
 * LIMITATION (checked 3 Oct 2026 against 42 win claims + 13 primary orders):
 * this proves "a Panta vault authority", NOT "this market's" vault authority.
 *  - The VA account is 9 bytes (discriminator + bump): no market back-reference.
 *  - The market (Anchor "account:Event", 2982 bytes, creator at [8..40]) does
 *    not contain the VA or the vault token account anywhere in its data.
 *  - The PDA seeds were not recoverable (~440k candidate seed sets tried,
 *    incl. every 1–32-byte window of the Event data); no IDL is published.
 * So market → vault authority cannot be proven from public data. What is
 * proven: the vault token account is ATA(VA, USDC) (derived locally), the VA
 * is Panta-owned with the VA discriminator, and in the fixtures each market
 * maps to exactly one VA (42 win claims, 26 markets, 26 distinct VAs; 12
 * markets with several claimants). Binding VA to the market is left to the
 * Panta program's own account constraints at execution (an assumption we
 * cannot verify without the program source/IDL).
 */
export async function verifyVaultAuthorityOnChain(rpc: AccountInfoReader, vaultAuthority: string): Promise<string | null> {
  let info: Awaited<ReturnType<AccountInfoReader["getAccountInfo"]>>;
  try {
    info = await rpc.getAccountInfo(new PublicKey(vaultAuthority));
  } catch {
    return "Could not read the vault authority on-chain. Signing blocked.";
  }
  if (!info) return "Vault authority account does not exist on-chain. Signing blocked.";
  if (!info.owner.equals(PANTA)) return "Vault authority is not owned by the Panta program. Signing blocked.";
  const d = Buffer.from(info.data);
  if (d.length !== 9 || d.subarray(0, 8).toString("hex") !== VAULT_AUTHORITY_DISCRIMINATOR) {
    return "Vault authority account has an unexpected layout. Signing blocked.";
  }
  return null;
}
