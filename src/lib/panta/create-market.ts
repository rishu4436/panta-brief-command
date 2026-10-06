/**
 * Panta market creation: quote binding, build metadata checks, strict
 * pre-sign validation of the create transaction, on-chain fee binding,
 * pre-sign revalidation and registration checks.
 *
 * Evidence (6 Oct 2026, nothing signed or broadcast; see
 * docs/CREATE_TRANSACTION_SECURITY.md and test/fixtures/create-build.live-2026-10-06.json):
 *  - 3 real POST /markets/create/build/ responses (breaking, breaking with
 *    eventInProgress, standard) for the test wallet, decoded locally;
 *  - Panta's own frontend IDL (balr_market, program 6gM5afTQ…), shipped in
 *    www.panta.market/_next/static/chunks/5217-*.js: instructions
 *    create_event_usdc / create_breaking_event_usdc, account order, args and
 *    error 6107 InvalidCreationPayment ("USDC payment does not match the
 *    fixed price for this market tier");
 *  - on-chain MarketConfig 8mJjfx7S… (owner 6gM5afTQ…): regular 50 USDC
 *    (10 liquidity), breaking 20 USDC (5 liquidity), treasury 4M2EtWmj…
 *    whose USDC ATA is 9hwZLD2J…;
 *  - PDA seeds recovered and checked against all 3 builds + 1 quote:
 *    event = PDA("event_usdc", creator, sha256(question)),
 *    vault authority = PDA("vault_usdc", creator, sha256(question)).
 *
 * Observed transaction (all 3 builds): v0 message, no address lookup tables,
 * 1 required signature (the creator wallet = fee payer), 17 static keys,
 * 2 instructions: ComputeBudget SetComputeUnitLimit(400 000) and one Panta
 * create instruction with exactly 15 accounts. No other top-level
 * instruction, no SOL or token transfer outside the Panta program.
 */

import { Buffer } from "buffer";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { z } from "@/lib/zod";
import { sha256 } from "@/lib/sha256";
import type { NetworkCheck } from "@/lib/network";
import { PANTA_USDC_PROGRAM_ID } from "./instructions";
import {
  ATA_PROGRAM,
  COMPUTE_BUDGET_PROGRAM,
  PANTA_TREASURY_TOKEN_ACCOUNT,
  SYSTEM_PROGRAM,
  TOKEN_PROGRAM,
  USDC_MINT,
  ataAddress,
  marketConfigAddress,
} from "./primary-order";
import { BASE58_PUBKEY_RE } from "./routes";
import { SOLANA_PACKET_BYTES, createInputFingerprint, type CreateInput, type CreateMarketType } from "./create-rules";

/** sha256("global:create_event_usdc")[0..8] — Standard markets. */
export const CREATE_EVENT_USDC_DISCRIMINATOR = "5009ccd596db57a2";
/** sha256("global:create_breaking_event_usdc")[0..8] — Breaking markets. */
export const CREATE_BREAKING_EVENT_USDC_DISCRIMINATOR = "19674bc6e0492c45";
/** Anchor account discriminator of MarketConfig (IDL + on-chain account). */
export const MARKET_CONFIG_DISCRIMINATOR = "77ffc858fc528018";
export const MARKET_CONFIG_LEN = 356;
/** Observed SetComputeUnitLimit is 400 000 (simulation used ~117k). Anything above this cap is refused. */
export const CREATE_MAX_CU_LIMIT = 600_000;
/** Priority fee cap if Panta ever adds SetComputeUnitPrice: 0.005 SOL (same as primary). */
const CREATE_MAX_PRIORITY_FEE_LAMPORTS = BigInt(5_000_000);
/** Panta ix + up to two compute-budget ixs. Observed: 2. */
export const CREATE_MAX_INSTRUCTIONS = 3;
/** Keep a small safety margin before quote/build expiry when signing. */
export const CREATE_EXPIRY_MARGIN_MS = 5_000;

export const CREATE_ID_RE = /^cr_[A-Za-z0-9]{8,64}$/;
export const SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const BASE_UNITS_RE = /^\d{1,15}$/;

const PANTA = new PublicKey(PANTA_USDC_PROGRAM_ID);

export type CreateCheck<T> = ({ ok: true } & T) | { ok: false; reason: string };
const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason: `${reason} Signing blocked.` });

function key(v: unknown): PublicKey | null {
  if (typeof v !== "string" || !BASE58_PUBKEY_RE.test(v)) return null;
  try {
    return new PublicKey(v);
  } catch {
    return null;
  }
}

function baseUnits(v: unknown): bigint | null {
  return typeof v === "string" && BASE_UNITS_RE.test(v) ? BigInt(v) : null;
}

/** USDC base units → "20.00" style display (exact, no floats). */
export function formatUsdcBaseUnits(b: bigint): string {
  const whole = b / BigInt(1_000_000);
  const frac = (b % BigInt(1_000_000)).toString().padStart(6, "0").replace(/0+$/, "").padEnd(2, "0");
  return `${whole}.${frac}`;
}

// ---------------------------------------------------------------------------
// Account derivation (all locally computable from wallet + question)
// ---------------------------------------------------------------------------

export type CreateAccounts = {
  creator: string;
  marketConfig: string;
  creatorWhitelist: string;
  event: string;
  vaultAuthority: string;
  vaultTokenAccount: string;
  creatorFeeVault: string;
  creatorFeeVaultTokenAccount: string;
  creatorPosition: string;
  usdcMint: string;
  creatorTokenAccount: string;
  treasuryTokenAccount: string;
  tokenProgram: string;
  associatedTokenProgram: string;
  systemProgram: string;
};

export function questionSeed(question: string): Uint8Array {
  return sha256(new TextEncoder().encode(question));
}

export function deriveEventPda(wallet: string, question: string): string {
  const w = new PublicKey(wallet);
  return PublicKey.findProgramAddressSync([Buffer.from("event_usdc"), w.toBuffer(), Buffer.from(questionSeed(question))], PANTA)[0].toBase58();
}

export function deriveCreateAccounts(wallet: string, question: string): CreateAccounts {
  const w = new PublicKey(wallet);
  const q = Buffer.from(questionSeed(question));
  const event = PublicKey.findProgramAddressSync([Buffer.from("event_usdc"), w.toBuffer(), q], PANTA)[0];
  const va = PublicKey.findProgramAddressSync([Buffer.from("vault_usdc"), w.toBuffer(), q], PANTA)[0];
  const feeVault = PublicKey.findProgramAddressSync([Buffer.from("creator_fee_vault_usdc"), event.toBuffer()], PANTA)[0];
  return {
    creator: w.toBase58(),
    marketConfig: marketConfigAddress().toBase58(),
    creatorWhitelist: PublicKey.findProgramAddressSync([Buffer.from("creator_whitelist")], PANTA)[0].toBase58(),
    event: event.toBase58(),
    vaultAuthority: va.toBase58(),
    vaultTokenAccount: ataAddress(va).toBase58(),
    creatorFeeVault: feeVault.toBase58(),
    creatorFeeVaultTokenAccount: ataAddress(feeVault).toBase58(),
    creatorPosition: PublicKey.findProgramAddressSync([Buffer.from("position"), event.toBuffer(), w.toBuffer()], PANTA)[0].toBase58(),
    usdcMint: USDC_MINT,
    creatorTokenAccount: ataAddress(w).toBase58(),
    treasuryTokenAccount: PANTA_TREASURY_TOKEN_ACCOUNT,
    tokenProgram: TOKEN_PROGRAM,
    associatedTokenProgram: ATA_PROGRAM,
    systemProgram: SYSTEM_PROGRAM,
  };
}

/** IDL account order of create_event_usdc / create_breaking_event_usdc, with observed flags. */
export const CREATE_ACCOUNT_LAYOUT: readonly { name: keyof CreateAccounts; writable: boolean; signer: boolean }[] = [
  { name: "creator", writable: true, signer: true },
  { name: "marketConfig", writable: false, signer: false },
  { name: "creatorWhitelist", writable: false, signer: false },
  { name: "event", writable: true, signer: false },
  { name: "vaultAuthority", writable: true, signer: false },
  { name: "vaultTokenAccount", writable: true, signer: false },
  { name: "creatorFeeVault", writable: true, signer: false },
  { name: "creatorFeeVaultTokenAccount", writable: true, signer: false },
  { name: "creatorPosition", writable: true, signer: false },
  { name: "usdcMint", writable: false, signer: false },
  { name: "creatorTokenAccount", writable: true, signer: false },
  { name: "treasuryTokenAccount", writable: true, signer: false },
  { name: "tokenProgram", writable: false, signer: false },
  { name: "associatedTokenProgram", writable: false, signer: false },
  { name: "systemProgram", writable: false, signer: false },
];

// ---------------------------------------------------------------------------
// Quote → session binding
// ---------------------------------------------------------------------------

const PubkeyStr = z.string().regex(BASE58_PUBKEY_RE);
const BaseUnitsStr = z.string().regex(BASE_UNITS_RE);

export const CreateQuoteSchema = z.looseObject({
  createId: z.string().regex(CREATE_ID_RE),
  expectedEventPda: PubkeyStr,
  paymentUsdc: BaseUnitsStr,
  liquidityInjectionUsdc: BaseUnitsStr.optional(),
  platformRevenueUsdc: BaseUnitsStr.optional(),
  marketType: z.enum(["standard", "breaking"]),
  expiresAt: z.string().min(10).max(40),
  blockhashExpiryHintSec: z.number().optional(),
});

export type CreateSession = Readonly<{
  input: CreateInput;
  fingerprint: string;
  createId: string;
  expectedEventPda: string;
  marketType: CreateMarketType;
  paymentBase: bigint;
  liquidityBase: bigint | null;
  platformBase: bigint | null;
  expiresAtMs: number;
  receivedAtMs: number;
}>;

export class CreateBlocked extends Error {}

/**
 * Bind a live quote to the exact inputs it was requested with. Fails closed
 * when the quote's type, event address or fee split disagree with the input
 * or with each other.
 */
export function bindCreateQuote(raw: unknown, input: CreateInput, nowMs: number): CreateSession {
  const r = CreateQuoteSchema.safeParse(raw);
  if (!r.success) throw new CreateBlocked(`Panta quote has an unexpected shape (${r.error.issues[0]?.path.join(".") || "invalid"}).`);
  const q = r.data;
  if (q.marketType !== input.marketType) throw new CreateBlocked("Quoted market type differs from the one you chose.");
  const derived = deriveEventPda(input.wallet, input.question);
  if (q.expectedEventPda !== derived) throw new CreateBlocked("Quoted event address is not the one derived from your wallet and question.");
  const payment = BigInt(q.paymentUsdc);
  if (payment <= BigInt(0)) throw new CreateBlocked("Quoted creation fee is zero or unreadable.");
  const liq = q.liquidityInjectionUsdc != null ? BigInt(q.liquidityInjectionUsdc) : null;
  const plat = q.platformRevenueUsdc != null ? BigInt(q.platformRevenueUsdc) : null;
  if (liq != null && plat != null && liq + plat !== payment) throw new CreateBlocked("Quoted fee split does not add up to the quoted fee.");
  if ((liq != null && liq > payment) || (plat != null && plat > payment)) throw new CreateBlocked("Quoted fee split exceeds the quoted fee.");
  const exp = Date.parse(q.expiresAt);
  if (!Number.isFinite(exp)) throw new CreateBlocked("Quote has no readable expiry.");
  if (exp <= nowMs) throw new CreateBlocked("Quote is already expired.");
  return Object.freeze({
    input,
    fingerprint: createInputFingerprint(input),
    createId: q.createId,
    expectedEventPda: q.expectedEventPda,
    marketType: q.marketType,
    paymentBase: payment,
    liquidityBase: liq,
    platformBase: plat,
    expiresAtMs: exp,
    receivedAtMs: nowMs,
  });
}

/** Why a session can no longer be used with the current form + wallet (null = still valid). */
export function sessionStaleReason(session: CreateSession, current: CreateInput, wallet: string | null, nowMs: number): string | null {
  if (!wallet || wallet !== session.input.wallet) return "Wallet changed since the quote. Request a new quote.";
  if (createInputFingerprint(current) !== session.fingerprint) return "Market details changed since the quote. Request a new quote.";
  if (nowMs >= session.expiresAtMs) return "Quote expired. Request a new quote.";
  return null;
}

// ---------------------------------------------------------------------------
// Build metadata
// ---------------------------------------------------------------------------

export const CreateBuildSchema = z.looseObject({
  createId: z.string().regex(CREATE_ID_RE),
  expectedEventPda: PubkeyStr,
  transaction: z.string().min(100).max(4096).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  recentBlockhash: PubkeyStr,
  lastValidBlockHeight: z.number().int().positive(),
  buildFingerprint: z.string().min(8).max(256),
  paymentUsdc: BaseUnitsStr,
  liquidityInjectionUsdc: BaseUnitsStr.optional(),
  platformRevenueUsdc: BaseUnitsStr.optional(),
  marketType: z.enum(["standard", "breaking"]),
  derived: z.record(z.string(), z.string()).optional(),
  expiresAt: z.string().min(10).max(40),
});
export type CreateBuild = z.infer<typeof CreateBuildSchema>;

export function parseCreateBuild(raw: unknown): CreateBuild {
  const r = CreateBuildSchema.safeParse(raw);
  if (!r.success) throw new CreateBlocked(`Panta build has an unexpected shape (${r.error.issues[0]?.path.join(".") || "invalid"}). Signing blocked.`);
  return r.data;
}

/** Map of build.derived names we can check → our derivation. */
const DERIVED_NAMES: Partial<Record<string, keyof CreateAccounts>> = {
  event: "event",
  vaultAuthority: "vaultAuthority",
  marketConfig: "marketConfig",
  creatorWhitelist: "creatorWhitelist",
  creatorFeeVault: "creatorFeeVault",
  creatorPosition: "creatorPosition",
  creatorTokenAccount: "creatorTokenAccount",
  vaultTokenAccount: "vaultTokenAccount",
  treasuryTokenAccount: "treasuryTokenAccount",
};

export function checkCreateBuildMetadata(build: CreateBuild, session: CreateSession, wallet: string | null, nowMs: number): { ok: true } | { ok: false; reason: string } {
  if (!wallet) return fail("No wallet connected.");
  if (wallet !== session.input.wallet) return fail("Connected wallet differs from the quoted wallet.");
  if (build.createId !== session.createId) return fail("Build createId does not match the active quote.");
  if (build.expectedEventPda !== session.expectedEventPda) return fail("Build event address differs from the quote.");
  if (build.marketType !== session.marketType) return fail("Build market type differs from the quote.");
  const pay = baseUnits(build.paymentUsdc);
  if (pay == null || pay !== session.paymentBase) return fail(`Build fee (${build.paymentUsdc} base units) differs from the quoted fee (${session.paymentBase}).`);
  if (session.liquidityBase != null && build.liquidityInjectionUsdc != null && BigInt(build.liquidityInjectionUsdc) !== session.liquidityBase) {
    return fail("Build liquidity injection differs from the quote.");
  }
  if (session.platformBase != null && build.platformRevenueUsdc != null && BigInt(build.platformRevenueUsdc) !== session.platformBase) {
    return fail("Build platform portion differs from the quote.");
  }
  const exp = Date.parse(build.expiresAt);
  if (!Number.isFinite(exp)) return fail("Build has no readable expiry.");
  if (nowMs >= exp - CREATE_EXPIRY_MARGIN_MS) return fail("Build expired. Rebuild before signing.");
  if (nowMs >= session.expiresAtMs - CREATE_EXPIRY_MARGIN_MS) return fail("Quote expired. Request a new quote.");
  let bh: Buffer;
  try {
    bh = Buffer.from(new PublicKey(build.recentBlockhash).toBytes());
  } catch {
    return fail("Build blockhash is not valid.");
  }
  if (bh.length !== 32) return fail("Build blockhash is not valid.");
  if (build.derived) {
    const mine = deriveCreateAccounts(wallet, session.input.question);
    for (const [name, value] of Object.entries(build.derived)) {
      const ours = DERIVED_NAMES[name];
      if (ours && mine[ours] !== value) return fail(`Build reports ${name} ${value.slice(0, 8)}…, not the derived account.`);
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Instruction data
// ---------------------------------------------------------------------------

export type CreateIxData = {
  kind: CreateMarketType;
  startTime: number;
  endTime: number;
  resolutionTime: number;
  question: string;
  paymentBase: bigint;
  resolutionRule: string;
  sources: string[];
  eventInProgress: boolean | null;
};

/** Strict borsh decode of create_event_usdc / create_breaking_event_usdc data; null unless it is exactly that layout. */
export function decodeCreateIxData(data: Uint8Array): CreateIxData | null {
  const d = Buffer.from(data);
  if (d.length < 8 + 24 + 4 + 8 + 4 + 4) return null;
  const disc = d.subarray(0, 8).toString("hex");
  const kind: CreateMarketType | null =
    disc === CREATE_EVENT_USDC_DISCRIMINATOR ? "standard" : disc === CREATE_BREAKING_EVENT_USDC_DISCRIMINATOR ? "breaking" : null;
  if (!kind) return null;
  const dec = new TextDecoder("utf-8", { fatal: true });
  let o = 8;
  const need = (n: number) => {
    if (o + n > d.length) throw new Error("short");
  };
  const i64 = () => {
    need(8);
    const v = d.readBigInt64LE(o);
    o += 8;
    if (v < BigInt(0) || v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("range");
    return Number(v);
  };
  const u64 = () => {
    need(8);
    const v = d.readBigUInt64LE(o);
    o += 8;
    return v;
  };
  const str = (max: number) => {
    need(4);
    const n = d.readUInt32LE(o);
    o += 4;
    if (n > max) throw new Error("len");
    need(n);
    const s = dec.decode(d.subarray(o, o + n));
    o += n;
    return s;
  };
  try {
    const startTime = i64();
    const endTime = i64();
    const resolutionTime = i64();
    const question = str(512);
    const paymentBase = u64();
    const resolutionRule = str(2048);
    need(4);
    const n = d.readUInt32LE(o);
    o += 4;
    if (n > 20) return null;
    const sources: string[] = [];
    for (let k = 0; k < n; k++) sources.push(str(2048));
    let eventInProgress: boolean | null = null;
    if (kind === "breaking") {
      need(1);
      const b = d[o];
      o += 1;
      if (b !== 0 && b !== 1) return null;
      eventInProgress = b === 1;
    }
    if (o !== d.length) return null; // no trailing bytes
    return { kind, startTime, endTime, resolutionTime, question, paymentBase, resolutionRule, sources, eventInProgress };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Transaction
// ---------------------------------------------------------------------------

type DecodedIx = { programId: string; accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; data: Uint8Array };

function checkCreateComputeBudget(ixs: DecodedIx[]): { limit: number | null; priceMicroLamports: bigint | null } | string {
  let limit: number | null = null;
  let price: bigint | null = null;
  for (const ix of ixs) {
    const d = Buffer.from(ix.data);
    if (ix.accounts.length !== 0) return "Compute-budget instruction has accounts.";
    if (d[0] === 2 && d.length === 5 && limit == null) limit = d.readUInt32LE(1);
    else if (d[0] === 3 && d.length === 9 && price == null) price = d.readBigUInt64LE(1);
    else return "Unexpected compute-budget instruction.";
  }
  if (limit != null && limit > CREATE_MAX_CU_LIMIT) return `Compute-unit limit ${limit} is above the ${CREATE_MAX_CU_LIMIT} cap.`;
  if (price != null) {
    const units = BigInt(limit ?? 200_000 * ixs.length);
    if ((price * units) / BigInt(1_000_000) > CREATE_MAX_PRIORITY_FEE_LAMPORTS) return "Priority fee above 0.005 SOL.";
  }
  return { limit, priceMicroLamports: price };
}

export type VerifiedCreateTx = {
  ok: true;
  txBytes: number;
  instructionCount: number;
  programs: string[];
  computeUnitLimit: number | null;
  priorityFeeMicroLamports: string | null;
  accounts: CreateAccounts;
  data: CreateIxData;
};

export type CreateTxContext = {
  wallet: string;
  input: CreateInput;
  session: Pick<CreateSession, "createId" | "expectedEventPda" | "marketType" | "paymentBase">;
  recentBlockhash: string;
};

/**
 * Strict structural validation of Panta's unsigned create transaction.
 * Everything must match the observed shape exactly; anything else fails closed.
 */
export function verifyCreateTransaction(txBase64: string, ctx: CreateTxContext): VerifiedCreateTx | { ok: false; reason: string } {
  const { wallet, input, session } = ctx;
  const w = key(wallet);
  if (!w) return fail("Connected wallet is not a valid address.");
  if (input.wallet !== wallet) return fail("Quoted wallet differs from the connected wallet.");
  let raw: Buffer;
  try {
    raw = Buffer.from(txBase64, "base64");
  } catch {
    return fail("Transaction is not readable.");
  }
  if (raw.length === 0 || raw.toString("base64").replace(/=+$/, "") !== txBase64.replace(/=+$/, "")) return fail("Transaction is not valid base64.");
  if (raw.length > SOLANA_PACKET_BYTES) return fail(`Transaction is ${raw.length} bytes, above Solana's ${SOLANA_PACKET_BYTES}-byte limit (shorten the question, rule or sources).`);
  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(raw);
  } catch {
    return fail("Transaction could not be decoded.");
  }
  const m = tx.message;
  if (m.version !== 0) return fail("Transaction is not a v0 message.");
  if (m.addressTableLookups.length !== 0) return fail("Transaction uses address lookup tables (not in the observed shape).");
  if (m.header.numRequiredSignatures !== 1 || m.header.numReadonlySignedAccounts !== 0) return fail("Transaction requires a signer other than your wallet.");
  if (tx.signatures.length !== 1 || !tx.signatures.every((s) => s.every((b) => b === 0))) return fail("Transaction arrived already signed.");
  const keys = m.staticAccountKeys.map((k) => k.toBase58());
  if (keys[0] !== wallet) return fail("Fee payer is not the connected wallet.");
  if (new Set(keys).size !== keys.length) return fail("Transaction lists an account twice.");
  if (m.recentBlockhash !== ctx.recentBlockhash) return fail("Transaction blockhash differs from the build's blockhash.");

  const ixs: DecodedIx[] = [];
  for (const ci of m.compiledInstructions) {
    const pid = keys[ci.programIdIndex];
    if (!pid) return fail("Instruction references a missing program.");
    const accounts = [];
    for (const idx of ci.accountKeyIndexes) {
      const pk = keys[idx];
      if (!pk) return fail("Instruction references a missing account.");
      accounts.push({ pubkey: pk, isSigner: m.isAccountSigner(idx), isWritable: m.isAccountWritable(idx) });
    }
    ixs.push({ programId: pid, accounts, data: ci.data });
  }
  if (ixs.length === 0 || ixs.length > CREATE_MAX_INSTRUCTIONS) return fail(`Transaction has ${ixs.length} instructions (observed: 2).`);
  const panta = ixs.filter((ix) => ix.programId === PANTA_USDC_PROGRAM_ID);
  if (panta.length !== 1) return fail(`Transaction has ${panta.length} Panta instructions (expected exactly 1).`);
  if (ixs[ixs.length - 1].programId !== PANTA_USDC_PROGRAM_ID) return fail("Panta create instruction is not the last instruction.");
  const budget: DecodedIx[] = [];
  for (const ix of ixs) {
    if (ix.programId === PANTA_USDC_PROGRAM_ID) continue;
    if (ix.programId === COMPUTE_BUDGET_PROGRAM) {
      budget.push(ix);
      continue;
    }
    // System / SPL Token / ATA / Memo / anything else at top level could move funds or add data: never in the observed shape.
    return fail(`Unexpected top-level instruction (${ix.programId}).`);
  }
  const cb = checkCreateComputeBudget(budget);
  if (typeof cb === "string") return fail(cb);

  // --- Panta create instruction: data
  const ix = panta[0];
  const data = decodeCreateIxData(ix.data);
  if (!data) return fail("Panta instruction is not a recognisable create_event_usdc / create_breaking_event_usdc.");
  if (data.kind !== session.marketType || data.kind !== input.marketType) return fail("Instruction market type differs from the quote.");
  if (data.paymentBase !== session.paymentBase) return fail(`Instruction payment (${data.paymentBase} base units) differs from the quoted fee (${session.paymentBase}).`);
  if (data.question !== input.question) return fail("Instruction question differs from your question.");
  if (data.resolutionRule !== input.resolutionRule) return fail("Instruction resolution rule differs from yours.");
  if (data.sources.length !== input.sourcesOfTruth.length || data.sources.some((s, k) => s !== input.sourcesOfTruth[k])) {
    return fail("Instruction sources of truth differ from yours.");
  }
  if (data.startTime !== input.startTime || data.endTime !== input.endTime || data.resolutionTime !== input.resolutionTime) {
    return fail("Instruction timeline differs from yours.");
  }
  if (data.kind === "breaking" && data.eventInProgress !== Boolean(input.eventInProgress)) return fail("Instruction 'event in progress' flag differs from yours.");

  // --- Panta create instruction: accounts (all derived locally)
  const expected = deriveCreateAccounts(wallet, input.question);
  if (expected.event !== session.expectedEventPda) return fail("Quoted event address is not derived from your wallet and question.");
  if (ix.accounts.length !== CREATE_ACCOUNT_LAYOUT.length) return fail(`Panta instruction has ${ix.accounts.length} accounts (expected ${CREATE_ACCOUNT_LAYOUT.length}).`);
  for (const [k, spec] of CREATE_ACCOUNT_LAYOUT.entries()) {
    const a = ix.accounts[k];
    if (a.pubkey !== expected[spec.name]) return fail(`Panta instruction account ${k} (${spec.name}) is not the expected address.`);
    if (a.isSigner !== spec.signer) return fail(`Panta instruction account ${spec.name} has an unexpected signer flag.`);
    if (a.isWritable !== spec.writable) return fail(`Panta instruction account ${spec.name} has an unexpected writable flag.`);
  }

  // --- no stray static keys: exactly the Panta accounts + invoked programs
  const allowed = new Set<string>([...Object.values(expected), PANTA_USDC_PROGRAM_ID, ...(budget.length ? [COMPUTE_BUDGET_PROGRAM] : [])]);
  for (const k of keys) if (!allowed.has(k)) return fail(`Transaction lists an unexpected account (${k}).`);
  if (keys.length !== allowed.size) return fail("Transaction account list differs from the observed shape.");
  const writable = new Set(CREATE_ACCOUNT_LAYOUT.filter((s) => s.writable).map((s) => expected[s.name]));
  for (const [i, k] of keys.entries()) {
    if (m.isAccountWritable(i) !== writable.has(k)) return fail(`Account ${k.slice(0, 8)}… has an unexpected writable flag.`);
    if (m.isAccountSigner(i) !== (k === wallet)) return fail("Only your wallet may sign.");
  }

  return {
    ok: true,
    txBytes: raw.length,
    instructionCount: ixs.length,
    programs: [...new Set(ixs.map((x) => x.programId))],
    computeUnitLimit: cb.limit,
    priorityFeeMicroLamports: cb.priceMicroLamports == null ? null : cb.priceMicroLamports.toString(),
    accounts: expected,
    data,
  };
}

/** Metadata + transaction, against the active session and connected wallet. */
export function verifyCreateBuild(build: CreateBuild, session: CreateSession, wallet: string | null, nowMs: number): VerifiedCreateTx | { ok: false; reason: string } {
  const meta = checkCreateBuildMetadata(build, session, wallet, nowMs);
  if (!meta.ok) return meta;
  return verifyCreateTransaction(build.transaction, { wallet: wallet!, input: session.input, session, recentBlockhash: build.recentBlockhash });
}

// ---------------------------------------------------------------------------
// On-chain fee binding (MarketConfig)
// ---------------------------------------------------------------------------

export type MarketConfigFees = {
  treasury: string;
  usdcMint: string;
  minimumStartDelay: number;
  breakingPayment: bigint;
  breakingLiquidity: bigint;
  regularPayment: bigint;
  regularLiquidity: bigint;
};

/** Decode the fields we need from the 356-byte MarketConfig account (IDL layout). null if the layout differs. */
export function decodeMarketConfig(data: Uint8Array): MarketConfigFees | null {
  const b = Buffer.from(data);
  if (b.length !== MARKET_CONFIG_LEN || b.subarray(0, 8).toString("hex") !== MARKET_CONFIG_DISCRIMINATOR) return null;
  const pk = (o: number) => new PublicKey(b.subarray(o, o + 32)).toBase58();
  // 8 disc | admin[3] 96 | relayer 32 | treasury 32 @136 | creation_fee u64 @168 | minimum_start_delay i64 @176
  // | primary_fee_bps @184 | secondary_fee_bps @192 | graduation_threshold u128 @200 | price_tick_size @216
  // | max_traverse u32 @224 | neutral_liquidity u128 @228 | usdc_mint @244 | creation_fee_usdc @276
  // | graduation_threshold_usdc u128 @284 | price_tick_size_usdc @300 | neutral_liquidity_usdc u128 @308
  // | breaking_creator_payment_usdc @324 | breaking_liquidity_injection_usdc @332
  // | regular_creator_payment_usdc @340 | regular_liquidity_injection_usdc @348 → 356
  return {
    treasury: pk(136),
    minimumStartDelay: Number(b.readBigInt64LE(176)),
    usdcMint: pk(244),
    breakingPayment: b.readBigUInt64LE(324),
    breakingLiquidity: b.readBigUInt64LE(332),
    regularPayment: b.readBigUInt64LE(340),
    regularLiquidity: b.readBigUInt64LE(348),
  };
}

/** The quoted fee must equal the on-chain fixed price for the tier (program error 6107 enforces the same). */
export function checkPaymentAgainstConfig(cfg: MarketConfigFees, session: Pick<CreateSession, "marketType" | "paymentBase" | "liquidityBase" | "platformBase">): string | null {
  if (cfg.usdcMint !== USDC_MINT) return "Panta config USDC mint is not USDC. Signing blocked.";
  if (ataAddress(new PublicKey(cfg.treasury)).toBase58() !== PANTA_TREASURY_TOKEN_ACCOUNT) return "Panta config treasury does not own the known treasury account. Signing blocked.";
  const pay = session.marketType === "breaking" ? cfg.breakingPayment : cfg.regularPayment;
  const liq = session.marketType === "breaking" ? cfg.breakingLiquidity : cfg.regularLiquidity;
  if (session.paymentBase !== pay) return `Quoted fee (${formatUsdcBaseUnits(session.paymentBase)} USDC) is not Panta's on-chain ${session.marketType} price (${formatUsdcBaseUnits(pay)} USDC). Signing blocked.`;
  if (session.liquidityBase != null && session.liquidityBase !== liq) return "Quoted liquidity injection differs from Panta's on-chain config. Signing blocked.";
  if (session.platformBase != null && session.platformBase !== pay - liq) return "Quoted platform portion differs from Panta's on-chain config. Signing blocked.";
  return null;
}

export type AccountReader = { getAccountInfo(k: PublicKey): Promise<{ owner: PublicKey; data: Uint8Array | Buffer } | null> };

/** Read MarketConfig and bind the quoted fee to it. RPC failure fails closed. */
export async function verifyPaymentOnChain(rpc: AccountReader, session: Pick<CreateSession, "marketType" | "paymentBase" | "liquidityBase" | "platformBase">): Promise<string | null> {
  let info: Awaited<ReturnType<AccountReader["getAccountInfo"]>>;
  try {
    info = await rpc.getAccountInfo(marketConfigAddress());
  } catch {
    return "Could not read Panta's market config on-chain. Signing blocked.";
  }
  if (!info) return "Panta's market config account was not found. Signing blocked.";
  if (!info.owner.equals(PANTA)) return "Market config is not owned by the Panta program. Signing blocked.";
  const cfg = decodeMarketConfig(info.data);
  if (!cfg) return "Market config has an unexpected layout. Signing blocked.";
  return checkPaymentAgainstConfig(cfg, session);
}

// ---------------------------------------------------------------------------
// Pre-sign revalidation (runs immediately before signTransaction)
// ---------------------------------------------------------------------------

export type PreSignArgs = {
  connectedWallet: string | null;
  session: CreateSession | null;
  currentInput: CreateInput;
  build: CreateBuild | null;
  nowMs: number;
  network: NetworkCheck;
  /** Result of verifyPaymentOnChain (null = bound). */
  paymentOnChain: string | null;
};

export function preSignCreateCheck(a: PreSignArgs): VerifiedCreateTx | { ok: false; reason: string } {
  if (!a.network.ok) return { ok: false, reason: a.network.message };
  if (!a.session) return fail("No active quote.");
  if (!a.build) return fail("No verified build.");
  const stale = sessionStaleReason(a.session, a.currentInput, a.connectedWallet, a.nowMs + CREATE_EXPIRY_MARGIN_MS);
  if (stale) return fail(stale);
  if (a.paymentOnChain) return { ok: false, reason: a.paymentOnChain };
  return verifyCreateBuild(a.build, a.session, a.connectedWallet, a.nowMs);
}

// ---------------------------------------------------------------------------
// Registration (frozen createId + signature only)
// ---------------------------------------------------------------------------

export type FrozenRegistration = Readonly<{ createId: string; signature: string; expectedEventPda: string }>;

/** Freeze the exact createId + signature at broadcast time; registration only ever uses this pair. */
export function freezeRegistration(session: Pick<CreateSession, "createId" | "expectedEventPda">, signature: string): FrozenRegistration {
  if (!CREATE_ID_RE.test(session.createId)) throw new CreateBlocked("createId is not valid.");
  if (!SIGNATURE_RE.test(signature)) throw new CreateBlocked("Transaction signature is not valid.");
  return Object.freeze({ createId: session.createId, signature, expectedEventPda: session.expectedEventPda });
}

/** Body for POST /markets/register/. Refuses to pair a different createId with the frozen signature. */
export function registerBody(frozen: FrozenRegistration, createId: string = frozen.createId, signature: string = frozen.signature): { createId: string; signature: string } {
  if (createId !== frozen.createId || signature !== frozen.signature) {
    throw new CreateBlocked("This signature belongs to a different create session. Registration blocked.");
  }
  return { createId: frozen.createId, signature: frozen.signature };
}

/**
 * POST /markets/register/ response (docs.panta.market/api-reference/markets/register):
 * marketId is documented as the event address ("<eventPda>", "used as the
 * market id in later APIs"); status is "registered" on success; signature is
 * echoed in the documented example but we only require it to match when present.
 */
export const CreateRegisterSchema = z.looseObject({
  createId: z.string(),
  marketId: z.string(),
  status: z.string(),
  signature: z.string().optional(),
  // Display-only fields: a null here must not turn a confirmed creation into "needs attention".
  category: z.string().nullish(),
  title: z.string().nullish(),
  images: z.array(z.string()).nullish(),
});

export type RegisterReceipt = { marketId: string; signature: string; status: "registered"; createId: string; title: string | null; category: string | null };

export function checkRegisterResponse(raw: unknown, frozen: FrozenRegistration): ({ ok: true } & RegisterReceipt) | { ok: false; reason: string } {
  const r = CreateRegisterSchema.safeParse(raw);
  if (!r.success) return { ok: false, reason: "Panta registration response has an unexpected shape." };
  const d = r.data;
  if (d.createId !== frozen.createId) return { ok: false, reason: "Registration response is for a different create session." };
  if (d.signature !== undefined && d.signature !== frozen.signature) return { ok: false, reason: "Registration response is for a different transaction." };
  if (!BASE58_PUBKEY_RE.test(d.marketId) || !key(d.marketId)) return { ok: false, reason: "Registration returned an invalid market id." };
  if (d.marketId !== frozen.expectedEventPda) return { ok: false, reason: "Registered market id is not the quoted event address." };
  if (d.status !== "registered") return { ok: false, reason: `Registration status is “${d.status.slice(0, 32)}”, not registered.` };
  return { ok: true, marketId: d.marketId, signature: frozen.signature, status: "registered", createId: d.createId, title: d.title ?? null, category: d.category ?? null };
}
