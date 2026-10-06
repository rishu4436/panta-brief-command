/**
 * Phase 3 · Create Market — validator tests against the REAL Panta create
 * builds (test/fixtures/create-build.live-2026-10-06.json; never signed).
 * Adversarial variants are produced by re-serializing the real transaction
 * with one targeted change (mutateTx); nothing here is a guessed "valid" tx.
 */
import crypto from "node:crypto";
import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { sha256 } from "@/lib/sha256";
import {
  bindCreateQuote,
  checkCreateBuildMetadata,
  checkPaymentAgainstConfig,
  checkRegisterResponse,
  CreateBlocked,
  decodeCreateIxData,
  decodeMarketConfig,
  deriveCreateAccounts,
  deriveEventPda,
  freezeRegistration,
  parseCreateBuild,
  preSignCreateCheck,
  registerBody,
  sessionStaleReason,
  verifyCreateBuild,
  verifyCreateTransaction,
  verifyPaymentOnChain,
  type CreateSession,
} from "@/lib/panta/create-market";
import {
  createInputErrors,
  createInputFingerprint,
  isAllowedImageUrl,
  isHttpsUrl,
  normalizeCreateForm,
  onChainTextBytes,
  OBSERVED_TX_OVERHEAD_BYTES,
  parseCloudinaryUpload,
  parseImageUploadGrant,
  imageFileError,
  timelineErrors,
  type CreateInput,
} from "@/lib/panta/create-rules";
import { PANTA_TREASURY_TOKEN_ACCOUNT } from "@/lib/panta/primary-order";
import { FX, SCENARIOS, WALLET, inputOf, keyIndex, marketConfigReader, mutateTx, nowFor, nowSecFor, pantaIx, randomKey, u64le } from "./create-helpers";

const S = FX.breaking;
const input = inputOf(S);
const NOW = nowFor(S);
const session = (sc = S, i = inputOf(sc)): CreateSession => bindCreateQuote(sc.quote, i, nowFor(sc));
const build = (sc = S) => parseCreateBuild(sc.build);
const ctx = (sc = S, i = inputOf(sc)) => ({ wallet: WALLET, input: i, session: session(sc, i), recentBlockhash: sc.build.recentBlockhash });
const verify = (tx: string, sc = S) => verifyCreateTransaction(tx, ctx(sc));
const reason = (r: { ok: boolean; reason?: string }) => (r.ok ? "OK" : r.reason);

describe("sha256 (event PDA seed)", () => {
  it("matches node:crypto for many lengths and unicode", () => {
    for (let n = 0; n < 200; n += 7) {
      const b = crypto.randomBytes(n);
      expect(Buffer.from(sha256(b)).toString("hex")).toBe(crypto.createHash("sha256").update(b).digest("hex"));
    }
    const q = "Will ₿ close above 100k? 🚀";
    expect(Buffer.from(sha256(new TextEncoder().encode(q))).toString("hex")).toBe(crypto.createHash("sha256").update(q).digest("hex"));
  });
});

describe("real Panta create builds (6 Oct 2026, unsigned)", () => {
  for (const name of SCENARIOS) {
    const sc = FX[name];
    it(`${name}: strict validator accepts the real build and binds every field`, () => {
      const r = verifyCreateBuild(build(sc), session(sc), WALLET, nowFor(sc));
      expect(reason(r)).toBe("OK");
      if (!r.ok) return;
      expect(r.instructionCount).toBe(2);
      expect(r.programs).toEqual(["ComputeBudget111111111111111111111111111111", "6gM5afTQBq5VZCfgpGqcsqzfWd5maLSCKWtGjbEobZMp"]);
      expect(r.computeUnitLimit).toBe(400_000);
      expect(r.priorityFeeMicroLamports).toBeNull();
      expect(r.data.kind).toBe(sc.request.marketType);
      expect(r.data.paymentBase).toBe(BigInt(sc.quote.paymentUsdc));
      expect(r.data.question).toBe(sc.request.question);
      expect(r.accounts.event).toBe(sc.quote.expectedEventPda);
      // 728 bytes of fixed overhead for Breaking (incl. the event_in_progress byte), 727 for Standard.
      expect(r.txBytes).toBe(OBSERVED_TX_OVERHEAD_BYTES - (name === "standard" ? 1 : 0) + onChainTextBytes(inputOf(sc)));
    });
    it(`${name}: every account is derivable locally and equals Panta's derived map`, () => {
      const mine = deriveCreateAccounts(WALLET, sc.request.question);
      for (const [k, v] of Object.entries(sc.build.derived)) expect(mine[k as keyof typeof mine]).toBe(v);
      expect(deriveEventPda(WALLET, sc.request.question)).toBe(sc.quote.expectedEventPda);
    });
  }

  it("identity re-serialization reproduces the real bytes (adversarial variants differ only by the mutation)", () => {
    for (const name of SCENARIOS) expect(mutateTx(FX[name].build.transaction, () => {})).toBe(FX[name].build.transaction);
  });

  it("decodes the observed instruction data exactly (breaking carries event_in_progress; standard does not)", () => {
    const bi = FX.breakingInProgress;
    const v = verifyCreateBuild(build(bi), session(bi), WALLET, nowFor(bi));
    expect(v.ok && v.data.eventInProgress).toBe(true);
    const st = verifyCreateBuild(build(FX.standard), session(FX.standard), WALLET, nowFor(FX.standard));
    expect(st.ok && st.data.eventInProgress).toBeNull();
    expect(decodeCreateIxData(new Uint8Array(10))).toBeNull();
  });
});

describe("on-chain fee binding (MarketConfig)", () => {
  const cfg = decodeMarketConfig(Buffer.from(FX.marketConfig.dataBase64, "base64"))!;
  it("decodes tier prices, treasury and start delay from the real account", () => {
    expect(cfg.breakingPayment).toBe(BigInt(20_000_000));
    expect(cfg.breakingLiquidity).toBe(BigInt(5_000_000));
    expect(cfg.regularPayment).toBe(BigInt(50_000_000));
    expect(cfg.regularLiquidity).toBe(BigInt(10_000_000));
    expect(cfg.minimumStartDelay).toBe(3600);
    expect(checkPaymentAgainstConfig(cfg, session())).toBeNull();
    expect(checkPaymentAgainstConfig(cfg, session(FX.standard))).toBeNull();
  });
  it("J: quoted fee 1 base unit off the on-chain price is blocked", () => {
    const s = session();
    expect(checkPaymentAgainstConfig(cfg, { ...s, paymentBase: s.paymentBase + BigInt(1), liquidityBase: null, platformBase: null })).toMatch(/not Panta's on-chain breaking price/);
  });
  it("RPC failure, wrong owner or wrong layout fail closed", async () => {
    expect(await verifyPaymentOnChain(marketConfigReader(), session())).toBeNull();
    expect(await verifyPaymentOnChain({ getAccountInfo: async () => { throw new Error("down"); } }, session())).toMatch(/Could not read/);
    expect(await verifyPaymentOnChain(marketConfigReader(undefined, PANTA_TREASURY_TOKEN_ACCOUNT), session())).toMatch(/not owned/);
    expect(await verifyPaymentOnChain(marketConfigReader(Buffer.alloc(356).toString("base64")), session())).toMatch(/unexpected layout/);
  });
});

describe("A–C timeline rules", () => {
  const now = 1_800_000_000;
  const base = { marketType: "standard" as const, startTime: now + 73 * 3600, endTime: now + 80 * 3600, resolutionTime: now + 81 * 3600 };
  it("A: standard starting within 72h is rejected client-side", () => {
    expect(timelineErrors({ ...base, startTime: now + 71 * 3600 }, now).startTime).toMatch(/72 hours/);
  });
  it("B: valid standard timeline accepted; a full valid input has no errors", () => {
    expect(timelineErrors(base, now)).toEqual({});
    expect(createInputErrors(inputOf(FX.standard), nowSecFor(FX.standard))).toEqual({});
    expect(createInputErrors(input, nowSecFor(S))).toEqual({});
  });
  it("C: breaking eventInProgress rules", () => {
    const b = { marketType: "breaking" as const };
    expect(timelineErrors({ ...b, eventInProgress: true, startTime: now - 60, endTime: now + 3600, resolutionTime: now + 7200 }, now)).toEqual({});
    expect(timelineErrors({ ...b, eventInProgress: true, startTime: now + 60, endTime: now + 3600, resolutionTime: now + 7200 }, now).startTime).toMatch(/now or in the past/);
    expect(timelineErrors({ ...b, eventInProgress: true, startTime: now - 7200, endTime: now - 60, resolutionTime: now }, now).endTime).toMatch(/future/);
    expect(timelineErrors({ ...b, eventInProgress: false, startTime: now - 60, endTime: now + 3600, resolutionTime: now + 7200 }, now).startTime).toMatch(/future/);
    expect(timelineErrors({ ...b, eventInProgress: false, startTime: now + 600, endTime: now + 7200, resolutionTime: now + 9000 }, now).startTime).toMatch(/1 hour/);
    expect(timelineErrors({ ...b, eventInProgress: false, startTime: now + 73 * 3600, endTime: now + 74 * 3600, resolutionTime: now + 75 * 3600 }, now).startTime).toMatch(/72 hours/);
    expect(timelineErrors({ ...b, eventInProgress: false, startTime: now + 2 * 3600, endTime: now + 3 * 3600, resolutionTime: now + 4 * 3600 }, now)).toEqual({});
    expect(timelineErrors({ ...base, eventInProgress: true }, now).startTime).toMatch(/Breaking markets only/);
  });
  it("always start < end ≤ resolution", () => {
    expect(timelineErrors({ ...base, endTime: base.startTime }, now).endTime).toMatch(/after the start/);
    expect(timelineErrors({ ...base, resolutionTime: base.endTime - 1 }, now).resolutionTime).toMatch(/at or after the end/);
  });
  it("on-chain text budget and source rules are enforced before quoting", () => {
    expect(createInputErrors({ ...input, resolutionRule: "x".repeat(600) }, nowSecFor(S)).budget).toMatch(/500 bytes/);
    expect(createInputErrors({ ...input, sourcesOfTruth: ["http://example.com"] }, nowSecFor(S)).sources).toMatch(/https/);
    expect(createInputErrors({ ...input, sourcesOfTruth: [] }, nowSecFor(S)).sources).toBeTruthy();
    expect(createInputErrors({ ...input, wallet: "" }, nowSecFor(S)).wallet).toBeTruthy();
    expect(createInputErrors({ ...input, imageUrl: "https://evil.example/x.png" }, nowSecFor(S)).imageUrl).toBeTruthy();
    expect(isHttpsUrl("https://127.0.0.1/x")).toBe(false);
    expect(isHttpsUrl("https://localhost/x")).toBe(false);
  });
});

describe("D–F stale quote binding", () => {
  const s = session();
  const t = NOW;
  it("unchanged input + same wallet stays valid; fingerprint is stable", () => {
    expect(sessionStaleReason(s, inputOf(S), WALLET, t)).toBeNull();
    expect(createInputFingerprint(inputOf(S))).toBe(s.fingerprint);
  });
  it("D: question change invalidates", () => {
    expect(sessionStaleReason(s, { ...input, question: input.question.replace("ECB", "Fed") }, WALLET, t)).toMatch(/changed/);
  });
  it("E: wallet change or disconnect invalidates", () => {
    expect(sessionStaleReason(s, { ...input, wallet: randomKey().toBase58() }, randomKey().toBase58(), t)).toMatch(/Wallet changed/);
    expect(sessionStaleReason(s, input, null, t)).toMatch(/Wallet changed/);
  });
  it("F: image / source / time / rule / type / flag / category changes invalidate", () => {
    const changes: Partial<CreateInput>[] = [
      { imageUrl: FX.imageUpload.secureUrl.replace(".png", ".webp") },
      { sourcesOfTruth: [...input.sourcesOfTruth, "https://www.reuters.com"] },
      { startTime: input.startTime + 60 },
      { endTime: input.endTime + 60 },
      { resolutionTime: input.resolutionTime + 60 },
      { resolutionRule: input.resolutionRule + " Also." },
      { marketType: "standard", eventInProgress: undefined },
      { eventInProgress: true },
      { category: "world" },
      { title: "Other title" },
      { region: "Europe" },
    ];
    for (const c of changes) expect(sessionStaleReason(s, { ...input, ...c }, WALLET, t)).toMatch(/changed/);
  });
  it("K: quote expiry invalidates", () => {
    expect(sessionStaleReason(s, input, WALLET, s.expiresAtMs)).toMatch(/expired/);
  });
});

describe("normalization", () => {
  it("trims, collapses whitespace, drops blanks, sets eventInProgress only for breaking", () => {
    const n = normalizeCreateForm({
      wallet: ` ${WALLET} `,
      question: "  Will  X happen\n by 2027? ",
      title: " ",
      description: "",
      category: "world",
      marketType: "standard",
      region: "",
      resolutionRule: " rule text that is long enough ",
      sources: [" https://a.example.com ", " "],
      imageUrl: FX.imageUpload.secureUrl,
      startTime: 1,
      endTime: 2,
      resolutionTime: 3,
      eventInProgress: true,
    });
    expect(n.question).toBe("Will X happen by 2027?");
    expect(n.sourcesOfTruth).toEqual(["https://a.example.com"]);
    expect(n).not.toHaveProperty("title");
    expect(n).not.toHaveProperty("eventInProgress");
    expect(n).not.toHaveProperty("oracle");
  });
});

describe("quote binding", () => {
  it("binds the real quote; H: a quote whose event PDA is not derived from wallet+question is refused", () => {
    expect(session().createId).toBe(S.quote.createId);
    expect(() => bindCreateQuote({ ...S.quote, expectedEventPda: randomKey().toBase58() }, input, NOW)).toThrow(CreateBlocked);
  });
  it("I: quoted market type different from the chosen type is refused", () => {
    expect(() => bindCreateQuote({ ...S.quote, marketType: "standard" }, input, NOW)).toThrow(/market type/);
  });
  it("fee split must add up; missing/garbled fee is refused", () => {
    expect(() => bindCreateQuote({ ...S.quote, platformRevenueUsdc: "15000001" }, input, NOW)).toThrow(/split/);
    expect(() => bindCreateQuote({ ...S.quote, paymentUsdc: "20.00" }, input, NOW)).toThrow(CreateBlocked);
    expect(() => bindCreateQuote({ ...S.quote, paymentUsdc: undefined }, input, NOW)).toThrow(CreateBlocked);
  });
  it("K: an already-expired quote is refused", () => {
    expect(() => bindCreateQuote(S.quote, input, Date.parse(S.quote.expiresAt) + 1)).toThrow(/expired/);
  });
});

describe("G–K build metadata vs the active quote", () => {
  const s = session();
  const meta = (patch: Record<string, unknown>, now = NOW, wallet: string | null = WALLET) => checkCreateBuildMetadata(parseCreateBuild({ ...S.build, ...patch }), s, wallet, now);
  it("real build metadata passes", () => expect(meta({})).toEqual({ ok: true }));
  it("G: createId mismatch blocked", () => expect(reason(meta({ createId: "cr_00000000000000000000000000000000" }))).toMatch(/createId/));
  it("H: event PDA mismatch blocked (metadata and derived map)", () => {
    expect(reason(meta({ expectedEventPda: randomKey().toBase58() }))).toMatch(/event address/);
    expect(reason(meta({ derived: { ...S.build.derived, vaultAuthority: randomKey().toBase58() } }))).toMatch(/vaultAuthority/);
  });
  it("I: marketType mismatch blocked", () => expect(reason(meta({ marketType: "standard" }))).toMatch(/market type/));
  it("J: payment off by one base unit blocked", () => {
    expect(reason(meta({ paymentUsdc: "20000001" }))).toMatch(/differs from the quoted fee/);
    expect(reason(meta({ paymentUsdc: "19999999" }))).toMatch(/differs from the quoted fee/);
  });
  it("K: expired build or quote blocked", () => {
    expect(reason(meta({}, Date.parse(S.build.expiresAt)))).toMatch(/Build expired/);
    expect(reason(meta({ expiresAt: new Date(s.expiresAtMs + 600_000).toISOString() }, s.expiresAtMs))).toMatch(/Quote expired/);
  });
  it("wallet changed after the quote blocked", () => expect(reason(meta({}, NOW, randomKey().toBase58()))).toMatch(/wallet/));
  it("missing fields fail closed (schema)", () => {
    for (const k of ["transaction", "recentBlockhash", "lastValidBlockHeight", "buildFingerprint", "paymentUsdc", "marketType", "expiresAt", "createId", "expectedEventPda"]) {
      const b: Record<string, unknown> = { ...S.build };
      delete b[k];
      expect(() => parseCreateBuild(b)).toThrow(CreateBlocked);
    }
  });
});

describe("L–P adversarial transactions derived from the real build", () => {
  const tx = S.build.transaction;
  const pid = (p: Parameters<Parameters<typeof mutateTx>[1]>[0], k: string) => keyIndex(p, k);
  it("L: an extra required signer is blocked", () => {
    expect(reason(verify(mutateTx(tx, (p) => { p.header.numRequiredSignatures = 2; })))).toMatch(/signer other than your wallet/);
  });
  it("L: a pre-signed transaction is blocked", () => {
    expect(reason(verify(mutateTx(tx, () => {}, (n) => Array.from({ length: n }, () => new Uint8Array(64).fill(7)))))).toMatch(/already signed/);
  });
  it("L: someone else as fee payer is blocked", () => {
    const other = randomKey().toBase58();
    expect(reason(verifyCreateTransaction(tx, { ...ctx(), wallet: other, input: { ...input, wallet: other } }))).toMatch(/Fee payer/);
  });
  it("M: an extra instruction to an unknown program is blocked", () => {
    const v = mutateTx(tx, (p) => {
      p.staticAccountKeys.push(randomKey());
      p.header.numReadonlyUnsignedAccounts += 1;
      p.compiledInstructions.splice(1, 0, { programIdIndex: p.staticAccountKeys.length - 1, accountKeyIndexes: [], data: new Uint8Array([1]) });
    });
    expect(reason(verify(v))).toMatch(/Unexpected top-level instruction/);
  });
  it("M: the create instruction pointed at a different program is blocked", () => {
    const v = mutateTx(tx, (p) => { p.staticAccountKeys[pid(p, "6gM5afTQBq5VZCfgpGqcsqzfWd5maLSCKWtGjbEobZMp")] = randomKey(); });
    expect(reason(verify(v))).toMatch(/0 Panta instructions/);
  });
  it("N: an extra System transfer of SOL is blocked", () => {
    const v = mutateTx(tx, (p) => {
      const data = new Uint8Array(12);
      data.set([2, 0, 0, 0], 0);
      data.set(u64le(BigInt(1_000_000)), 4);
      p.compiledInstructions.splice(1, 0, { programIdIndex: pid(p, "11111111111111111111111111111111"), accountKeyIndexes: [0, pid(p, PANTA_TREASURY_TOKEN_ACCOUNT)], data });
    });
    expect(reason(verify(v))).toMatch(/Unexpected top-level instruction \(11111111111111111111111111111111\)/);
  });
  it("O: an extra SPL Token transfer is blocked", () => {
    const acc = deriveCreateAccounts(WALLET, input.question);
    const v = mutateTx(tx, (p) => {
      p.compiledInstructions.splice(1, 0, {
        programIdIndex: pid(p, "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
        accountKeyIndexes: [pid(p, acc.creatorTokenAccount), pid(p, PANTA_TREASURY_TOKEN_ACCOUNT), 0],
        data: new Uint8Array([3, ...u64le(BigInt(1_000_000))]),
      });
    });
    expect(reason(verify(v))).toMatch(/Unexpected top-level instruction \(Tokenkeg/);
  });
  it("P: excessive compute budget (limit or priority fee) is blocked", () => {
    const limit = mutateTx(tx, (p) => { p.compiledInstructions[0].data = new Uint8Array([2, ...new Uint8Array(new Uint32Array([1_000_000]).buffer)]); });
    expect(reason(verify(limit))).toMatch(/above the 600000 cap/);
    const price = mutateTx(tx, (p) => {
      p.compiledInstructions.splice(1, 0, { programIdIndex: p.compiledInstructions[0].programIdIndex, accountKeyIndexes: [], data: new Uint8Array([3, ...u64le(BigInt(1_000_000_000))]) });
    });
    expect(reason(verify(price))).toMatch(/Priority fee/);
  });
  it("H: swapped event / treasury / vault accounts are blocked", () => {
    const acc = deriveCreateAccounts(WALLET, input.question);
    for (const k of [acc.event, PANTA_TREASURY_TOKEN_ACCOUNT, acc.vaultTokenAccount, acc.creatorTokenAccount, acc.creatorFeeVaultTokenAccount]) {
      const v = mutateTx(tx, (p) => { p.staticAccountKeys[pid(p, k)] = randomKey(); });
      expect(reason(verify(v))).toMatch(/not the expected address/);
    }
  });
  it("reordered create accounts are blocked", () => {
    const v = mutateTx(tx, (p) => {
      const a = pantaIx(p).accountKeyIndexes;
      [a[5], a[7]] = [a[7], a[5]];
    });
    expect(reason(verify(v))).toMatch(/not the expected address/);
  });
  it("J: instruction payment 1 base unit higher is blocked", () => {
    const v = mutateTx(tx, (p) => {
      const d = Buffer.from(pantaIx(p).data);
      const qlen = d.readUInt32LE(32);
      const off = 36 + qlen;
      d.writeBigUInt64LE(d.readBigUInt64LE(off) + BigInt(1), off);
      pantaIx(p).data = d;
    });
    expect(reason(verify(v))).toMatch(/Instruction payment \(20000001/);
  });
  it("instruction question / timeline / flag / trailing bytes changed are blocked", () => {
    const edit = (f: (d: Buffer) => Buffer) => mutateTx(tx, (p) => { pantaIx(p).data = f(Buffer.from(pantaIx(p).data)); });
    expect(reason(verify(edit((d) => { d[40] ^= 1; return d; })))).toMatch(/question/);
    expect(reason(verify(edit((d) => { d.writeBigInt64LE(d.readBigInt64LE(8) + BigInt(1), 8); return d; })))).toMatch(/timeline/);
    expect(reason(verify(edit((d) => { d[d.length - 1] = 1; return d; })))).toMatch(/event in progress/);
    expect(reason(verify(edit((d) => Buffer.concat([d, Buffer.from([0])]))))).toMatch(/recognisable/);
  });
  it("I: a standard create instruction against a breaking quote is blocked", () => {
    expect(reason(verifyCreateTransaction(FX.standard.build.transaction, { ...ctx(), recentBlockhash: FX.standard.build.recentBlockhash }))).toMatch(/market type|question/);
  });
  it("address lookup tables, unexpected accounts, blockhash swap and oversize are blocked", () => {
    const alt = mutateTx(tx, (p) => { p.addressTableLookups = [{ accountKey: randomKey(), writableIndexes: [0], readonlyIndexes: [] }]; });
    expect(reason(verify(alt))).toMatch(/lookup tables/);
    const extra = mutateTx(tx, (p) => { p.staticAccountKeys.push(randomKey()); p.header.numReadonlyUnsignedAccounts += 1; });
    expect(reason(verify(extra))).toMatch(/unexpected account/);
    expect(reason(verifyCreateTransaction(tx, { ...ctx(), recentBlockhash: randomKey().toBase58() }))).toMatch(/blockhash/);
    const big = mutateTx(tx, (p) => { pantaIx(p).data = Buffer.concat([Buffer.from(pantaIx(p).data), Buffer.alloc(200)]); });
    expect(reason(verify(big))).toMatch(/above Solana's 1232-byte limit/);
    expect(reason(verify("not-base64!!"))).toMatch(/base64|readable|decoded/);
  });
});

describe("R/K pre-sign revalidation", () => {
  const s = session();
  const b = build();
  const ok = { ok: true } as const;
  const args = { connectedWallet: WALLET, session: s, currentInput: input, build: b, nowMs: NOW, network: ok, paymentOnChain: null };
  it("passes when everything still matches", () => expect(reason(preSignCreateCheck(args))).toBe("OK"));
  it("R: wrong network blocks signing", () => {
    expect(reason(preSignCreateCheck({ ...args, network: { ok: false, kind: "wrong_network", message: "The configured Solana RPC is on devnet" } }))).toMatch(/devnet/);
    expect(reason(preSignCreateCheck({ ...args, network: { ok: false, kind: "check_failed", message: "Couldn't confirm the Solana RPC is on mainnet" } }))).toMatch(/Couldn't confirm/);
  });
  it("wallet switch, edited inputs, expiry, unbound payment all block", () => {
    expect(reason(preSignCreateCheck({ ...args, connectedWallet: randomKey().toBase58() }))).toMatch(/Wallet changed/);
    expect(reason(preSignCreateCheck({ ...args, currentInput: { ...input, question: "Will something else happen by 2027?" } }))).toMatch(/changed/);
    expect(reason(preSignCreateCheck({ ...args, nowMs: Date.parse(S.build.expiresAt) }))).toMatch(/expired/);
    expect(reason(preSignCreateCheck({ ...args, paymentOnChain: "Quoted fee differs. Signing blocked." }))).toMatch(/Quoted fee/);
    expect(reason(preSignCreateCheck({ ...args, build: null }))).toMatch(/No verified build/);
  });
});

describe("S/T registration (scaffolding, not wired to signing)", () => {
  const s = session();
  const SIG = "5VEJv1R" + "1".repeat(80);
  const frozen = freezeRegistration(s, SIG);
  const resp = { createId: s.createId, marketId: s.expectedEventPda, status: "registered", signature: SIG, category: "finance", title: "t", images: [FX.imageUpload.secureUrl] };
  it("S: valid response accepted; invalid or unexpected marketId rejected", () => {
    expect(checkRegisterResponse(resp, frozen).ok).toBe(true);
    expect(reason(checkRegisterResponse({ ...resp, marketId: "not-a-key" }, frozen))).toMatch(/invalid market id/);
    expect(reason(checkRegisterResponse({ ...resp, marketId: randomKey().toBase58() }, frozen))).toMatch(/not the quoted event address/);
    expect(reason(checkRegisterResponse({ ...resp, status: "pending" }, frozen))).toMatch(/not registered/);
    expect(reason(checkRegisterResponse({ ...resp, marketId: undefined }, frozen))).toMatch(/unexpected shape/);
  });
  it("T: createId / signature mismatches are blocked both ways", () => {
    expect(() => registerBody(frozen, "cr_ffffffffffffffffffffffffffffffff")).toThrow(/different create session/);
    expect(() => registerBody(frozen, frozen.createId, "4" + SIG.slice(1))).toThrow(/different create session/);
    expect(registerBody(frozen)).toEqual({ createId: s.createId, signature: SIG });
    expect(reason(checkRegisterResponse({ ...resp, createId: "cr_ffffffffffffffffffffffffffffffff" }, frozen))).toMatch(/different create session/);
    expect(reason(checkRegisterResponse({ ...resp, signature: "4" + SIG.slice(1) }, frozen))).toMatch(/different transaction/);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(() => freezeRegistration(s, "0OIl")).toThrow(/signature/);
  });
});

describe("Y image upload responses", () => {
  const now = Date.parse("2026-10-06T06:10:00Z");
  const grant = {
    uploadUrl: "https://api.cloudinary.com/v1_1/dyvupboym/image/upload",
    publicId: "balr-market/events/usr_abc/0123456789abcdef",
    expiresAt: "2026-10-06T06:15:00Z",
    fields: { folder: "balr-market/events", overwrite: "false", public_id: "usr_abc/0123456789abcdef", timestamp: 1791267260, upload_preset: "panta-market-api-signed", api_key: "k", signature: "s" },
  };
  it("accepts the observed grant shape", () => {
    const g = parseImageUploadGrant(grant, now);
    expect(g.fields.timestamp).toBe("1791267260");
  });
  it("rejects malformed grants", () => {
    const bad: unknown[] = [
      null,
      [],
      "x",
      { ...grant, uploadUrl: "https://api.cloudinary.com/v1_1/other/image/upload" },
      { ...grant, uploadUrl: "https://evil.example/upload" },
      { ...grant, publicId: "../../etc" },
      { ...grant, expiresAt: "2026-10-06T06:00:00Z" },
      { ...grant, expiresAt: undefined },
      { ...grant, fields: undefined },
      { ...grant, fields: { ...grant.fields, signature: undefined } },
      { ...grant, fields: { ...grant.fields, public_id: "usr_abc/other" } },
      { ...grant, fields: { ...grant.fields, nested: { a: 1 } } },
      { ...grant, fields: { ...grant.fields, file: "x" } },
    ];
    for (const b of bad) expect(() => parseImageUploadGrant(b, now)).toThrow(/rejected/);
  });
  it("Cloudinary response: only the exact reserved delivery URL is accepted", () => {
    const pub = grant.publicId;
    const ok = { public_id: pub, resource_type: "image", format: "png", secure_url: `https://res.cloudinary.com/dyvupboym/image/upload/v1791267255/${pub}.png` };
    expect(parseCloudinaryUpload(ok, { publicId: pub })).toBe(ok.secure_url);
    const bads = [
      { ...ok, public_id: "balr-market/events/usr_abc/other" },
      { ...ok, secure_url: ok.secure_url.replace("https:", "http:") },
      { ...ok, secure_url: ok.secure_url.replace("res.cloudinary.com", "evil.example") },
      { ...ok, secure_url: ok.secure_url + "?x=1" },
      { ...ok, secure_url: ok.secure_url.replace("/dyvupboym/", "/othercloud/") },
      { ...ok, secure_url: ok.secure_url.replace(".png", ".svg") },
      { ...ok, secure_url: `https://res.cloudinary.com/dyvupboym/image/upload/v1/balr-market/events/usr_abc/../x.png` },
      { ...ok, resource_type: "raw" },
      { ...ok, secure_url: undefined },
      "nope",
    ];
    for (const b of bads) expect(() => parseCloudinaryUpload(b, { publicId: pub })).toThrow();
  });
  it("file type and size are checked client-side", () => {
    expect(imageFileError({ type: "image/png", size: 1000 })).toBeNull();
    expect(imageFileError({ type: "image/gif", size: 1000 })).toMatch(/PNG, JPEG or WebP/);
    expect(imageFileError({ type: "image/svg+xml", size: 1000 })).toMatch(/PNG/);
    expect(imageFileError({ type: "image/png", size: 0 })).toMatch(/empty/);
    expect(imageFileError({ type: "image/png", size: 6 * 1024 * 1024 })).toMatch(/5 MB/);
  });
  it("the real uploaded fixture URL is allowed; arbitrary hosts are not", () => {
    expect(isAllowedImageUrl(FX.imageUpload.secureUrl, FX.imageUpload.publicId)).toBe(true);
    expect(isAllowedImageUrl("https://cdn.example.com/a.png")).toBe(false);
    expect(isAllowedImageUrl("data:image/png;base64,AAAA")).toBe(false);
  });
});

describe("sanity: PublicKey import is real web3", () => {
  it("derives the known market config", () => expect(deriveCreateAccounts(WALLET, "q").marketConfig).toBe(new PublicKey(FX.marketConfig.address).toBase58()));
});
