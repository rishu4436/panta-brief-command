import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import type { BuiltInstruction, PrimaryBuild, Quote } from "@/lib/panta/domain";
import {
  assertFeePayer,
  MAX_INSTRUCTIONS,
  PANTA_USDC_PROGRAM_ID,
  PROGRAM_LABELS,
  validatePantaInstructions,
} from "@/lib/panta/instructions";
import { checkBuild } from "@/lib/panta/orders";
import { instructionsToVersionedTx } from "@/lib/solana";

const wallet = Keypair.generate().publicKey;
const other = Keypair.generate().publicKey;
const MARKET = Keypair.generate().publicKey.toBase58();
const BLOCKHASH = Keypair.generate().publicKey.toBase58();

const COMPUTE_BUDGET = Object.keys(PROGRAM_LABELS).find((k) => /compute/i.test(PROGRAM_LABELS[k]))!;

function ix(programId: string, signer: PublicKey = wallet): BuiltInstruction {
  return {
    programId,
    accounts: [
      { pubkey: signer.toBase58(), isSigner: true, isWritable: true },
      { pubkey: MARKET, isSigner: false, isWritable: true },
    ],
    data: Buffer.from([1, 2, 3]).toString("base64"),
  };
}

const quote: Quote = {
  quoteId: "q1",
  marketId: MARKET,
  side: "yes",
  amountUsdc: "1",
} as Quote;

const build = (over: Partial<PrimaryBuild> = {}): PrimaryBuild =>
  ({
    orderId: "o1",
    quoteId: "q1",
    marketId: MARKET,
    side: "yes",
    wallet: wallet.toBase58(),
    instructions: [ix(COMPUTE_BUDGET), ix(PANTA_USDC_PROGRAM_ID)],
    recentBlockhash: BLOCKHASH,
    ...over,
  }) as PrimaryBuild;

describe("pre-sign instruction validation", () => {
  it("allowed programs pass", () => {
    const r = validatePantaInstructions([ix(COMPUTE_BUDGET), ix(PANTA_USDC_PROGRAM_ID)], wallet);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.programs).toContain(PANTA_USDC_PROGRAM_ID);
  });

  it("an unknown program is blocked", () => {
    const rogue = Keypair.generate().publicKey.toBase58();
    const r = validatePantaInstructions([ix(PANTA_USDC_PROGRAM_ID), ix(rogue)], wallet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/unexpected program/);
  });

  it("a build without the Panta program is blocked", () => {
    const r = validatePantaInstructions([ix(SystemProgram.programId.toBase58())], wallet);
    expect(r.ok).toBe(false);
  });

  it("an extra signer other than the wallet is blocked", () => {
    const r = validatePantaInstructions([ix(PANTA_USDC_PROGRAM_ID, other)], wallet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/extra signer/);
  });

  it("the instruction count cap is enforced", () => {
    const many = Array.from({ length: MAX_INSTRUCTIONS + 1 }, () => ix(PANTA_USDC_PROGRAM_ID));
    const r = validatePantaInstructions(many, wallet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/max 10/);
    expect(validatePantaInstructions(many.slice(0, MAX_INSTRUCTIONS), wallet).ok).toBe(true);
  });

  it("the fee payer must be the wallet", () => {
    const instructions = [ix(PANTA_USDC_PROGRAM_ID)];
    const good = instructionsToVersionedTx(instructions, wallet, BLOCKHASH);
    expect(() => assertFeePayer(good, wallet)).not.toThrow();
    const bad = instructionsToVersionedTx(instructions, other, BLOCKHASH);
    expect(() => assertFeePayer(bad, wallet)).toThrow(/Fee payer/);
  });
});

describe("quote/build cross-check (checkBuild)", () => {
  it("a matching build passes", () => {
    expect(checkBuild(build(), quote, wallet).ok).toBe(true);
  });

  it("quote id mismatch is caught", () => {
    const r = checkBuild(build({ quoteId: "q2" }), quote, wallet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/active quote/);
  });

  it("market or side mismatch is caught", () => {
    expect(checkBuild(build({ marketId: Keypair.generate().publicKey.toBase58() }), quote, wallet).ok).toBe(false);
    expect(checkBuild(build({ side: "no" }), quote, wallet).ok).toBe(false);
  });

  it("build for another wallet is caught", () => {
    const r = checkBuild(build({ wallet: other.toBase58() }), quote, wallet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/wallet/);
  });
});
