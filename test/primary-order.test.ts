/**
 * Adversarial tests for the strict primary-buy check (src/lib/panta/primary-order.ts).
 * The fixture is a real POST /primaryorderbuild/ response (3 Oct 2026) for an
 * unfunded throwaway public key — nothing was signed; the memo's userId is
 * replaced with "usr_fixture".
 */
import { Keypair, PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import fixture from "./fixtures/primary-build.live-2026-10-03.json";
import type { BuiltInstruction, PrimaryBuild, Quote } from "@/lib/panta/domain";
import { assertFeePayer, PANTA_USDC_PROGRAM_ID } from "@/lib/panta/instructions";
import { checkBuild } from "@/lib/panta/orders";
import {
  decodePrimaryOrderData,
  usdcToBase,
  verifyVaultAuthorityOnChain,
  VAULT_AUTHORITY_DISCRIMINATOR,
} from "@/lib/panta/primary-order";
import { instructionsToVersionedTx } from "@/lib/solana";

const wallet = new PublicKey(fixture.wallet);
const quote = { ...fixture.quote } as Quote;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const build = (over: Partial<PrimaryBuild> = {}): PrimaryBuild => ({ ...(clone(fixture.build) as PrimaryBuild), ...over });
const pantaIx = (b: PrimaryBuild) => b.instructions.find((i) => i.programId === PANTA_USDC_PROGRAM_ID)!;
const setData = (b: PrimaryBuild, hex: string) => {
  pantaIx(b).data = Buffer.from(hex, "hex").toString("base64");
  return b;
};
const reason = (r: ReturnType<typeof checkBuild>) => (r.ok ? "ok" : r.reason);

describe("decoding", () => {
  it("decodes the live build: NO, 2.50 USDC", () => {
    expect(decodePrimaryOrderData(pantaIx(build()).data)).toEqual({ side: "no", amountBase: BigInt(2_500_000) });
  });
  it("rejects wrong length / discriminator / side byte", () => {
    expect(decodePrimaryOrderData(Buffer.from("2e89447431590df701a0252600000000", "hex").toString("base64"))).toBeNull();
    expect(decodePrimaryOrderData(Buffer.from("ff89447431590df701a025260000000000", "hex").toString("base64"))).toBeNull();
    expect(decodePrimaryOrderData(Buffer.from("2e89447431590df702a025260000000000", "hex").toString("base64"))).toBeNull();
  });
  it("USDC decimal → base units is exact", () => {
    expect(usdcToBase("2.50")).toBe(BigInt(2_500_000));
    expect(usdcToBase("2.5")).toBe(BigInt(2_500_000));
    expect(usdcToBase("0.000001")).toBe(BigInt(1));
    expect(usdcToBase("1.0000001")).toBeNull();
    expect(usdcToBase("-1")).toBeNull();
    expect(usdcToBase("")).toBeNull();
    expect(usdcToBase("1e3")).toBeNull();
  });
});

describe("checkBuild (strict)", () => {
  it("valid live build passes and reports what was verified", () => {
    const r = checkBuild(build(), quote, wallet);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.verified).toMatchObject({ amountBase: "2500000", side: "no", marketId: quote.marketId, memoBindsQuote: true });
    }
  });
  it("amount mismatch (build metadata) — even by one base unit", () => {
    expect(reason(checkBuild(build({ amountUsdc: "100.00" }), quote, wallet))).toMatch(/Build amount/);
    expect(reason(checkBuild(build({ amountUsdc: "2.500001" }), quote, wallet))).toMatch(/Build amount/);
    expect(reason(checkBuild(build({ amountUsdc: "2.5" }), quote, wallet))).toBe("ok"); // same base units
  });
  it("market mismatch", () => {
    expect(reason(checkBuild(build({ marketId: Keypair.generate().publicKey.toBase58() }), quote, wallet))).toMatch(/market/);
  });
  it("side mismatch", () => {
    expect(reason(checkBuild(build({ side: "yes" }), quote, wallet))).toMatch(/side/);
  });
  it("quoteId mismatch", () => {
    expect(reason(checkBuild(build({ quoteId: "qt_other" }), quote, wallet))).toMatch(/active quote/);
  });
  it("missing metadata fails closed", () => {
    expect(reason(checkBuild(build({ quoteId: "" }), quote, wallet))).toMatch(/quoteId/);
    expect(reason(checkBuild(build({ marketId: "" }), quote, wallet))).toMatch(/market/);
    expect(reason(checkBuild(build({ side: null }), quote, wallet))).toMatch(/side/);
    expect(reason(checkBuild(build({ wallet: "" }), quote, wallet))).toMatch(/wallet/);
    expect(reason(checkBuild(build({ amountUsdc: "" }), quote, wallet))).toMatch(/amount/);
    expect(reason(checkBuild(build(), null, wallet))).toMatch(/No approved quote/);
    expect(reason(checkBuild(build(), { ...quote, amountUsdc: "" }, wallet))).toMatch(/Quote amount/);
  });
  it("wrong instruction amount (metadata says 2.50, instruction pays 250)", () => {
    const b = setData(build(), "2e89447431590df701" + Buffer.from(new BigUint64Array([BigInt(250_000_000)]).buffer).toString("hex"));
    expect(reason(checkBuild(b, quote, wallet))).toMatch(/Instruction amount/);
  });
  it("wrong instruction side", () => {
    expect(reason(checkBuild(setData(build(), "2e89447431590df700a025260000000000"), quote, wallet))).toMatch(/Instruction side/);
  });
  it("unrecognised Panta instruction data", () => {
    expect(reason(checkBuild(setData(build(), "00112233"), quote, wallet))).toMatch(/primary_order_usdc/);
  });
  it("wrong program", () => {
    const b = build();
    pantaIx(b).programId = Keypair.generate().publicKey.toBase58();
    expect(reason(checkBuild(b, quote, wallet))).toMatch(/unexpected program/);
  });
  it("a bare SPL Token / System instruction is rejected", () => {
    const b = build();
    b.instructions.push({ programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", data: "AwAAAAAAAAAA", accounts: [{ pubkey: wallet.toBase58(), isSigner: true, isWritable: true }] });
    expect(reason(checkBuild(b, quote, wallet))).toMatch(/Unexpected top-level/);
  });
  it("extra signer", () => {
    const b = build();
    pantaIx(b).accounts[3] = { pubkey: Keypair.generate().publicKey.toBase58(), isSigner: true, isWritable: false };
    expect(reason(checkBuild(b, quote, wallet))).toMatch(/extra signer/);
  });
  it("wrong wallet (connected wallet differs from the build)", () => {
    expect(reason(checkBuild(build(), quote, Keypair.generate().publicKey))).toMatch(/wallet/);
  });
  it("redirected destination accounts are rejected", () => {
    const swap = (i: number) => {
      const b = build();
      pantaIx(b).accounts[i] = { ...pantaIx(b).accounts[i], pubkey: Keypair.generate().publicKey.toBase58() };
      return reason(checkBuild(b, quote, wallet));
    };
    expect(swap(4)).toMatch(/vault token account/); // vault
    expect(swap(7)).toMatch(/paying account/); // source of funds
    expect(swap(8)).toMatch(/treasury/);
    expect(swap(5)).toMatch(/position/);
    expect(swap(2)).toMatch(/config/);
    expect(swap(6)).toMatch(/USDC/);
  });
  it("an on-curve (wallet-like) vault authority is rejected", () => {
    const b = build();
    pantaIx(b).accounts[3] = { pubkey: Keypair.generate().publicKey.toBase58(), isSigner: false, isWritable: false };
    expect(reason(checkBuild(b, quote, wallet))).toMatch(/vault authority|vault token/);
  });
  it("memo bound to another quote is rejected", () => {
    const b = build();
    const memo = b.instructions.find((i) => i.programId.startsWith("Memo"))!;
    memo.data = Buffer.from("panta:v1:usr_fixture:qt_other:" + b.orderId).toString("base64");
    expect(reason(checkBuild(b, quote, wallet))).toMatch(/Memo/);
  });
  it("ATA instruction for someone else's account is rejected", () => {
    const b = build();
    const ata = b.instructions.find((i) => i.programId.startsWith("AToken")) as BuiltInstruction;
    ata.accounts[2] = { ...ata.accounts[2], pubkey: Keypair.generate().publicKey.toBase58() };
    expect(reason(checkBuild(b, quote, wallet))).toMatch(/Associated-token/);
  });
  it("two Panta instructions are rejected", () => {
    const b = build();
    b.instructions.push(clone(pantaIx(b)));
    expect(reason(checkBuild(b, quote, wallet))).toMatch(/exactly 1/);
  });
  it("compiled tx: fee payer is the wallet and it is the only signer", () => {
    const tx = instructionsToVersionedTx(build().instructions, wallet, fixture.build.recentBlockhash);
    expect(() => assertFeePayer(tx, wallet)).not.toThrow();
    expect(tx.message.header.numRequiredSignatures).toBe(1);
  });
});

describe("verifyVaultAuthorityOnChain", () => {
  const VA = pantaIx(build()).accounts[3].pubkey;
  const good = { owner: new PublicKey(PANTA_USDC_PROGRAM_ID), data: Buffer.from(VAULT_AUTHORITY_DISCRIMINATOR + "ff", "hex") };
  it("Panta-owned vault-authority account passes", async () => {
    expect(await verifyVaultAuthorityOnChain({ getAccountInfo: async () => good }, VA)).toBeNull();
  });
  it("other owner / layout / missing / RPC error fail closed", async () => {
    expect(await verifyVaultAuthorityOnChain({ getAccountInfo: async () => ({ ...good, owner: Keypair.generate().publicKey }) }, VA)).toMatch(/not owned/);
    expect(await verifyVaultAuthorityOnChain({ getAccountInfo: async () => ({ ...good, data: Buffer.alloc(9) }) }, VA)).toMatch(/layout/);
    expect(await verifyVaultAuthorityOnChain({ getAccountInfo: async () => null }, VA)).toMatch(/does not exist/);
    expect(
      await verifyVaultAuthorityOnChain({ getAccountInfo: async () => { throw new Error("429"); } }, VA),
    ).toMatch(/Could not read/);
  });
});
