/**
 * Adversarial tests for the strict claim-build check (src/lib/panta/claim-build.ts).
 * Fixtures are real: 52 mainnet claim transactions (42 ClaimWinUsdc, 10
 * ClaimCreatorFeesUsdc) converted to Panta's instruction-list shape, and two
 * live POST /claim/creator-fees/build/ responses (unsigned, never signed).
 */
import { Keypair, PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import fixture from "./fixtures/claims.mainnet-2026-10-03.json";
import type { BuiltInstruction, ClaimBuild, ClaimKind } from "@/lib/panta/domain";
import { assertFeePayer, PANTA_USDC_PROGRAM_ID } from "@/lib/panta/instructions";
import { parseClaimBuild } from "@/lib/panta/claims";
import {
  CLAIM_CREATOR_FEES_DISCRIMINATOR,
  CLAIM_WIN_DISCRIMINATOR,
  CREATOR_FEE_VAULT_ACCOUNT_DISCRIMINATOR,
  creatorFeeVaultAddress,
  decodeClaimData,
  verifyClaimBuild,
  verifyCreatorFeeVaultOnChain,
  winClaimAddress,
} from "@/lib/panta/claim-build";
import { ataAddress } from "@/lib/panta/primary-order";
import { instructionsToVersionedTx } from "@/lib/solana";

type Tx = (typeof fixture.mainnet)[number];
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const BLOCKHASH = "8m3EAUuSEh72zykvykoShV4YAeNCd7CEf1ttCCK3Dsqw";
const asBuild = (t: Tx, over: Partial<ClaimBuild> = {}): ClaimBuild => ({
  kind: t.kind as ClaimKind,
  wallet: t.wallet,
  marketId: t.marketId,
  instructions: clone(t.instructions) as BuiltInstruction[],
  recentBlockhash: BLOCKHASH,
  ...over,
});
const wins = fixture.mainnet.filter((t) => t.kind === "win");
const fees = fixture.mainnet.filter((t) => t.kind === "creator-fees");
const WIN = wins[0];
const FEE = fees[0];
const pantaIx = (b: ClaimBuild) => b.instructions.find((i) => i.programId === PANTA_USDC_PROGRAM_ID)!;
const check = (b: ClaimBuild, kind: ClaimKind = b.kind, marketId = b.marketId, wallet = b.wallet) =>
  verifyClaimBuild(b, { kind, marketId }, new PublicKey(wallet));
const reason = (r: ReturnType<typeof verifyClaimBuild>) => (r.ok ? "ok" : r.reason);
const other = Keypair.generate().publicKey.toBase58();

describe("fixtures are what they claim to be", () => {
  it("covers both claim kinds", () => {
    expect(wins.length).toBeGreaterThanOrEqual(40);
    expect(fees.length).toBeGreaterThanOrEqual(10);
    expect(fixture.liveCreatorFeeBuilds.length).toBe(2);
  });
  it("discriminators are Anchor sha256('global:<name>')[0..8]", async () => {
    const { createHash } = await import("node:crypto");
    const d = (n: string) => createHash("sha256").update(`global:${n}`).digest().subarray(0, 8).toString("hex");
    expect(d("claim_win_usdc")).toBe(CLAIM_WIN_DISCRIMINATOR);
    expect(d("claim_creator_fees_usdc")).toBe(CLAIM_CREATOR_FEES_DISCRIMINATOR);
    const a = createHash("sha256").update("account:CreatorFeeVault").digest().subarray(0, 8).toString("hex");
    expect(a).toBe(CREATOR_FEE_VAULT_ACCOUNT_DISCRIMINATOR);
  });
});

describe("valid real claims pass", () => {
  it.each(wins.map((t) => [t.signature.slice(0, 12), t] as const))("mainnet win claim %s", (_s, t) => {
    const r = check(asBuild(t));
    expect(reason(r)).toBe("ok");
    if (r.ok) {
      const w = new PublicKey(t.wallet);
      expect(r.verified.destination).toBe(ataAddress(w).toBase58());
      expect(r.verified.marketId).toBe(t.marketId);
    }
  });
  it.each(fees.map((t) => [t.signature.slice(0, 12), t] as const))("mainnet creator-fee claim %s", (_s, t) => {
    const r = check(asBuild(t));
    expect(reason(r)).toBe("ok");
    if (r.ok) expect(r.verified.vaultAccount).toBe(creatorFeeVaultAddress(new PublicKey(t.marketId)).toBase58());
  });
  it.each(fixture.liveCreatorFeeBuilds.map((b) => [b.request.marketId.slice(0, 8), b] as const))(
    "live POST /claim/creator-fees/build/ %s (parsed by the adapter)",
    (_m, b) => {
      const built = parseClaimBuild("creator-fees", b.response);
      const r = verifyClaimBuild(built, { kind: "creator-fees", marketId: b.request.marketId }, new PublicKey(b.request.wallet));
      expect(reason(r)).toBe("ok");
      // Panta's own `derived` block agrees with what we re-derived.
      if (r.ok) {
        expect(r.verified.vaultAccount).toBe(b.response.derived.creatorFeeVault);
        expect(r.verified.sourceTokenAccount).toBe(b.response.derived.creatorFeeVaultTokenAccount);
        expect(r.verified.destination).toBe(b.response.derived.creatorTokenAccount);
      }
    },
  );
  it("win claim record PDA and claimant arg match every tx", () => {
    for (const t of wins) {
      const ix = t.instructions.find((i) => i.programId === PANTA_USDC_PROGRAM_ID)!;
      expect(ix.accounts[6].pubkey).toBe(winClaimAddress(new PublicKey(t.marketId), new PublicKey(t.wallet)).toBase58());
      expect(decodeClaimData(ix.data)).toEqual({ kind: "win", claimant: t.wallet });
    }
  });
  it("compiled claim: fee payer is the wallet, one signer", () => {
    for (const t of [WIN, FEE]) {
      const b = asBuild(t);
      const tx = instructionsToVersionedTx(b.instructions, new PublicKey(t.wallet), BLOCKHASH);
      expect(() => assertFeePayer(tx, new PublicKey(t.wallet))).not.toThrow();
    }
  });
});

describe("metadata (fail closed)", () => {
  it("wrong wallet", () => {
    expect(reason(check(asBuild(WIN), "win", WIN.marketId, other))).toMatch(/wallet does not match/);
  });
  it("missing wallet", () => {
    expect(reason(check(asBuild(WIN, { wallet: "" }), "win", WIN.marketId, WIN.wallet))).toMatch(/did not say which wallet/);
  });
  it("wrong market", () => {
    expect(reason(check(asBuild(WIN, { marketId: wins[1].marketId === WIN.marketId ? FEE.marketId : wins[1].marketId })))).toMatch(
      /market account differs/,
    );
    expect(reason(check(asBuild(WIN), "win", FEE.marketId))).toMatch(/market differs from the requested/);
  });
  it("missing market (build or request)", () => {
    expect(reason(check(asBuild(WIN, { marketId: "" }), "win", WIN.marketId))).toMatch(/did not include its market/);
    expect(reason(check(asBuild(WIN), "win", ""))).toMatch(/No market was requested/);
  });
  it("wrong claim kind (build tagged for another operation)", () => {
    expect(reason(check(asBuild(WIN, { kind: "creator-fees" }), "win"))).toMatch(/different claim type/);
  });
  it("wrong claim kind (instruction encodes the other claim)", () => {
    expect(reason(check(asBuild(WIN, { kind: "creator-fees" }), "creator-fees"))).toMatch(/is a win claim, not the requested creator-fee/);
    expect(reason(check(asBuild(FEE, { kind: "win" }), "win"))).toMatch(/is a creator-fee claim, not the requested win/);
  });
});

describe("instructions (fail closed)", () => {
  it("wrong program", () => {
    const b = asBuild(WIN);
    pantaIx(b).programId = Keypair.generate().publicKey.toBase58();
    expect(reason(check(b))).toMatch(/unexpected program/);
  });
  it("wrong destination (win payout to someone else's USDC account)", () => {
    const b = asBuild(WIN);
    pantaIx(b).accounts[7].pubkey = ataAddress(new PublicKey(other)).toBase58();
    expect(reason(check(b))).toMatch(/payout destination is not your USDC account/);
  });
  it("wrong destination (creator fees to someone else)", () => {
    const b = asBuild(FEE);
    pantaIx(b).accounts[5].pubkey = ataAddress(new PublicKey(other)).toBase58();
    expect(reason(check(b))).toMatch(/fee destination is not your USDC account/);
  });
  it("wrong vault / accounts", () => {
    const vaultTa = asBuild(WIN);
    pantaIx(vaultTa).accounts[4].pubkey = ataAddress(new PublicKey(other)).toBase58();
    expect(reason(check(vaultTa))).toMatch(/payout source is not the vault's USDC account/);
    const onCurveVa = asBuild(WIN);
    pantaIx(onCurveVa).accounts[3].pubkey = other;
    expect(reason(check(onCurveVa))).toMatch(/vault authority is not a program address/);
    const feeVault = asBuild(FEE);
    pantaIx(feeVault).accounts[3].pubkey = creatorFeeVaultAddress(new PublicKey(WIN.marketId)).toBase58();
    expect(reason(check(feeVault))).toMatch(/creator-fee vault is not this market's/);
    const winRecord = asBuild(WIN);
    pantaIx(winRecord).accounts[6].pubkey = winClaimAddress(new PublicKey(WIN.marketId), new PublicKey(other)).toBase58();
    expect(reason(check(winRecord))).toMatch(/win-claim record is not yours/);
    const position = asBuild(WIN);
    pantaIx(position).accounts[5].isWritable = true;
    expect(reason(check(position))).toMatch(/position account/);
    const marketWritable = asBuild(FEE);
    pantaIx(marketWritable).accounts[2].isWritable = true;
    expect(reason(check(marketWritable))).toMatch(/market account differs/);
    const tooFew = asBuild(WIN);
    pantaIx(tooFew).accounts.pop();
    expect(reason(check(tooFew))).toMatch(/has 11 accounts/);
  });
  it("extra signer", () => {
    const b = asBuild(WIN);
    pantaIx(b).accounts[5].isSigner = true;
    expect(reason(check(b))).toMatch(/extra signer/);
  });
  it("claimant arg names someone else", () => {
    const b = asBuild(WIN);
    const d = Buffer.from(pantaIx(b).data, "base64");
    new PublicKey(other).toBuffer().copy(d, 8);
    pantaIx(b).data = d.toString("base64");
    expect(reason(check(b))).toMatch(/names a different claimant/);
  });
  it("malformed / unknown data", () => {
    for (const hex of ["", "2ba06a33a74c141f", "4393ec977db58a0000", "ffa06a33a74c141f" + "00".repeat(32), "2e89447431590df701a025260000000000"]) {
      const b = asBuild(hex.startsWith("4393") ? FEE : WIN);
      pantaIx(b).data = Buffer.from(hex, "hex").toString("base64");
      expect(reason(check(b))).toMatch(/not a recognisable claim/);
    }
  });
  it("unexpected top-level instruction (SPL transfer, memo, second Panta ix, foreign ATA create)", () => {
    const transfer = asBuild(WIN);
    transfer.instructions.push({
      programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      data: Buffer.from([3, 1, 0, 0, 0, 0, 0, 0, 0]).toString("base64"),
      accounts: [{ pubkey: WIN.wallet, isSigner: true, isWritable: true }],
    });
    expect(reason(check(transfer))).toMatch(/Unexpected top-level instruction/);
    const memo = asBuild(WIN);
    memo.instructions.push({ programId: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", data: Buffer.from("hi").toString("base64"), accounts: [] });
    expect(reason(check(memo))).toMatch(/Unexpected top-level instruction/);
    const twice = asBuild(WIN);
    twice.instructions.push(clone(pantaIx(twice)));
    expect(reason(check(twice))).toMatch(/2 Panta instructions/);
    const ata = asBuild(FEE);
    ata.instructions.unshift({
      programId: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
      data: Buffer.from([1]).toString("base64"),
      accounts: [
        { pubkey: FEE.wallet, isSigner: true, isWritable: true },
        { pubkey: ataAddress(new PublicKey(other)).toBase58(), isSigner: false, isWritable: true },
        { pubkey: other, isSigner: false, isWritable: false },
        { pubkey: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", isSigner: false, isWritable: false },
        { pubkey: "11111111111111111111111111111111", isSigner: false, isWritable: false },
        { pubkey: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", isSigner: false, isWritable: false },
      ],
    });
    expect(reason(check(ata))).toMatch(/Unexpected top-level instruction/);
  });
  it("allows 'create my own USDC account' before a creator-fee claim (docs)", () => {
    const b = asBuild(FEE);
    b.instructions.unshift({
      programId: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
      data: Buffer.from([1]).toString("base64"),
      accounts: [
        { pubkey: FEE.wallet, isSigner: true, isWritable: true },
        { pubkey: ataAddress(new PublicKey(FEE.wallet)).toBase58(), isSigner: false, isWritable: true },
        { pubkey: FEE.wallet, isSigner: false, isWritable: false },
        { pubkey: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", isSigner: false, isWritable: false },
        { pubkey: "11111111111111111111111111111111", isSigner: false, isWritable: false },
        { pubkey: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", isSigner: false, isWritable: false },
      ],
    });
    expect(reason(check(b))).toBe("ok");
  });
  it("no instructions", () => {
    expect(reason(check(asBuild(WIN, { instructions: [] })))).toMatch(/no instructions/);
  });
});

describe("creator-fee vault on-chain check", () => {
  const PANTA = new PublicKey(PANTA_USDC_PROGRAM_ID);
  const vault = (market: string, creator: string) =>
    Buffer.concat([
      Buffer.from(CREATOR_FEE_VAULT_ACCOUNT_DISCRIMINATOR, "hex"),
      new PublicKey(market).toBuffer(),
      new PublicKey(creator).toBuffer(),
      Buffer.alloc(17),
    ]);
  const rpc = (info: { owner: PublicKey; data: Buffer } | null | "throw") => ({
    getAccountInfo: async () => {
      if (info === "throw") throw new Error("403");
      return info;
    },
  });
  const fv = creatorFeeVaultAddress(new PublicKey(FEE.marketId)).toBase58();
  it("passes for this market + creator", async () => {
    expect(await verifyCreatorFeeVaultOnChain(rpc({ owner: PANTA, data: vault(FEE.marketId, FEE.wallet) }), fv, FEE.marketId, FEE.wallet)).toBeNull();
  });
  it("fails closed: RPC error, missing, wrong owner, wrong layout, other market, not the creator", async () => {
    const go = (r: ReturnType<typeof rpc>) => verifyCreatorFeeVaultOnChain(r, fv, FEE.marketId, FEE.wallet);
    expect(await go(rpc("throw"))).toMatch(/Could not read/);
    expect(await go(rpc(null))).toMatch(/does not exist/);
    expect(await go(rpc({ owner: new PublicKey(other), data: vault(FEE.marketId, FEE.wallet) }))).toMatch(/not owned by the Panta/);
    expect(await go(rpc({ owner: PANTA, data: vault(FEE.marketId, FEE.wallet).subarray(0, 72) }))).toMatch(/unexpected layout/);
    expect(await go(rpc({ owner: PANTA, data: vault(WIN.marketId, FEE.wallet) }))).toMatch(/another market/);
    expect(await go(rpc({ owner: PANTA, data: vault(FEE.marketId, other) }))).toMatch(/not this market's creator/);
  });
});
