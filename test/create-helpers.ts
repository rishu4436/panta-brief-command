/** Shared fixtures + adversarial mutation helper for the create-market tests (not a test file). */
import { Buffer } from "buffer";
import { MessageV0, PublicKey, VersionedTransaction, type MessageCompiledInstruction } from "@solana/web3.js";
import type { CreateInput } from "@/lib/panta/create-rules";
import fixture from "./fixtures/create-build.live-2026-10-06.json";

type Scenario = {
  capturedAt: string;
  request: CreateInput & Record<string, unknown>;
  quote: Record<string, unknown> & { expiresAt: string; createId: string; expectedEventPda: string; paymentUsdc: string };
  build: Record<string, unknown> & { transaction: string; expiresAt: string; recentBlockhash: string; createId: string; derived: Record<string, string> };
};
export type CreateFixture = {
  breaking: Scenario;
  standard: Scenario;
  breakingInProgress: Scenario;
  marketConfig: { address: string; owner: string; dataBase64: string };
  imageUpload: { uploadUrl: string; publicId: string; secureUrl: string };
};

export const FX = fixture as unknown as CreateFixture;
export const WALLET = "41VsShZb5VTKCxRRiGq11GF6foLBVpLocjytBbQmYaGZ";
export const SCENARIOS = ["breaking", "standard", "breakingInProgress"] as const;

/** Input exactly as it was sent to Panta for the scenario. */
export function inputOf(s: Scenario): CreateInput {
  const r = s.request;
  const i: CreateInput = {
    wallet: r.wallet,
    question: r.question,
    resolutionRule: r.resolutionRule,
    sourcesOfTruth: [...r.sourcesOfTruth],
    category: r.category,
    startTime: r.startTime,
    endTime: r.endTime,
    resolutionTime: r.resolutionTime,
    marketType: r.marketType,
    imageUrl: r.imageUrl,
  };
  if (r.title) i.title = r.title;
  if (r.description) i.description = r.description;
  if (r.region) i.region = r.region;
  if (r.marketType === "breaking") i.eventInProgress = Boolean(r.eventInProgress);
  return i;
}

/** A moment when both the quote and the build were still valid. */
export const nowFor = (s: Scenario) => Date.parse(s.build.expiresAt) - 30_000;
export const nowSecFor = (s: Scenario) => Math.floor(Date.parse(s.capturedAt) / 1000) + 5;

export function marketConfigReader(dataBase64 = FX.marketConfig.dataBase64, owner = FX.marketConfig.owner) {
  return {
    getAccountInfo: async () => ({ owner: new PublicKey(owner), data: Buffer.from(dataBase64, "base64") }),
  };
}

type Parts = {
  header: { numRequiredSignatures: number; numReadonlySignedAccounts: number; numReadonlyUnsignedAccounts: number };
  staticAccountKeys: PublicKey[];
  recentBlockhash: string;
  compiledInstructions: MessageCompiledInstruction[];
  addressTableLookups: MessageV0["addressTableLookups"];
};

/**
 * Re-serialize the REAL Panta build after a targeted change. An identity
 * mutation reproduces the original bytes exactly (asserted in the tests),
 * so every adversarial variant differs from the real build only by `fn`.
 */
export function mutateTx(b64: string, fn: (p: Parts) => void, signatures?: (n: number) => Uint8Array[]): string {
  const tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
  const m = tx.message as MessageV0;
  const p: Parts = {
    header: { ...m.header },
    staticAccountKeys: [...m.staticAccountKeys],
    recentBlockhash: m.recentBlockhash,
    compiledInstructions: m.compiledInstructions.map((ci) => ({
      programIdIndex: ci.programIdIndex,
      accountKeyIndexes: [...ci.accountKeyIndexes],
      data: Uint8Array.from(ci.data),
    })),
    addressTableLookups: [...m.addressTableLookups],
  };
  fn(p);
  const msg = new MessageV0(p);
  const out = new VersionedTransaction(msg, signatures?.(msg.header.numRequiredSignatures));
  return Buffer.from(out.serialize()).toString("base64");
}

export const keyIndex = (p: Parts, k: string) => p.staticAccountKeys.findIndex((x) => x.toBase58() === k);
export const pantaIx = (p: Parts) => p.compiledInstructions[p.compiledInstructions.length - 1];
export function u64le(n: bigint): Uint8Array {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
}
export const randomKey = () => PublicKey.unique();
