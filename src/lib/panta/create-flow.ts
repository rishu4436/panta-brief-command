/**
 * Create Market orchestration with injected I/O, so every gate is testable:
 * image grant + direct Cloudinary upload, quote, build (mainnet check first,
 * then strict verification), simulation (defense in depth), final pre-sign
 * checks, wallet signature, broadcast, confirmation, registration and
 * registration recovery. Each network action is single-flight: a double
 * click joins the request already in flight instead of starting another.
 *
 * Ordering (Stage B):
 *   build → validator (create-market.ts, authoritative)
 *   → FINAL CHECK #1 (mainnet, stale state, validator, size, on-chain tier
 *     price, balances) → simulate exact validated bytes → evidence analysis
 *   → review → FINAL CHECK #2 (same + review snapshot + simulation bound to
 *     these exact bytes) → wallet signs the exact deserialized transaction
 *   → signed message bytes must equal the validated message bytes
 *   → recovery record persisted (signature frozen) → broadcast (preflight on)
 *   → confirm (blockhash + lastValidBlockHeight) → register frozen pair.
 * After a signature exists nothing here quotes, builds, simulates or asks
 * for another signature for that createId.
 */

import { Buffer } from "buffer";
import bs58 from "bs58";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import type { NetworkCheck } from "@/lib/network";
import { SingleFlight } from "@/lib/single-flight";
import type { ConfirmOutcome } from "@/lib/solana";
import {
  bindCreateQuote,
  checkRegisterResponse,
  CreateBlocked,
  freezeRegistration,
  parseCreateBuild,
  preSignCreateCheck,
  registerBody,
  verifyCreateBuild,
  verifyPaymentOnChain,
  type AccountReader,
  type CreateBuild,
  type CreateSession,
  type FrozenRegistration,
  type RegisterReceipt,
  type VerifiedCreateTx,
} from "./create-market";
import {
  analyzeCreateSimulation,
  balanceProblem,
  createSimulationParams,
  messageFeeLamports,
  readCreateBalances,
  txHash,
  type BalanceReader,
  type Balances,
  type SimEvidence,
} from "./create-simulation";
import type { CreateRecoveryRecord, CreateRecoveryStore, RecoveryStage } from "./create-recovery";
import {
  createInputErrors,
  createInputFingerprint,
  imageFileError,
  parseCloudinaryUpload,
  parseImageUploadGrant,
  SOLANA_PACKET_BYTES,
  timelineConfirmationError,
  type CreateInput,
  type TimelineConfirmation,
} from "./create-rules";

/**
 * Stage B: wallet signing is available, but only through approveAndBroadcast,
 * i.e. after every invariant below has passed in this session.
 */
export const CREATE_SIGNING_ENABLED = true;
export const CREATE_SIGNING_DISABLED_COPY = "Signing not yet enabled — transaction validation under review";

export type CreateFlowDeps = {
  /** POST to /api/panta/<path> (JSON). Throws on non-2xx. */
  postPanta: (path: "markets/create/image-upload" | "markets/create/quote" | "markets/create/build" | "markets/register", body: unknown) => Promise<unknown>;
  /** Direct multipart POST to the Cloudinary URL from the grant (never through our server). */
  postUpload: (url: string, form: FormData) => Promise<unknown>;
  checkNetwork: () => Promise<NetworkCheck>;
  rpc: AccountReader;
  now: () => number;
  // ---- Stage B (signing path). Missing → the signing actions refuse to run.
  /** Wallet SOL + creator USDC account reads (same relay). */
  balances?: BalanceReader;
  /** Raw JSON-RPC simulateTransaction: returns the `result` object ({ context, value }). Throws on RPC error. */
  simulate?: (params: [string, Record<string, unknown>]) => Promise<unknown>;
  /** Wallet adapter signTransaction (never signAndSend). */
  signTransaction?: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
  /** sendRawTransaction with preflight ON (skipPreflight: false). Returns the signature. */
  sendRawTransaction?: (bytes: Uint8Array) => Promise<string>;
  /** Existing hardened confirmation (src/lib/solana.ts confirmSignature). */
  confirm?: (signature: string, recentBlockhash: string, lastValidBlockHeight: number) => Promise<ConfirmOutcome>;
  /** Existing one-shot status check (src/lib/solana.ts checkSignatureOnce). */
  checkSignature?: (signature: string, lastValidBlockHeight: number) => Promise<ConfirmOutcome>;
  recovery?: CreateRecoveryStore;
  /** Invalidate catalog / market / positions caches after a successful registration. */
  invalidateAfterCreate?: (marketId: string) => void;
  /** createIds already signed; pass a page-lifetime set so a re-created actions object still refuses them. */
  signedCreateIds?: Set<string>;
};

export type VerifiedBuild = { build: CreateBuild; verified: VerifiedCreateTx; paymentOnChain: string | null };

/** What the user reviewed; signing requires the live session/build to still match it exactly. */
export type ReviewSnapshot = Readonly<{
  wallet: string;
  fingerprint: string;
  createId: string;
  expectedEventPda: string;
  marketType: CreateSession["marketType"];
  paymentBase: bigint;
  txHash: string;
}>;

/** Checks actually performed in this session (the review's ✓ list is derived from these, never assumed). */
export type CreateChecks = Readonly<{
  mainnet: boolean;
  binding: boolean;
  eventPda: boolean;
  payment: boolean;
  instruction: boolean;
  accounts: boolean;
  size: boolean;
  tierPrice: boolean;
  simulation: boolean;
}>;

export type SimulatedBuild = Readonly<{
  verified: VerifiedCreateTx;
  sim: SimEvidence;
  balances: Balances;
  feeLamports: bigint;
  snapshot: ReviewSnapshot;
  checks: CreateChecks;
}>;

export type StaleArgs = { session: CreateSession | null; build: CreateBuild | null; currentInput: CreateInput; connectedWallet: string | null };

export class WalletRejected extends Error {}

export type BroadcastResult = Readonly<{
  kind: "confirmed" | "chain_failed" | "expired" | "uncertain";
  message: string | null;
  frozen: FrozenRegistration;
  record: CreateRecoveryRecord;
  /** false → recovery could not be written durably; the UI must show the signature. */
  durable: boolean;
}>;

export function snapshotOf(session: CreateSession, build: CreateBuild, wallet: string): ReviewSnapshot {
  return Object.freeze({
    wallet,
    fingerprint: session.fingerprint,
    createId: session.createId,
    expectedEventPda: session.expectedEventPda,
    marketType: session.marketType,
    paymentBase: session.paymentBase,
    txHash: txHash(build.transaction),
  });
}

function snapshotMismatch(s: ReviewSnapshot, session: CreateSession, build: CreateBuild, wallet: string | null, input: CreateInput): string | null {
  if (wallet !== s.wallet) return "Connected wallet changed since review.";
  if (createInputFingerprint(input) !== s.fingerprint || session.fingerprint !== s.fingerprint) return "Market details changed since review.";
  if (session.createId !== s.createId || build.createId !== s.createId) return "Create session changed since review.";
  if (session.expectedEventPda !== s.expectedEventPda || build.expectedEventPda !== s.expectedEventPda) return "Event address changed since review.";
  if (session.marketType !== s.marketType || build.marketType !== s.marketType) return "Market type changed since review.";
  if (session.paymentBase !== s.paymentBase || BigInt(build.paymentUsdc) !== s.paymentBase) return "Payment changed since review.";
  if (txHash(build.transaction) !== s.txHash) return "Transaction changed since review.";
  return null;
}

function record(session: CreateSession, build: CreateBuild, wallet: string, signature: string, stage: RecoveryStage, now: number, lastError: string | null = null): CreateRecoveryRecord {
  return {
    v: 1,
    wallet,
    createId: session.createId,
    signature,
    expectedEventPda: session.expectedEventPda,
    marketType: session.marketType,
    paymentBase: session.paymentBase.toString(),
    question: session.input.question,
    title: session.input.title ?? null,
    recentBlockhash: build.recentBlockhash,
    lastValidBlockHeight: build.lastValidBlockHeight,
    stage,
    lastError,
    savedAt: Math.max(1, Math.floor(now)),
  };
}

export function createMarketActions(deps: CreateFlowDeps) {
  const uploadFlight = new SingleFlight<string>();
  const quoteFlight = new SingleFlight<CreateSession>();
  const buildFlight = new SingleFlight<VerifiedBuild>();
  const simulateFlight = new SingleFlight<SimulatedBuild>();
  const signFlight = new SingleFlight<BroadcastResult>();
  const statusFlight = new SingleFlight<BroadcastResult>();
  const registerFlight = new SingleFlight<RegisterReceipt>();
  /** createIds that already produced a wallet signature in this page: never signed again. */
  const signedCreateIds = deps.signedCreateIds ?? new Set<string>();

  const need = <K extends keyof CreateFlowDeps>(k: K): NonNullable<CreateFlowDeps[K]> => {
    const v = deps[k];
    if (!v) throw new CreateBlocked(`Signing path is not configured (${String(k)}). Signing blocked.`);
    return v as NonNullable<CreateFlowDeps[K]>;
  };

  /**
   * FINAL STALE-STATE CHECK (run before simulation and again before signing):
   * mainnet; same wallet / inputs / createId / event PDA / type / exact
   * payment; quote and build unexpired with margin; validator passes
   * (incl. ≤ 1232 bytes); on-chain tier price == payment; balances.
   */
  async function finalCheck(a: StaleArgs, rentLamports: bigint) {
    const network = await deps.checkNetwork();
    if (!network.ok) throw new CreateBlocked(network.message);
    if (!a.session || !a.build) throw new CreateBlocked("No active quote and build. Signing blocked.");
    const paymentOnChain = await verifyPaymentOnChain(deps.rpc, a.session);
    const v = preSignCreateCheck({ ...a, nowMs: deps.now(), network, paymentOnChain });
    if (!v.ok) throw new CreateBlocked(v.reason);
    if (v.txBytes > SOLANA_PACKET_BYTES) throw new CreateBlocked("Transaction is over the Solana size limit. Signing blocked.");
    let balances: Balances;
    try {
      balances = await readCreateBalances(need("balances"), a.connectedWallet!, v.accounts.creatorTokenAccount);
    } catch (e) {
      if (e instanceof CreateBlocked) throw e;
      throw new CreateBlocked(`Could not read your balances (${e instanceof Error ? e.message.slice(0, 80) : "RPC error"}). Signing blocked.`);
    }
    const feeLamports = messageFeeLamports(a.build.transaction);
    const problem = balanceProblem(balances, a.session.paymentBase, feeLamports, rentLamports);
    if (problem) throw new CreateBlocked(problem);
    return { verified: v, balances, feeLamports };
  }

  function resolveOutcome(o: ConfirmOutcome, rec: CreateRecoveryRecord, frozen: FrozenRegistration, durable0: boolean, eventExists: boolean | null): BroadcastResult {
    const store = deps.recovery;
    if (o.status === "confirmed") {
      const r = { ...rec, stage: "confirmed" as const, savedAt: Math.max(1, Math.floor(deps.now())) };
      const durable = store ? store.save(r) : false;
      return Object.freeze({ kind: "confirmed", message: null, frozen, record: r, durable: durable && durable0 });
    }
    if (o.status === "failed") {
      store?.clear(rec.wallet);
      return Object.freeze({ kind: "chain_failed", message: o.message, frozen, record: rec, durable: durable0 });
    }
    if (o.status === "expired" && eventExists === false) {
      store?.clear(rec.wallet);
      return Object.freeze({ kind: "expired", message: o.message, frozen, record: rec, durable: durable0 });
    }
    const why =
      o.status === "expired"
        ? eventExists
          ? "Blockhash expired, but the market's event account exists on-chain. Do not create again; check status."
          : "Blockhash expired but the event account could not be checked. Do not create again; check status."
        : o.message;
    return Object.freeze({ kind: "uncertain", message: why, frozen, record: rec, durable: durable0 });
  }

  async function eventAccountExists(eventPda: string): Promise<boolean | null> {
    try {
      const info = await deps.rpc.getAccountInfo(new PublicKey(eventPda));
      return info != null;
    } catch {
      return null;
    }
  }

  return {
    /** Signed grant from Panta, then the file goes straight to Cloudinary. Returns the validated delivery URL. */
    uploadImage(file: File): Promise<string> {
      return uploadFlight.run(async () => {
        const bad = imageFileError(file);
        if (bad) throw new CreateBlocked(bad);
        const grant = parseImageUploadGrant(await deps.postPanta("markets/create/image-upload", {}), deps.now());
        const form = new FormData();
        for (const [k, v] of Object.entries(grant.fields)) form.append(k, v);
        form.append("file", file);
        return parseCloudinaryUpload(await deps.postUpload(grant.uploadUrl, form), grant);
      });
    },

    /**
     * Quote only after every client guard passes (including an explicit
     * timeline confirmation — untouched suggested defaults don't count); the
     * result is bound to the exact input. One request per click; no retry.
     */
    quote(input: CreateInput, timeline: TimelineConfirmation): Promise<CreateSession> {
      return quoteFlight.run(async () => {
        const unconfirmed = timelineConfirmationError(timeline);
        if (unconfirmed) throw new CreateBlocked(unconfirmed);
        const errors = createInputErrors(input, Math.floor(deps.now() / 1000));
        const first = Object.values(errors)[0];
        if (first) throw new CreateBlocked(first);
        const raw = await deps.postPanta("markets/create/quote", input);
        return bindCreateQuote(raw, input, deps.now());
      });
    },

    /** Mainnet check BEFORE asking Panta to build; then strict verification + on-chain fee binding. One request per click; no retry. */
    build(session: CreateSession, wallet: string | null): Promise<VerifiedBuild> {
      return buildFlight.run(async () => {
        if (!wallet || wallet !== session.input.wallet) throw new CreateBlocked("Connected wallet differs from the quoted wallet.");
        if (signedCreateIds.has(session.createId)) throw new CreateBlocked("This create session was already signed. Start a new creation.");
        const net = await deps.checkNetwork();
        if (!net.ok) throw new CreateBlocked(net.message);
        const build = parseCreateBuild(await deps.postPanta("markets/create/build", { createId: session.createId, wallet }));
        const verified = verifyCreateBuild(build, session, wallet, deps.now());
        if (!verified.ok) throw new CreateBlocked(verified.reason);
        const paymentOnChain = await verifyPaymentOnChain(deps.rpc, session);
        return { build, verified, paymentOnChain };
      });
    },

    /**
     * Stage A pre-sign revalidation (kept): network, wallet, inputs, expiry,
     * on-chain fee, full tx. Returns the verification; does not sign.
     */
    async revalidateBeforeSign(args: StaleArgs) {
      const network = await deps.checkNetwork();
      if (!network.ok) return { ok: false as const, reason: network.message };
      const paymentOnChain = args.session ? await verifyPaymentOnChain(deps.rpc, args.session) : null;
      return preSignCreateCheck({ ...args, nowMs: deps.now(), network, paymentOnChain });
    },

    /**
     * FINAL CHECK #1 → balances → simulate the exact validated bytes →
     * evidence analysis (fail closed on missing evidence) → exact SOL check
     * with the simulated rent. Never signs.
     */
    simulate(args: StaleArgs): Promise<SimulatedBuild> {
      return simulateFlight.run(async () => {
        const simulate = need("simulate");
        if (args.session && signedCreateIds.has(args.session.createId)) throw new CreateBlocked("This create session was already signed.");
        const { verified, balances, feeLamports } = await finalCheck(args, BigInt(0));
        const session = args.session!;
        const build = args.build!;
        const wallet = args.connectedWallet!;
        let raw: unknown;
        try {
          raw = await simulate(createSimulationParams(build.transaction, wallet, verified.accounts.creatorTokenAccount));
        } catch (e) {
          throw new CreateBlocked(`Simulation unavailable (${e instanceof Error ? e.message.slice(0, 100) : "RPC error"}). Signing blocked.`);
        }
        const r = analyzeCreateSimulation(raw, {
          txBase64: build.transaction,
          wallet,
          accounts: verified.accounts,
          marketType: session.marketType,
          paymentBase: session.paymentBase,
          liquidityBase: session.liquidityBase,
          platformBase: session.platformBase,
        });
        if (!r.ok) throw new CreateBlocked(r.reason);
        const problem = balanceProblem(balances, session.paymentBase, feeLamports, r.evidence.rentLamports);
        if (problem) throw new CreateBlocked(problem);
        const checks: CreateChecks = Object.freeze({
          mainnet: true,
          binding: true,
          eventPda: true,
          payment: true,
          instruction: true,
          accounts: true,
          size: verified.txBytes <= SOLANA_PACKET_BYTES,
          tierPrice: true,
          simulation: true,
        });
        return Object.freeze({ verified, sim: r.evidence, balances, feeLamports, snapshot: snapshotOf(session, build, wallet), checks });
      });
    },

    /**
     * FINAL CHECK #2 → wallet signs the exact validated transaction → signed
     * message must equal the validated message → persist recovery (frozen
     * createId + signature) → broadcast once (preflight on) → confirm.
     * Wallet rejection throws WalletRejected (nothing broadcast). Never
     * rebuilds, re-signs or re-broadcasts.
     */
    approveAndBroadcast(args: StaleArgs & { simulated: SimulatedBuild; onPhase?: (p: "WALLET_APPROVAL" | "BROADCAST" | "CONFIRMATION", info?: { signature: string; durable: boolean }) => void }): Promise<BroadcastResult> {
      return signFlight.run(async () => {
        if (!CREATE_SIGNING_ENABLED) throw new CreateBlocked(CREATE_SIGNING_DISABLED_COPY);
        const signTransaction = need("signTransaction");
        const sendRaw = need("sendRawTransaction");
        const confirm = need("confirm");
        const store = need("recovery");
        const { session, build, connectedWallet } = args;
        if (!session || !build || !connectedWallet) throw new CreateBlocked("No active review. Signing blocked.");
        if (signedCreateIds.has(session.createId)) throw new CreateBlocked("This create session was already signed. It will not be signed again.");
        if (store.load(connectedWallet)) throw new CreateBlocked("A previous creation from this wallet is still unresolved. Resolve it before creating another.");
        const sim = args.simulated;
        const mismatch = snapshotMismatch(sim.snapshot, session, build, connectedWallet, args.currentInput);
        if (mismatch) throw new CreateBlocked(`${mismatch} Signing blocked.`);
        if (sim.sim.txHash !== txHash(build.transaction)) throw new CreateBlocked("Simulation was for different transaction bytes. Signing blocked.");
        await finalCheck(args, sim.sim.rentLamports);

        // Exact bytes: deserialize the validated build, sign that object, compare.
        const raw = Buffer.from(build.transaction, "base64");
        const tx = VersionedTransaction.deserialize(raw);
        const validatedMessage = Buffer.from(tx.message.serialize());
        if (raw[0] !== 1 || !raw.subarray(1 + 64).equals(validatedMessage)) throw new CreateBlocked("Decoded transaction does not reproduce the validated bytes. Signing blocked.");

        args.onPhase?.("WALLET_APPROVAL");
        let signed: VersionedTransaction;
        try {
          signed = await signTransaction(tx);
        } catch (e) {
          throw new WalletRejected(e instanceof Error && e.message ? e.message.slice(0, 160) : "Wallet request was rejected.");
        }
        const signedMessage = Buffer.from(signed.message.serialize());
        if (!signedMessage.equals(validatedMessage)) throw new CreateBlocked("Wallet returned a different transaction than the one validated. Not broadcast.");
        if (signed.signatures.length !== 1 || signed.signatures[0].length !== 64 || signed.signatures[0].every((b) => b === 0)) {
          throw new CreateBlocked("Wallet did not return exactly one signature. Not broadcast.");
        }
        const wire = Buffer.from(signed.serialize());
        if (wire.length > SOLANA_PACKET_BYTES || !wire.subarray(1 + 64).equals(validatedMessage)) throw new CreateBlocked("Signed transaction differs from the validated bytes. Not broadcast.");
        const signature = bs58.encode(signed.signatures[0]);
        signedCreateIds.add(session.createId);
        const frozen = freezeRegistration(session, signature);

        // Persist BEFORE broadcast: from here on the transaction may land.
        const rec = record(session, build, connectedWallet, signature, "signed", deps.now());
        const durable = store.save(rec);
        args.onPhase?.("BROADCAST", { signature, durable });
        try {
          const returned = await sendRaw(new Uint8Array(wire));
          if (returned !== signature) {
            return resolveOutcome({ status: "pending", message: "RPC returned a different signature. Check status before doing anything else." }, rec, frozen, durable, null);
          }
        } catch (e) {
          // A send error is not proof the transaction was not forwarded: treat as uncertain.
          const msg = e instanceof Error ? e.message.slice(0, 160) : "send failed";
          return resolveOutcome({ status: "pending", message: `Broadcast reported an error (${msg}). The transaction may or may not have been sent — check status.` }, rec, frozen, durable, null);
        }
        const sent = { ...rec, stage: "broadcast" as const };
        const durable2 = store.save(sent) && durable;
        args.onPhase?.("CONFIRMATION", { signature, durable: durable2 });
        let outcome: ConfirmOutcome;
        try {
          outcome = await confirm(signature, build.recentBlockhash, build.lastValidBlockHeight);
        } catch (e) {
          // RPC trouble while confirming is uncertainty, never failure: check status, never re-sign.
          outcome = { status: "pending", message: `Could not confirm (${e instanceof Error ? e.message.slice(0, 120) : "RPC error"}). Check status.` };
        }
        const ev = outcome.status === "expired" ? await eventAccountExists(session.expectedEventPda) : null;
        return resolveOutcome(outcome, sent, frozen, durable2, ev);
      });
    },

    /** Ambiguous confirmation: one status check (+ event account) — never rebuilds or re-signs. */
    checkStatus(rec: CreateRecoveryRecord): Promise<BroadcastResult> {
      return statusFlight.run(async () => {
        const check = need("checkSignature");
        const frozen = freezeRegistration({ createId: rec.createId, expectedEventPda: rec.expectedEventPda }, rec.signature);
        let outcome: ConfirmOutcome;
        try {
          outcome = await check(rec.signature, rec.lastValidBlockHeight);
        } catch (e) {
          outcome = { status: "pending", message: `Status check failed (${e instanceof Error ? e.message.slice(0, 120) : "RPC error"}). Try again shortly.` };
        }
        const ev = outcome.status === "confirmed" || outcome.status === "failed" ? null : await eventAccountExists(rec.expectedEventPda);
        const r = resolveOutcome(outcome, rec, frozen, true, ev);
        if (r.kind === "uncertain" && ev) return Object.freeze({ ...r, message: "The market's event account exists on-chain, but the signature is not confirmed yet. Do not create again; check again shortly." });
        return r;
      });
    },

    /** Registration (and retry) with the frozen pair only. Never quotes, builds, simulates, signs or broadcasts. */
    register(frozen: FrozenRegistration): Promise<RegisterReceipt> {
      return registerFlight.run(async () => {
        const raw = await deps.postPanta("markets/register", registerBody(frozen));
        const r = checkRegisterResponse(raw, frozen);
        if (!r.ok) throw new CreateBlocked(r.reason);
        return r;
      });
    },

    /**
     * Register from the durable record (first attempt and every retry): same
     * createId + signature, single-flight, persists needs-attention on failure,
     * clears the record and invalidates caches on success.
     */
    registerFromRecord(rec: CreateRecoveryRecord): Promise<RegisterReceipt> {
      return registerFlight.run(async () => {
        const frozen = freezeRegistration({ createId: rec.createId, expectedEventPda: rec.expectedEventPda }, rec.signature);
        try {
          const raw = await deps.postPanta("markets/register", registerBody(frozen));
          const r = checkRegisterResponse(raw, frozen);
          if (!r.ok) throw new CreateBlocked(r.reason);
          deps.recovery?.clear(rec.wallet);
          deps.invalidateAfterCreate?.(r.marketId);
          return r;
        } catch (e) {
          const msg = e instanceof Error ? e.message.slice(0, 280) : "Registration failed.";
          deps.recovery?.save({ ...rec, stage: "registration_needs_attention", lastError: msg, savedAt: Math.max(1, Math.floor(deps.now())) });
          throw e;
        }
      });
    },

    get busy() {
      return {
        upload: uploadFlight.running,
        quote: quoteFlight.running,
        build: buildFlight.running,
        simulate: simulateFlight.running,
        sign: signFlight.running,
        status: statusFlight.running,
        register: registerFlight.running,
      };
    },
  };
}
