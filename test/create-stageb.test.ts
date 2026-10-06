/**
 * Phase 3 · Create Market — Stage B (signing path), all against fixtures and
 * mocks (nothing is signed with a real key, nothing is sent anywhere):
 *
 *  AA/AB balances · AC–AF simulation evidence (fail closed) · AG–AI final
 *  stale-state check · AJ/AK wallet · AL/AM broadcast + confirmation · AN–AQ
 *  registration recovery · AR–AT register validation · AU cache invalidation
 *  · AV/AW size boundary · state machine · recovery store · INVALID_MARKET_PARAMS.
 *
 * The simulation fixtures are REAL read-only mainnet simulateTransaction
 * results captured 2026-10-06 (test/fixtures/create-sim.live-2026-10-06.json):
 * `funded` (public funded wallet pubkey, success path, nothing signed) and
 * `test` (the 1.54 USDC test wallet, Token program "insufficient funds").
 */
import { Buffer } from "buffer";
import bs58 from "bs58";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { createMarketActions, snapshotOf, WalletRejected, type CreateFlowDeps, type SimulatedBuild } from "@/lib/panta/create-flow";
import { bindCreateQuote, deriveCreateAccounts, parseCreateBuild, verifyCreateTransaction, type CreateBuild } from "@/lib/panta/create-market";
import { CREATE_TRANSITIONS, canTransition, IllegalTransition, MAY_BE_BROADCAST, phaseForRecoveryStage, transition, type CreatePhase } from "@/lib/panta/create-machine";
import { CREATE_RECOVERY_PREFIX, createRecoveryStore, type CreateRecoveryRecord, type KV } from "@/lib/panta/create-recovery";
import { analyzeCreateSimulation, createSimulationParams, INSUFFICIENT_SOL, INSUFFICIENT_USDC, messageFeeLamports } from "@/lib/panta/create-simulation";
import { TOKEN_PROGRAM, USDC_MINT } from "@/lib/panta/primary-order";
import { checkSimulateParams } from "@/lib/rpc-relay";
import type { NetworkCheck } from "@/lib/network";
import type { CreateInput } from "@/lib/panta/create-rules";
import simFx from "./fixtures/create-sim.live-2026-10-06.json";
import { FX, inputOf, mutateTx } from "./create-helpers";

type SimScenario = {
  wallet: string;
  request: CreateInput & Record<string, unknown>;
  quote: Record<string, unknown> & { createId: string; expectedEventPda: string; paymentUsdc: string };
  build: Record<string, unknown> & { transaction: string; expiresAt: string; recentBlockhash: string; lastValidBlockHeight: number; createId: string };
  simulation: { context: { slot: number }; value: Record<string, unknown> & { accounts: unknown[] } };
};
const F = (simFx as unknown as { funded: SimScenario }).funded;
const T = (simFx as unknown as { test: SimScenario }).test;
const WALLET = F.wallet;
const input = inputOf(F as never);
const NOW = Date.parse(F.build.expiresAt) - 30_000;
const ACC = deriveCreateAccounts(WALLET, input.question);
const PAYMENT = BigInt(20_000_000);
const FEE = BigInt(5000);
const RENT = BigInt(22_250_400);
const MAINNET: NetworkCheck = { ok: true };
const SIGBYTES = new Uint8Array(64).fill(9);
const SIG = bs58.encode(SIGBYTES);

const clone = <X,>(x: X): X => JSON.parse(JSON.stringify(x)) as X;
/** The fixture requested 11 post-state accounts for discovery; the app requests exactly [wallet, creator USDC]. */
function simOf(s: SimScenario = F, mut?: (v: Record<string, unknown> & { accounts: unknown[] }) => void) {
  const r = clone(s.simulation);
  r.value.accounts = r.value.accounts.slice(0, 2);
  mut?.(r.value);
  return r;
}

function tokenData(mint: string, owner: string, amount: bigint): Buffer {
  const b = Buffer.alloc(165);
  new PublicKey(mint).toBuffer().copy(b, 0);
  new PublicKey(owner).toBuffer().copy(b, 32);
  b.writeBigUInt64LE(amount, 64);
  b[108] = 1;
  return b;
}

function configData(breakingPayment?: bigint): Buffer {
  const b = Buffer.from(FX.marketConfig.dataBase64, "base64");
  if (breakingPayment != null) b.writeBigUInt64LE(breakingPayment, 324);
  return b;
}

type World = {
  lamports: bigint;
  usdc: bigint;
  breakingPrice?: bigint;
  eventExists: boolean;
  now: number;
  network: NetworkCheck;
};

function harness(over: Partial<CreateFlowDeps> = {}, w: Partial<World> = {}) {
  const world: World = { lamports: BigInt(1_000_000_000), usdc: BigInt(25_000_000), eventExists: false, now: NOW, network: MAINNET, ...w };
  const kvMap = new Map<string, string>();
  const kv: KV = {
    getItem: (k) => kvMap.get(k) ?? null,
    setItem: (k, v) => void kvMap.set(k, v),
    removeItem: (k) => void kvMap.delete(k),
    key: (i) => [...kvMap.keys()][i] ?? null,
    get length() {
      return kvMap.size;
    },
  };
  const recovery = createRecoveryStore(() => kv);
  const postPanta = vi.fn<CreateFlowDeps["postPanta"]>(async (path) => {
    if (path === "markets/create/quote") return F.quote;
    if (path === "markets/create/build") return F.build;
    if (path === "markets/register") return { createId: F.quote.createId, signature: SIG, marketId: F.quote.expectedEventPda, status: "registered", title: null };
    throw new Error(`unexpected ${path}`);
  });
  const rpc = {
    getAccountInfo: vi.fn(async (k: PublicKey) => {
      if (k.toBase58() === ACC.event) return world.eventExists ? { owner: new PublicKey(FX.marketConfig.owner), data: Buffer.alloc(8) } : null;
      return { owner: new PublicKey(FX.marketConfig.owner), data: configData(world.breakingPrice) };
    }),
  };
  const balances = {
    getAccountInfo: vi.fn(async (k: PublicKey) => {
      const s = k.toBase58();
      if (s === WALLET) return { lamports: Number(world.lamports), owner: new PublicKey("11111111111111111111111111111111"), data: Buffer.alloc(0) };
      if (s === ACC.creatorTokenAccount) return { lamports: 2_039_280, owner: new PublicKey(TOKEN_PROGRAM), data: tokenData(USDC_MINT, WALLET, world.usdc) };
      return null;
    }),
  };
  const simulate = vi.fn<NonNullable<CreateFlowDeps["simulate"]>>(async () => simOf());
  const signTransaction = vi.fn<NonNullable<CreateFlowDeps["signTransaction"]>>(async (tx) => new VersionedTransaction(tx.message, [SIGBYTES]));
  const sendRawTransaction = vi.fn<NonNullable<CreateFlowDeps["sendRawTransaction"]>>(async () => SIG);
  const confirm = vi.fn<NonNullable<CreateFlowDeps["confirm"]>>(async () => ({ status: "confirmed" as const }));
  const checkSignature = vi.fn<NonNullable<CreateFlowDeps["checkSignature"]>>(async () => ({ status: "confirmed" as const }));
  const invalidateAfterCreate = vi.fn<NonNullable<CreateFlowDeps["invalidateAfterCreate"]>>();
  const checkNetwork = vi.fn(async () => world.network);
  const d: CreateFlowDeps = {
    postPanta,
    postUpload: vi.fn(),
    checkNetwork,
    rpc,
    now: () => world.now,
    balances,
    simulate,
    signTransaction,
    sendRawTransaction,
    confirm,
    checkSignature,
    recovery,
    invalidateAfterCreate,
    ...over,
  };
  const actions = createMarketActions(d);
  const session = bindCreateQuote(F.quote, input, NOW);
  const build: CreateBuild = parseCreateBuild(F.build);
  const args = (o: Partial<{ build: CreateBuild; input: CreateInput; wallet: string | null }> = {}) => ({
    session,
    build: o.build ?? build,
    currentInput: o.input ?? input,
    connectedWallet: o.wallet === undefined ? WALLET : o.wallet,
  });
  const paths = () => postPanta.mock.calls.map((c) => c[0]);
  return { world, kvMap, recovery, postPanta, rpc, balances, simulate, signTransaction, sendRawTransaction, confirm, checkSignature, invalidateAfterCreate, checkNetwork, actions, session, build, args, paths };
}

async function simulated(h: ReturnType<typeof harness>): Promise<SimulatedBuild> {
  return h.actions.simulate(h.args());
}
async function approve(h: ReturnType<typeof harness>, sim?: SimulatedBuild, phases: string[] = []) {
  const s = sim ?? (await simulated(h));
  return h.actions.approveAndBroadcast({ ...h.args(), simulated: s, onPhase: (p) => phases.push(p) });
}
const nothingSent = (h: ReturnType<typeof harness>) => {
  expect(h.sendRawTransaction).not.toHaveBeenCalled();
  expect(h.paths()).not.toContain("markets/register");
};

// ---------------------------------------------------------------------------

describe("baseline: the real funded-wallet simulation passes every evidence check", () => {
  it("analyzer proves USDC −20.000000 exactly, the 5/15 split, fee + rent SOL", () => {
    const r = analyzeCreateSimulation(simOf(), {
      txBase64: F.build.transaction,
      wallet: WALLET,
      accounts: ACC,
      marketType: "breaking",
      paymentBase: PAYMENT,
      liquidityBase: BigInt(5_000_000),
      platformBase: BigInt(15_000_000),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.evidence.usdcDelta).toBe(-PAYMENT);
    expect(r.evidence.feeLamports).toBe(FEE);
    expect(r.evidence.rentLamports).toBe(RENT);
    expect(r.evidence.walletSolDelta).toBe(-(FEE + RENT));
    expect(r.evidence.createdAccounts).toHaveLength(6);
  });
  it("full pipeline: simulate → approve → confirmed → register → success", async () => {
    const h = harness();
    const phases: string[] = [];
    const sim = await simulated(h);
    expect(Object.values(sim.checks).every(Boolean)).toBe(true);
    expect(h.simulate).toHaveBeenCalledWith(createSimulationParams(F.build.transaction, WALLET, ACC.creatorTokenAccount));
    const res = await approve(h, sim, phases);
    expect(phases).toEqual(["WALLET_APPROVAL", "BROADCAST", "CONFIRMATION"]);
    expect(res.kind).toBe("confirmed");
    expect(res.frozen).toEqual({ createId: F.quote.createId, signature: SIG, expectedEventPda: ACC.event });
    expect(h.recovery.load(WALLET)?.stage).toBe("confirmed");
    const receipt = await h.actions.registerFromRecord(res.record);
    expect(receipt.marketId).toBe(ACC.event);
    expect(h.recovery.load(WALLET)).toBeNull();
    // Broadcast with the exact signed bytes: validated message + the wallet's signature.
    const wire = Buffer.from(h.sendRawTransaction.mock.calls[0][0]);
    expect(wire.subarray(65).equals(Buffer.from(F.build.transaction, "base64").subarray(65))).toBe(true);
    expect(Buffer.from(wire.subarray(1, 65)).equals(Buffer.from(SIGBYTES))).toBe(true);
    expect(h.paths()).toEqual(["markets/register"]);
  });
  it("exact boundary: USDC == payment and SOL == fee + rent is enough (no buffer)", async () => {
    const h = harness({}, { usdc: PAYMENT, lamports: FEE + RENT });
    await expect(simulated(h)).resolves.toBeTruthy();
  });
});

describe("AA: insufficient USDC blocks before the wallet opens", () => {
  it("the 1.54 USDC wallet cannot reach simulation or signing", async () => {
    const h = harness({}, { usdc: BigInt(1_540_000) });
    await expect(simulated(h)).rejects.toThrow(INSUFFICIENT_USDC);
    expect(h.simulate).not.toHaveBeenCalled();
    expect(h.signTransaction).not.toHaveBeenCalled();
  });
  it("one base unit short is still blocked", async () => {
    const h = harness({}, { usdc: PAYMENT - BigInt(1) });
    await expect(simulated(h)).rejects.toThrow(INSUFFICIENT_USDC);
  });
  it("a missing USDC account counts as zero", async () => {
    const h = harness();
    h.balances.getAccountInfo.mockImplementation(async (k: PublicKey) =>
      k.toBase58() === WALLET ? { lamports: 1e9, owner: new PublicKey("11111111111111111111111111111111"), data: Buffer.alloc(0) } : null,
    );
    await expect(simulated(h)).rejects.toThrow(INSUFFICIENT_USDC);
  });
  it("the real 1.54 USDC wallet simulation (Token 'insufficient funds') maps to Insufficient USDC", () => {
    const tAcc = deriveCreateAccounts(T.wallet, T.request.question);
    const r = analyzeCreateSimulation(simOf(T), {
      txBase64: T.build.transaction,
      wallet: T.wallet,
      accounts: tAcc,
      marketType: "breaking",
      paymentBase: PAYMENT,
      liquidityBase: BigInt(5_000_000),
      platformBase: BigInt(15_000_000),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(INSUFFICIENT_USDC);
  });
  it("balance drop between simulation and approval → blocked at the final check, wallet never opens", async () => {
    const h = harness();
    const sim = await simulated(h);
    h.world.usdc = BigInt(1_540_000);
    await expect(approve(h, sim)).rejects.toThrow(INSUFFICIENT_USDC);
    expect(h.signTransaction).not.toHaveBeenCalled();
    nothingSent(h);
  });
});

describe("AB: insufficient SOL blocks", () => {
  it("below the network fee → blocked before simulation", async () => {
    const h = harness({}, { lamports: BigInt(4999) });
    await expect(simulated(h)).rejects.toThrow(INSUFFICIENT_SOL);
    expect(h.simulate).not.toHaveBeenCalled();
  });
  it("enough for the fee but not fee + simulated rent → blocked after simulation", async () => {
    const h = harness({}, { lamports: FEE + RENT - BigInt(1) });
    await expect(simulated(h)).rejects.toThrow(INSUFFICIENT_SOL);
    expect(h.signTransaction).not.toHaveBeenCalled();
  });
  it("message fee is computed from the transaction (signatures + priority)", () => {
    expect(messageFeeLamports(F.build.transaction)).toBeGreaterThanOrEqual(FEE);
  });
});

describe("AC–AF: simulation must prove everything or signing is blocked", () => {
  const blockedWith = async (mut: (v: Record<string, unknown> & { accounts: unknown[] }) => void, re: RegExp) => {
    const h = harness();
    h.simulate.mockImplementation(async () => simOf(F, mut));
    await expect(simulated(h)).rejects.toThrow(re);
    expect(h.signTransaction).not.toHaveBeenCalled();
  };
  it("AC: simulation failure (err set) → blocked", () => blockedWith((v) => void (v.err = "AccountNotFound"), /Simulation failed/));
  it("AC: RPC cannot simulate → 'Simulation unavailable … Signing blocked' (never continue)", async () => {
    const h = harness();
    h.simulate.mockRejectedValue(new Error("Method not allowed"));
    await expect(simulated(h)).rejects.toThrow(/Simulation unavailable.*Signing blocked/);
    expect(h.signTransaction).not.toHaveBeenCalled();
  });
  it("AD: program error → blocked", () =>
    blockedWith((v) => {
      v.err = { InstructionError: [1, { Custom: 6107 }] };
      (v.logs as string[]).push("Program 6gM5 failed: custom program error: 0x17db");
    }, /Simulation failed/));
  it("AD: a ' failed: ' log line with err null → blocked", () => blockedWith((v) => void (v.logs as string[]).splice(3, 0, "Program X failed: boom"), /failed program/));
  it("AD: Panta instruction not shown running → blocked", () =>
    blockedWith((v) => void (v.logs = (v.logs as string[]).filter((l) => !l.includes("Instruction: CreateBreakingEventUsdc"))), /instruction running to success/));
  it("AE: USDC delta off by one base unit → blocked", () =>
    blockedWith((v) => {
      const post = (v.postTokenBalances as { owner: string; mint: string; uiTokenAmount: { amount: string } }[]).find((b) => b.owner === WALLET && b.mint === USDC_MINT)!;
      post.uiTokenAmount.amount = (BigInt(post.uiTokenAmount.amount) - BigInt(1)).toString();
    }, /not exactly −20000000/));
  it("AE: extra USDC transfer out of the creator account → blocked", () =>
    blockedWith((v) => {
      const ii = (v.innerInstructions as { instructions: { program?: string; parsed?: { type?: string } }[] }[])[0].instructions;
      const t = ii.find((x) => x.program === "spl-token" && x.parsed?.type === "transfer")!;
      ii.push(clone(t));
    }, /transfers add up to 25000000/));
  it("AE: another wallet-owned token account losing tokens → blocked", () =>
    blockedWith((v) => {
      const e = (amount: string) => ({ accountIndex: 99, mint: "So11111111111111111111111111111111111111112", owner: WALLET, programId: TOKEN_PROGRAM, uiTokenAmount: { amount, decimals: 9 } });
      (v.preTokenBalances as unknown[]).push(e("10"));
      (v.postTokenBalances as unknown[]).push(e("5"));
    }, /another of your token accounts/));
  it("AE: creator USDC account under Token-2022 → blocked", () =>
    blockedWith((v) => {
      for (const b of [...(v.preTokenBalances as { owner: string; programId: string }[]), ...(v.postTokenBalances as { owner: string; programId: string }[])])
        if (b.owner === WALLET) b.programId = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
    }, /not a standard token account/));
  it("AE: SOL leaving the wallet beyond fee + rent (consistent post-state) → blocked", () =>
    blockedWith((v) => {
      (v.postBalances as number[])[0] -= 1;
      (v.accounts as { lamports: number }[])[0].lamports -= 1;
    }, /SOL|lamports|fee/i));
  it("AE: SOL post-state inconsistent with balances → blocked", () => blockedWith((v) => void ((v.postBalances as number[])[0] -= 1), /inconsistent/));
  it("AF: missing token balances → blocked", () => blockedWith((v) => void delete v.preTokenBalances, /token balances/));
  it("AF: missing logs → blocked", () => blockedWith((v) => void (v.logs = null), /no program logs/));
  it("AF: truncated logs → blocked", () => blockedWith((v) => void (v.logs as string[]).push("Log truncated"), /truncated/));
  it("AF: missing post-state accounts → blocked", () => blockedWith((v) => void (v.accounts = null as never), /account post-state/));
  it("AF: missing inner instructions → blocked", () => blockedWith((v) => void delete v.innerInstructions, /inner instructions/));
  it("AF: missing pre/post SOL balances → blocked", () => blockedWith((v) => void delete v.postBalances, /pre\/post SOL balances/));
  it("AF: no result object at all → blocked", async () => {
    const h = harness();
    h.simulate.mockResolvedValue(null);
    await expect(simulated(h)).rejects.toThrow(/no result/);
  });
});

describe("AG–AI: final stale-state check right before the wallet opens", () => {
  it("AG: build expired after simulation → blocked, no wallet, no requote", async () => {
    const h = harness();
    const sim = await simulated(h);
    h.world.now = Date.parse(F.build.expiresAt);
    await expect(approve(h, sim)).rejects.toThrow(/expired|Signing blocked/i);
    expect(h.signTransaction).not.toHaveBeenCalled();
    expect(h.paths()).toEqual([]);
  });
  it("AG: inputs changed after simulation → blocked", async () => {
    const h = harness();
    const sim = await simulated(h);
    const changed = { ...input, resolutionRule: input.resolutionRule + " (edited)" };
    await expect(h.actions.approveAndBroadcast({ ...h.args({ input: changed }), simulated: sim })).rejects.toThrow(/changed since review/);
    expect(h.signTransaction).not.toHaveBeenCalled();
  });
  it("AG: different transaction bytes than simulated → blocked", async () => {
    const h = harness();
    const sim = await simulated(h);
    const other = { ...h.build, transaction: mutateTx(h.build.transaction, (p) => void (p.recentBlockhash = PublicKey.unique().toBase58())) };
    await expect(h.actions.approveAndBroadcast({ ...h.args({ build: other }), simulated: sim })).rejects.toThrow(/changed since review|Signing blocked/);
    expect(h.signTransaction).not.toHaveBeenCalled();
  });
  it("AG: mainnet recheck fails right before signing → blocked, wallet never opens", async () => {
    const h = harness();
    const sim = await simulated(h);
    h.world.network = { ok: false, kind: "wrong_network", message: "The configured Solana RPC is on devnet. Signing blocked." };
    await expect(approve(h, sim)).rejects.toThrow(/devnet/);
    expect(h.signTransaction).not.toHaveBeenCalled();
  });
  it("AH: wallet switched after simulation → blocked", async () => {
    const h = harness();
    const sim = await simulated(h);
    await expect(h.actions.approveAndBroadcast({ ...h.args({ wallet: PublicKey.unique().toBase58() }), simulated: sim })).rejects.toThrow(/wallet changed/i);
    await expect(h.actions.approveAndBroadcast({ ...h.args({ wallet: null }), simulated: sim })).rejects.toThrow(/No active review/);
    expect(h.signTransaction).not.toHaveBeenCalled();
  });
  it("AI: on-chain tier price changed after simulation → blocked", async () => {
    const h = harness();
    const sim = await simulated(h);
    h.world.breakingPrice = BigInt(25_000_000);
    await expect(approve(h, sim)).rejects.toThrow(/on-chain breaking price/);
    expect(h.signTransaction).not.toHaveBeenCalled();
  });
  it("AI: a forged review snapshot (different payment) → blocked", async () => {
    const h = harness();
    const sim = await simulated(h);
    const forged = { ...sim, snapshot: { ...snapshotOf(h.session, h.build, WALLET), paymentBase: BigInt(1) } };
    await expect(h.actions.approveAndBroadcast({ ...h.args(), simulated: forged })).rejects.toThrow(/Payment changed/);
  });
});

describe("AJ/AK: wallet", () => {
  it("AJ: wallet returns a different message → nothing broadcast, nothing persisted", async () => {
    const h = harness();
    h.signTransaction.mockImplementation(async (tx) => {
      const other = VersionedTransaction.deserialize(Buffer.from(mutateTx(Buffer.from(tx.serialize()).toString("base64"), (p) => void (p.recentBlockhash = PublicKey.unique().toBase58())), "base64"));
      return new VersionedTransaction(other.message, [SIGBYTES]);
    });
    await expect(approve(h)).rejects.toThrow(/different transaction/);
    nothingSent(h);
    expect(h.kvMap.size).toBe(0);
  });
  it("AJ: wallet returns no / zero signature → nothing broadcast", async () => {
    const h = harness();
    h.signTransaction.mockImplementation(async (tx) => new VersionedTransaction(tx.message));
    await expect(approve(h)).rejects.toThrow(/exactly one signature/);
    nothingSent(h);
  });
  it("AK: wallet rejection → WalletRejected, no broadcast, no register, no record", async () => {
    const h = harness();
    h.signTransaction.mockRejectedValue(new Error("User rejected the request."));
    await expect(approve(h)).rejects.toBeInstanceOf(WalletRejected);
    nothingSent(h);
    expect(h.recovery.load(WALLET)).toBeNull();
  });
});

describe("AL/AM: broadcast and confirmation", () => {
  it("record (frozen createId + signature) is persisted BEFORE broadcast", async () => {
    const h = harness();
    h.sendRawTransaction.mockImplementation(async () => {
      expect(h.recovery.load(WALLET)).toMatchObject({ stage: "signed", createId: F.quote.createId, signature: SIG });
      return SIG;
    });
    await approve(h);
  });
  it("AL: broadcast error → uncertain (may have been forwarded), no register, record kept", async () => {
    const h = harness();
    h.sendRawTransaction.mockRejectedValue(new Error("Transaction simulation failed: blockhash not found"));
    const res = await approve(h);
    expect(res.kind).toBe("uncertain");
    expect(h.confirm).not.toHaveBeenCalled();
    expect(h.paths()).not.toContain("markets/register");
    expect(h.recovery.load(WALLET)?.signature).toBe(SIG);
  });
  it("AL: RPC returns a different signature → uncertain, never re-signed", async () => {
    const h = harness();
    h.sendRawTransaction.mockResolvedValue("1".repeat(88));
    expect((await approve(h)).kind).toBe("uncertain");
    expect(h.signTransaction).toHaveBeenCalledTimes(1);
  });
  it("AM: confirmation timeout → uncertain; no rebuild, no re-sign, no second broadcast", async () => {
    const h = harness();
    h.confirm.mockResolvedValue({ status: "pending", message: "Not confirmed within 90s." });
    const sim = await simulated(h);
    const res = await approve(h, sim);
    expect(res.kind).toBe("uncertain");
    await expect(approve(h, sim)).rejects.toThrow(/already signed/);
    await expect(h.actions.build(h.session, WALLET)).rejects.toThrow(/already signed/);
    expect(h.signTransaction).toHaveBeenCalledTimes(1);
    expect(h.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(h.paths()).toEqual([]);
  });
  it("AM: confirm throws (RPC trouble) → uncertain, not failure", async () => {
    const h = harness();
    h.confirm.mockRejectedValue(new Error("fetch failed"));
    expect((await approve(h)).kind).toBe("uncertain");
    expect(h.recovery.load(WALLET)?.stage).toBe("broadcast");
  });
  it("expired + event account exists → uncertain (never 'safe to retry')", async () => {
    const h = harness({}, { eventExists: true });
    h.confirm.mockResolvedValue({ status: "expired", message: "Blockhash expired." });
    const res = await approve(h);
    expect(res.kind).toBe("uncertain");
    expect(h.recovery.load(WALLET)).not.toBeNull();
  });
  it("expired + event account absent → expired, record cleared", async () => {
    const h = harness();
    h.confirm.mockResolvedValue({ status: "expired", message: "Blockhash expired." });
    expect((await approve(h)).kind).toBe("expired");
    expect(h.recovery.load(WALLET)).toBeNull();
  });
  it("chain failure → chain_failed, record cleared, no register", async () => {
    const h = harness();
    h.confirm.mockResolvedValue({ status: "failed", message: "custom program error" });
    expect((await approve(h)).kind).toBe("chain_failed");
    expect(h.recovery.load(WALLET)).toBeNull();
    expect(h.paths()).not.toContain("markets/register");
  });
  it("a shared signed-createId set survives re-creating the actions object", async () => {
    const signedCreateIds = new Set<string>();
    const broken = createRecoveryStore(() => null);
    const h = harness({ signedCreateIds, recovery: broken });
    await approve(h);
    const h2 = harness({ signedCreateIds, recovery: broken });
    await expect(approve(h2)).rejects.toThrow(/already signed/);
    expect(h2.signTransaction).not.toHaveBeenCalled();
  });
  it("an unresolved record blocks any new signing for that wallet", async () => {
    const h = harness();
    h.confirm.mockResolvedValue({ status: "pending", message: "x" });
    await approve(h);
    const h2 = harness({ recovery: h.recovery });
    await expect(approve(h2)).rejects.toThrow(/still unresolved/);
    expect(h2.signTransaction).not.toHaveBeenCalled();
  });
  it("check status after uncertainty: confirmed → confirmed record; one status call, never signs", async () => {
    const h = harness();
    h.confirm.mockResolvedValue({ status: "pending", message: "x" });
    const res = await approve(h);
    const st = await h.actions.checkStatus(res.record);
    expect(st.kind).toBe("confirmed");
    expect(h.recovery.load(WALLET)?.stage).toBe("confirmed");
    expect(h.checkSignature).toHaveBeenCalledTimes(1);
    expect(h.signTransaction).toHaveBeenCalledTimes(1);
  });
});

describe("AN–AQ: registration recovery", () => {
  async function confirmedRecord() {
    const h = harness();
    const res = await approve(h);
    h.postPanta.mockClear();
    return { h, rec: res.record };
  }
  it("AN: confirmed + register failure → registration_needs_attention persisted with the error", async () => {
    const { h, rec } = await confirmedRecord();
    h.postPanta.mockRejectedValueOnce(new Error("CREATE_EXPIRED"));
    await expect(h.actions.registerFromRecord(rec)).rejects.toThrow(/CREATE_EXPIRED/);
    expect(h.recovery.load(WALLET)).toMatchObject({ stage: "registration_needs_attention", lastError: "CREATE_EXPIRED", signature: SIG });
    expect(phaseForRecoveryStage("registration_needs_attention")).toBe("REGISTRATION_NEEDS_ATTENTION");
  });
  it("AO: retry sends exactly the same {createId, signature}", async () => {
    const { h, rec } = await confirmedRecord();
    h.postPanta.mockRejectedValueOnce(new Error("RATE_LIMITED"));
    await expect(h.actions.registerFromRecord(rec)).rejects.toThrow();
    await h.actions.registerFromRecord(h.recovery.load(WALLET)!);
    const bodies = h.postPanta.mock.calls.map((c) => c[1]);
    expect(bodies).toEqual([
      { createId: F.quote.createId, signature: SIG },
      { createId: F.quote.createId, signature: SIG },
    ]);
  });
  it("AP: retry never quotes, builds, simulates, signs or broadcasts", async () => {
    const { h, rec } = await confirmedRecord();
    h.postPanta.mockRejectedValueOnce(new Error("x"));
    await expect(h.actions.registerFromRecord(rec)).rejects.toThrow();
    const counts = [h.simulate.mock.calls.length, h.signTransaction.mock.calls.length, h.sendRawTransaction.mock.calls.length];
    await h.actions.registerFromRecord(h.recovery.load(WALLET)!);
    expect(h.paths()).toEqual(["markets/register", "markets/register"]);
    expect([h.simulate.mock.calls.length, h.signTransaction.mock.calls.length, h.sendRawTransaction.mock.calls.length]).toEqual(counts);
  });
  it("AQ: rapid retry clicks are single-flight", async () => {
    const { h, rec } = await confirmedRecord();
    let release!: () => void;
    h.postPanta.mockImplementationOnce(
      () => new Promise((r) => (release = () => r({ createId: F.quote.createId, signature: SIG, marketId: ACC.event, status: "registered" }))),
    );
    const ps = [h.actions.registerFromRecord(rec), h.actions.registerFromRecord(rec), h.actions.registerFromRecord(rec)];
    await Promise.resolve();
    release();
    const out = await Promise.all(ps);
    expect(h.postPanta).toHaveBeenCalledTimes(1);
    expect(new Set(out.map((o) => o.marketId))).toEqual(new Set([ACC.event]));
  });
  it("refresh: a saved record restores into a post-sign phase, never a pre-sign one", () => {
    for (const s of ["signed", "broadcast", "confirmed", "registration_needs_attention"] as const) expect(MAY_BE_BROADCAST.has(phaseForRecoveryStage(s))).toBe(true);
  });
});

describe("AR–AT: register response validated fail-closed (needs attention, never success)", () => {
  async function regWith(resp: unknown) {
    const h = harness();
    const res = await approve(h);
    h.postPanta.mockResolvedValueOnce(resp);
    await expect(h.actions.registerFromRecord(res.record)).rejects.toThrow();
    expect(h.recovery.load(WALLET)?.stage).toBe("registration_needs_attention");
    expect(h.invalidateAfterCreate).not.toHaveBeenCalled();
  }
  it("AR: malformed marketId", () => regWith({ createId: F.quote.createId, signature: SIG, marketId: "not a key!", status: "registered" }));
  it("AR: marketId ≠ expected event PDA", () => regWith({ createId: F.quote.createId, signature: SIG, marketId: PublicKey.unique().toBase58(), status: "registered" }));
  it("AR: missing status", () => regWith({ createId: F.quote.createId, signature: SIG, marketId: ACC.event }));
  it("AS: createId mismatch", () => regWith({ createId: "cr_ffffffffffffffffffffffffffffffff", signature: SIG, marketId: ACC.event, status: "registered" }));
  it("AT: signature mismatch", () => regWith({ createId: F.quote.createId, signature: "2".repeat(88), marketId: ACC.event, status: "registered" }));
});

describe("AU: caches invalidated on success only (no fabricated catalog row)", () => {
  it("invalidateAfterCreate(marketId) once after registration", async () => {
    const h = harness();
    const res = await approve(h);
    expect(h.invalidateAfterCreate).not.toHaveBeenCalled();
    await h.actions.registerFromRecord(res.record);
    expect(h.invalidateAfterCreate).toHaveBeenCalledTimes(1);
    expect(h.invalidateAfterCreate).toHaveBeenCalledWith(ACC.event);
  });
  it("the UI wires invalidation to the real query keys and adds no catalog rows", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/components/create/CreateMarketWorkspace.tsx", "utf8");
    expect(src).toContain("invalidateQueries({ queryKey: qk.catalog() })");
    expect(src).toContain("invalidateQueries({ queryKey: qk.market(marketId) })");
    expect(src).not.toMatch(/setQueryData/);
  });
});

describe("AV/AW: 1232-byte boundary", () => {
  const ctx = () => ({ wallet: WALLET, input, session: bindCreateQuote(F.quote, input, NOW), nowMs: NOW });
  const padded = (n: number) => {
    const raw = Buffer.from(F.build.transaction, "base64");
    return Buffer.concat([raw, Buffer.alloc(n - raw.length, 0)]).toString("base64");
  };
  it("AV: 1233 bytes is blocked by the validator and by the relay", () => {
    const r = verifyCreateTransaction(padded(1233), ctx() as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/1233 bytes, above Solana's 1232-byte limit/);
    expect(checkSimulateParams([padded(1233), { encoding: "base64", sigVerify: false, replaceRecentBlockhash: false }])).not.toBeNull();
  });
  it("AW: 1232 bytes passes the size gates (anything else is judged by the rest of the validator)", () => {
    const r = verifyCreateTransaction(padded(1232), ctx() as never);
    if (!r.ok) expect(r.reason).not.toMatch(/byte limit/);
    expect(checkSimulateParams([padded(1232), { encoding: "base64", sigVerify: false, replaceRecentBlockhash: false }])).toBeNull();
  });
});

describe("state machine: deterministic, never back to build/sign after a possible broadcast", () => {
  const ALL = Object.keys(CREATE_TRANSITIONS) as CreatePhase[];
  it("happy path and registration recovery path are legal", () => {
    const path: CreatePhase[] = ["DEFINE", "QUOTED", "BUILT", "VALIDATED", "SIMULATED", "REVIEW", "WALLET_APPROVAL", "BROADCAST", "CONFIRMATION", "CONFIRMED_ON_CHAIN", "REGISTER", "SUCCESS"];
    for (let i = 1; i < path.length; i++) expect(transition(path[i - 1], path[i])).toBe(path[i]);
    for (const [a, b] of [
      ["CONFIRMED_ON_CHAIN", "REGISTRATION_NEEDS_ATTENTION"],
      ["REGISTRATION_NEEDS_ATTENTION", "RETRY_REGISTER"],
      ["RETRY_REGISTER", "SUCCESS"],
    ] as const)
      expect(canTransition(a, b)).toBe(true);
  });
  it("no phase that may follow a broadcast can reach a pre-sign or signing phase", () => {
    const preSign: CreatePhase[] = ["QUOTED", "BUILT", "VALIDATED", "SIMULATED", "REVIEW", "WALLET_APPROVAL"];
    for (const from of ALL.filter((p) => MAY_BE_BROADCAST.has(p))) for (const to of preSign) expect(canTransition(from, to)).toBe(false);
    expect(() => transition("CONFIRMATION_UNCERTAIN", "BUILT")).toThrow(IllegalTransition);
    expect(() => transition("REGISTRATION_NEEDS_ATTENTION", "WALLET_APPROVAL")).toThrow(IllegalTransition);
  });
  it("review cannot be skipped: no path to WALLET_APPROVAL except from REVIEW", () => {
    for (const from of ALL) if (from !== "REVIEW") expect(canTransition(from, "WALLET_APPROVAL")).toBe(false);
  });
});

describe("recovery store", () => {
  const rec = (): CreateRecoveryRecord => ({
    v: 1,
    wallet: WALLET,
    createId: F.quote.createId,
    signature: SIG,
    expectedEventPda: ACC.event,
    marketType: "breaking",
    paymentBase: "20000000",
    question: input.question,
    title: null,
    recentBlockhash: F.build.recentBlockhash,
    lastValidBlockHeight: F.build.lastValidBlockHeight,
    stage: "confirmed",
    lastError: null,
    savedAt: 1,
  });
  it("round-trips per wallet and lists wallets", () => {
    const h = harness();
    expect(h.recovery.save(rec())).toBe(true);
    expect(h.recovery.load(WALLET)).toEqual(rec());
    expect(h.recovery.load(PublicKey.unique().toBase58())).toBeNull();
    expect(h.recovery.wallets()).toEqual([WALLET]);
    expect([...h.kvMap.keys()]).toEqual([`${CREATE_RECOVERY_PREFIX}${WALLET}`]);
  });
  it("non-durable storage reports false (UI must show the signature)", () => {
    const s = createRecoveryStore(() => ({
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceeded");
      },
      removeItem: () => {},
    }));
    expect(s.save(rec())).toBe(false);
    expect(createRecoveryStore(() => null).save(rec())).toBe(false);
  });
  it("broadcast continues (with durable=false) when storage fails, and the result says so", async () => {
    const broken = createRecoveryStore(() => null);
    const h = harness({ recovery: broken });
    const res = await approve(h);
    expect(res.kind).toBe("confirmed");
    expect(res.durable).toBe(false);
    expect(res.record.signature).toBe(SIG);
  });
  it("malformed or tampered records are ignored", () => {
    const h = harness();
    h.kvMap.set(`${CREATE_RECOVERY_PREFIX}${WALLET}`, JSON.stringify({ ...rec(), extra: 1 }));
    expect(h.recovery.load(WALLET)).toBeNull();
    h.kvMap.set(`${CREATE_RECOVERY_PREFIX}${WALLET}`, "{not json");
    expect(h.recovery.load(WALLET)).toBeNull();
    h.kvMap.set(`${CREATE_RECOVERY_PREFIX}${WALLET}`, JSON.stringify({ ...rec(), wallet: PublicKey.unique().toBase58() }));
    expect(h.recovery.load(WALLET)).toBeNull();
  });
});

describe("INVALID_MARKET_PARAMS: shown once, no automatic retry", () => {
  it("quote failure → exactly one request", async () => {
    const h = harness();
    h.postPanta.mockRejectedValue(new Error("INVALID_MARKET_PARAMS: unexpected create quote failure"));
    await expect(h.actions.quote(input, { confirmed: true, edited: false })).rejects.toThrow(/INVALID_MARKET_PARAMS/);
    expect(h.postPanta).toHaveBeenCalledTimes(1);
  });
});
