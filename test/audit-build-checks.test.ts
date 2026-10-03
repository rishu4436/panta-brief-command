/**
 * Audit (Oct 2026 test pass): what checkBuild does and does not verify.
 * Uses mock builds only; nothing is signed.
 */
import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import type { BuiltInstruction, PrimaryBuild, Quote } from "@/lib/panta/domain";
import { assertFeePayer, PANTA_USDC_PROGRAM_ID } from "@/lib/panta/instructions";
import { checkBuild } from "@/lib/panta/orders";
import { instructionsToVersionedTx } from "@/lib/solana";

const wallet = Keypair.generate().publicKey;
const switched = Keypair.generate().publicKey;
const MARKET = Keypair.generate().publicKey.toBase58();
const BLOCKHASH = Keypair.generate().publicKey.toBase58();
const ix = (signer = wallet): BuiltInstruction => ({
  programId: PANTA_USDC_PROGRAM_ID,
  accounts: [
    { pubkey: signer.toBase58(), isSigner: true, isWritable: true },
    { pubkey: MARKET, isSigner: false, isWritable: true },
  ],
  data: Buffer.from([9]).toString("base64"),
});
const quote = { quoteId: "q1", marketId: MARKET, side: "yes", amountUsdc: "1.00", feeUsdc: "0.02" } as Quote;
const build = (over: Partial<PrimaryBuild> = {}): PrimaryBuild =>
  ({
    orderId: "o1",
    quoteId: "q1",
    marketId: MARKET,
    side: "yes",
    wallet: wallet.toBase58(),
    amountUsdc: "1.00",
    instructions: [ix()],
    recentBlockhash: BLOCKHASH,
    ...over,
  }) as PrimaryBuild;

describe("audit: wallet switch between build and sign", () => {
  it("a build for the previous wallet is blocked for the new wallet", () => {
    expect(checkBuild(build(), quote, switched).ok).toBe(false);
  });
  it("even if Panta omits build.wallet, the old wallet's signer account blocks it", () => {
    const r = checkBuild(build({ wallet: "" }), quote, switched);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/extra signer/);
  });
  it("the compiled fee payer is the connected wallet", () => {
    const tx = instructionsToVersionedTx(build().instructions, wallet, BLOCKHASH);
    expect(() => assertFeePayer(tx, wallet)).not.toThrow();
  });
});

describe("audit: known gaps (documented, not fixed)", () => {
  it("GAP P2: a build whose amountUsdc differs from the quote still passes checkBuild", () => {
    expect(checkBuild(build({ amountUsdc: "100.00" }), quote, wallet).ok).toBe(true);
  });
  it("GAP P2: a build that omits quoteId/marketId/side is not cross-checked", () => {
    expect(checkBuild(build({ quoteId: "", marketId: "", side: null }), quote, wallet).ok).toBe(true);
  });
});
