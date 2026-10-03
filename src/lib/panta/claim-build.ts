/**
 * Strict verification of a Panta claim build (win claim / creator-fee claim)
 * before signing — the claim counterpart of ./primary-order.ts.
 *
 * Layouts are taken from real data, not guessed (no public IDL):
 *  - 52 mainnet claim transactions (42 ClaimWinUsdc, 10 ClaimCreatorFeesUsdc)
 *    found read-only via getSignaturesForAddress on resolved/graduated market
 *    accounts + getTransaction (log "Instruction: ClaimWinUsdc" /
 *    "Instruction: ClaimCreatorFeesUsdc"), 3 Oct 2026;
 *  - two live POST /claim/creator-fees/build/ responses for public creator
 *    wallets (unsigned; nothing was signed).
 * Fixture: test/fixtures/claims.mainnet-2026-10-03.json.
 *
 * claim_win_usdc — data (40 bytes) = sha256("global:claim_win_usdc")[0..8]
 *                  | claimant pubkey (32 bytes; equal to account 0 in all 42 txs)
 *   accounts (12):
 *    0 claimant (signer, writable)       = connected wallet
 *    1 market config                     = PDA(["market_config"])
 *    2 market / event                    = requested marketId
 *    3 vault authority                   = per-market Panta account (seeds not
 *                                          recovered; proven on-chain by owner +
 *                                          discriminator, see primary-order.ts)
 *    4 vault token account (writable)    = ATA(vault authority, USDC)
 *    5 user position                     = PDA(["position", market, wallet])
 *    6 win-claim record (writable)       = PDA(["win_claim", market, wallet])
 *    7 claimant USDC account (writable)  = ATA(wallet, USDC)   ← payout lands here
 *    8 USDC mint · 9 SPL Token · 10 Associated Token · 11 System
 *
 * claim_creator_fees_usdc — data (8 bytes) = sha256("global:claim_creator_fees_usdc")[0..8]
 *   accounts (10):
 *    0 creator (signer, writable)        = connected wallet
 *    1 market config                     = PDA(["market_config"])
 *    2 market / event                    = requested marketId
 *    3 creator-fee vault (writable)      = PDA(["creator_fee_vault_usdc", market])
 *                                          (matches all 12 observed vaults)
 *    4 fee vault token account (writable)= ATA(creator-fee vault, USDC)
 *    5 creator USDC account (writable)   = ATA(wallet, USDC)   ← fees land here
 *    6 USDC mint · 7 SPL Token · 8 Associated Token · 9 System
 *   On-chain CreatorFeeVault account (89 bytes, Anchor "account:CreatorFeeVault"):
 *   event pubkey at [8..40], creator pubkey at [40..72] (all 12 observed).
 *
 * Allowed top-level instructions around the claim: bounded ComputeBudget
 * (seen on 6 mainnet txs) and "create my own USDC account" (docs: creator-fee
 * builds "may include create-ATA"). Anything else — memo, transfers, a second
 * Panta instruction, unknown data — blocks signing. Missing metadata fails closed.
 */

import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";
import type { BuiltInstruction, ClaimBuild, ClaimKind } from "./domain";
import { PANTA_USDC_PROGRAM_ID, validatePantaInstructions } from "./instructions";
import {
  accIs,
  ATA_PROGRAM,
  ataAddress,
  checkComputeBudget,
  COMPUTE_BUDGET_PROGRAM,
  isCreateOwnUsdcAta,
  marketConfigAddress,
  SYSTEM_PROGRAM,
  TOKEN_PROGRAM,
  USDC_MINT,
  userPositionAddress,
  type AccountInfoReader,
} from "./primary-order";

/** sha256("global:claim_win_usdc")[0..8] */
export const CLAIM_WIN_DISCRIMINATOR = "2ba06a33a74c141f";
/** sha256("global:claim_creator_fees_usdc")[0..8] */
export const CLAIM_CREATOR_FEES_DISCRIMINATOR = "4393ec977db58a00";
/** sha256("account:CreatorFeeVault")[0..8] */
export const CREATOR_FEE_VAULT_ACCOUNT_DISCRIMINATOR = "150ed7f7c589c879";
const CREATOR_FEE_VAULT_LEN = 89;

const PANTA = new PublicKey(PANTA_USDC_PROGRAM_ID);

export function winClaimAddress(market: PublicKey, wallet: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("win_claim"), market.toBuffer(), wallet.toBuffer()], PANTA)[0];
}
export function creatorFeeVaultAddress(market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("creator_fee_vault_usdc"), market.toBuffer()], PANTA)[0];
}

/** Which claim the instruction data encodes; null for anything not exactly a known layout. */
export function decodeClaimData(b64: string): { kind: "win"; claimant: string } | { kind: "creator-fees" } | null {
  let d: Buffer;
  try {
    d = Buffer.from(b64, "base64");
  } catch {
    return null;
  }
  const disc = d.subarray(0, 8).toString("hex");
  if (disc === CLAIM_WIN_DISCRIMINATOR && d.length === 40) {
    return { kind: "win", claimant: new PublicKey(d.subarray(8, 40)).toBase58() };
  }
  if (disc === CLAIM_CREATOR_FEES_DISCRIMINATOR && d.length === 8) return { kind: "creator-fees" };
  return null;
}

export type VerifiedClaim = {
  ok: true;
  kind: ClaimKind;
  count: number;
  programs: string[];
  verified: {
    wallet: string;
    marketId: string;
    /** Account the USDC is paid into (the wallet's own USDC ATA). */
    destination: string;
    /** Account the USDC is paid from. */
    sourceTokenAccount: string;
    /** Win: vault authority (needs the on-chain check). Creator fees: fee vault (seed-derived). */
    vaultAccount: string;
  };
};
export type ClaimCheck = VerifiedClaim | { ok: false; reason: string };

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason: `${reason} Signing blocked.` });

function key(v: string | undefined): PublicKey | null {
  if (!v) return null;
  try {
    return new PublicKey(v);
  } catch {
    return null;
  }
}

const RO = { writable: false, signer: false } as const;
const RW = { writable: true, signer: false } as const;

/**
 * Full pre-sign check of a claim build against the requested claim and the
 * connected wallet. Fails closed on any missing or mismatched field.
 */
export function verifyClaimBuild(
  built: ClaimBuild,
  request: { kind: ClaimKind; marketId: string },
  wallet: PublicKey,
): ClaimCheck {
  const w = wallet.toBase58();
  // --- metadata: every field required, every field must match
  if (!built.wallet) return fail("Claim build did not say which wallet it is for.");
  if (built.wallet !== w) return fail("Claim build wallet does not match the connected wallet.");
  if (!request.marketId) return fail("No market was requested.");
  if (!built.marketId) return fail("Claim build did not include its market.");
  if (built.marketId !== request.marketId) return fail("Claim build market differs from the requested market.");
  if (built.kind !== request.kind) return fail("Claim build is for a different claim type.");
  const market = key(request.marketId);
  if (!market) return fail("Requested market id is not a valid address.");

  // --- generic allowlist (programs, signers, sizes)
  const generic = validatePantaInstructions(built.instructions, wallet);
  if (!generic.ok) return generic;

  const panta = built.instructions.filter((ix) => ix.programId === PANTA_USDC_PROGRAM_ID);
  if (panta.length !== 1) return fail(`Claim build has ${panta.length} Panta instructions (expected exactly 1).`);
  const budget: BuiltInstruction[] = [];
  for (const ix of built.instructions) {
    if (ix.programId === PANTA_USDC_PROGRAM_ID) continue;
    if (ix.programId === COMPUTE_BUDGET_PROGRAM) {
      budget.push(ix);
      continue;
    }
    if (ix.programId === ATA_PROGRAM && isCreateOwnUsdcAta(ix, wallet)) continue;
    return fail(`Unexpected top-level instruction for a claim (${ix.programId}).`);
  }
  const cb = checkComputeBudget(budget);
  if (cb) return fail(cb);

  // --- the Panta instruction itself
  const ix = panta[0];
  const data = decodeClaimData(ix.data);
  if (!data) return fail("Panta instruction is not a recognisable claim_win_usdc / claim_creator_fees_usdc.");
  if (data.kind !== request.kind) {
    return fail(`Panta instruction is a ${data.kind === "win" ? "win" : "creator-fee"} claim, not the requested ${request.kind === "win" ? "win" : "creator-fee"} claim.`);
  }
  const a = ix.accounts;
  const userAta = ataAddress(wallet);
  const common: [boolean, string][] = [
    [accIs(a[0], w, { signer: true, writable: true }), "claimant is not your wallet"],
    [accIs(a[1], marketConfigAddress(), RO), "market config is not Panta's"],
    [accIs(a[2], market, RO), "market account differs from the requested market"],
  ];

  if (data.kind === "win") {
    if (a.length !== 12) return fail(`Panta win-claim instruction has ${a.length} accounts (expected 12).`);
    if (data.claimant !== w) return fail("Win-claim data names a different claimant.");
    const vaultAuthority = key(a[3]?.pubkey);
    if (!vaultAuthority) return fail("Vault authority is not a valid address.");
    const checks: [boolean, string][] = [
      ...common,
      [!PublicKey.isOnCurve(vaultAuthority.toBytes()) && accIs(a[3], vaultAuthority, RO) && a[3].pubkey !== w, "vault authority is not a program address"],
      [accIs(a[4], ataAddress(vaultAuthority), RW), "payout source is not the vault's USDC account"],
      [accIs(a[5], userPositionAddress(market, wallet), RO), "position account is not yours for this market"],
      [accIs(a[6], winClaimAddress(market, wallet), RW), "win-claim record is not yours for this market"],
      [accIs(a[7], userAta, RW), "payout destination is not your USDC account"],
      [accIs(a[8], USDC_MINT, RO), "mint is not USDC"],
      [accIs(a[9], TOKEN_PROGRAM, RO), "token program mismatch"],
      [accIs(a[10], ATA_PROGRAM, RO), "associated-token program mismatch"],
      [accIs(a[11], SYSTEM_PROGRAM, RO), "system program mismatch"],
    ];
    for (const [ok, why] of checks) if (!ok) return fail(`Win claim: ${why}.`);
    return {
      ok: true,
      kind: "win",
      count: generic.count,
      programs: generic.programs,
      verified: { wallet: w, marketId: request.marketId, destination: a[7].pubkey, sourceTokenAccount: a[4].pubkey, vaultAccount: a[3].pubkey },
    };
  }

  if (a.length !== 10) return fail(`Panta creator-fee instruction has ${a.length} accounts (expected 10).`);
  const feeVault = creatorFeeVaultAddress(market);
  const checks: [boolean, string][] = [
    ...common,
    [accIs(a[3], feeVault, RW), "creator-fee vault is not this market's"],
    [accIs(a[4], ataAddress(feeVault), RW), "fee source is not the creator-fee vault's USDC account"],
    [accIs(a[5], userAta, RW), "fee destination is not your USDC account"],
    [accIs(a[6], USDC_MINT, RO), "mint is not USDC"],
    [accIs(a[7], TOKEN_PROGRAM, RO), "token program mismatch"],
    [accIs(a[8], ATA_PROGRAM, RO), "associated-token program mismatch"],
    [accIs(a[9], SYSTEM_PROGRAM, RO), "system program mismatch"],
  ];
  for (const [ok, why] of checks) if (!ok) return fail(`Creator-fee claim: ${why}.`);
  return {
    ok: true,
    kind: "creator-fees",
    count: generic.count,
    programs: generic.programs,
    verified: { wallet: w, marketId: request.marketId, destination: a[5].pubkey, sourceTokenAccount: a[4].pubkey, vaultAccount: feeVault.toBase58() },
  };
}

/**
 * Creator-fee vault on-chain: Panta-owned CreatorFeeVault account whose event
 * is this market and whose creator is the connected wallet. RPC failure
 * fails closed.
 */
export async function verifyCreatorFeeVaultOnChain(
  rpc: AccountInfoReader,
  feeVault: string,
  marketId: string,
  wallet: string,
): Promise<string | null> {
  let info: Awaited<ReturnType<AccountInfoReader["getAccountInfo"]>>;
  try {
    info = await rpc.getAccountInfo(new PublicKey(feeVault));
  } catch {
    return "Could not read the creator-fee vault on-chain. Signing blocked.";
  }
  if (!info) return "Creator-fee vault does not exist on-chain. Signing blocked.";
  if (!info.owner.equals(PANTA)) return "Creator-fee vault is not owned by the Panta program. Signing blocked.";
  const d = Buffer.from(info.data);
  if (d.length !== CREATOR_FEE_VAULT_LEN || d.subarray(0, 8).toString("hex") !== CREATOR_FEE_VAULT_ACCOUNT_DISCRIMINATOR) {
    return "Creator-fee vault account has an unexpected layout. Signing blocked.";
  }
  if (new PublicKey(d.subarray(8, 40)).toBase58() !== marketId) return "Creator-fee vault belongs to another market. Signing blocked.";
  if (new PublicKey(d.subarray(40, 72)).toBase58() !== wallet) return "Connected wallet is not this market's creator. Signing blocked.";
  return null;
}
