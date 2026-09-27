/**
 * On-chain market discovery for the Panta program.
 *
 * Why: the Panta REST list (`GET /markets/`) caps at 50 rows, its `nextCursor`
 * returns the same first page again, and it omits newer markets entirely
 * (checked 27 Sep 2026: all 4 primary-open USDC markets were missing from
 * every list/filter combination while `GET /markets/{id}/` served them).
 * Every Panta market is an Anchor `Event` account owned by the Panta program,
 * so one `getProgramAccounts` call enumerates all of them. The detail endpoint
 * mirrors these same account fields (question, endTime, primaryPhaseEndTime,
 * lastYesPrice, totalVolume, isGraduated / isResolved / isCancelled …).
 *
 * Layout: Anchor IDL `balr_market` (program 6gM5afTQ…), account `Event`.
 * Only the stable prefix is decoded; both deployed sizes (2947 and 2982
 * bytes) share it. Anything that fails a bounds check is skipped, never guessed.
 */

import { PANTA_USDC_PROGRAM_ID } from "./instructions";

/** Anchor discriminator of `Event` = sha256("account:Event")[0..8]. */
export const EVENT_DISCRIMINATOR = [125, 192, 125, 158, 9, 115, 152, 233] as const;
/** The same 8 bytes in base58 (getProgramAccounts memcmp filter). */
export const EVENT_DISCRIMINATOR_B58 = "N2xAZ8KxJz4";
export const PANTA_PROGRAM_ID = PANTA_USDC_PROGRAM_ID;

/** Prices on the account are 1e9-scaled; volumes are USDC base units (6 dp). */
const PRICE_SCALE = 1e9;
const USDC_DECIMALS = 6;
const MAX_STRING = 4096;

export type ChainEvent = {
  marketId: string;
  question: string;
  resolutionRule: string;
  oracle: string;
  startTime: number;
  endTime: number;
  resolutionTime: number;
  createdAt: number;
  resolvedAt: number;
  cancelledAt: number;
  primaryPhaseEndTime: number | null;
  /** lastYesPrice as a probability string in [0, 1] (same value the detail endpoint returns). */
  lastYesPrice: string | null;
  totalVolumeBase: string;
  activeVolumeBase: string;
  totalTrades: number;
  isActive: boolean;
  isGraduated: boolean;
  isResolved: boolean;
  isCancelled: boolean;
  yesWins: boolean;
};

export type ChainPhase = "primary" | "secondary" | "resolved" | "cancelled";

/** Lifecycle from the account flags (authoritative over the REST registry). */
export function chainPhase(ev: Pick<ChainEvent, "isCancelled" | "isResolved" | "isGraduated">): ChainPhase {
  if (ev.isCancelled) return "cancelled";
  if (ev.isResolved) return "resolved";
  if (ev.isGraduated) return "secondary";
  return "primary";
}

class Reader {
  o = 0;
  constructor(private b: Uint8Array, private v = new DataView(b.buffer, b.byteOffset, b.byteLength)) {}
  need(n: number) {
    if (this.o + n > this.b.length) throw new RangeError("short account");
  }
  skip(n: number) {
    this.need(n);
    this.o += n;
  }
  i64(): number {
    this.need(8);
    const x = this.v.getBigInt64(this.o, true);
    this.o += 8;
    return Number(x);
  }
  u64(): bigint {
    this.need(8);
    const x = this.v.getBigUint64(this.o, true);
    this.o += 8;
    return x;
  }
  u128(): bigint {
    const lo = this.u64();
    const hi = this.u64();
    return (hi << BigInt(64)) | lo;
  }
  u32(): number {
    this.need(4);
    const x = this.v.getUint32(this.o, true);
    this.o += 4;
    return x;
  }
  bool(): boolean {
    this.need(1);
    return this.b[this.o++] !== 0;
  }
  str(): string {
    const n = this.u32();
    if (n > MAX_STRING) throw new RangeError("string too long");
    this.need(n);
    const s = new TextDecoder("utf-8", { fatal: false }).decode(this.b.subarray(this.o, this.o + n));
    this.o += n;
    return s;
  }
}

function scaled(v: bigint, scale: number): string | null {
  if (v <= BigInt(0)) return null;
  const n = Number(v) / scale;
  return Number.isFinite(n) && n <= 1 ? String(Number(n.toFixed(9))) : null;
}

export function formatUsdcBase(base: string): string {
  const v = BigInt(base || "0");
  const d = BigInt(10 ** USDC_DECIMALS);
  const frac = (v % d).toString().padStart(USDC_DECIMALS, "0");
  return `${v / d}.${frac}`;
}

/** Decode one `Event` account. null when it is not an Event or fails a bounds check. */
export function decodeEventAccount(marketId: string, data: Uint8Array): ChainEvent | null {
  if (data.length < 400) return null;
  for (let i = 0; i < 8; i++) if (data[i] !== EVENT_DISCRIMINATOR[i]) return null;
  try {
    const r = new Reader(data);
    r.skip(8 + 32); // discriminator, creator
    const startTime = r.i64();
    const endTime = r.i64();
    const resolutionTime = r.i64();
    const createdAt = r.i64();
    const resolvedAt = r.i64();
    const cancelledAt = r.i64();
    r.u128(); // total_yes_shares
    r.u128(); // total_no_shares
    r.u128(); // virtual_sol_reserves
    r.u128(); // virtual_yes_shares
    const lastYes = r.u128();
    const totalVolume = r.u128();
    r.u128(); // total_yes_volume
    r.u128(); // total_no_volume
    const totalTrades = r.u64();
    for (let i = 0; i < 5; i++) r.u128(); // revenue, creator fees, protocol fees, primary pool, graduation threshold
    r.i64(); // claimable_at
    r.u128(); // creator_seed_lamports
    const question = r.str().trim();
    const resolutionRule = r.str().trim();
    const nSources = r.u32();
    if (nSources > 32) return null;
    const sources: string[] = [];
    for (let i = 0; i < nSources; i++) sources.push(r.str().trim());
    const activeVolume = r.u128();
    r.skip(3); // bump, vault_bump, creator_fee_vault_bump
    const isActive = r.bool();
    const isGraduated = r.bool();
    const isResolved = r.bool();
    const isCancelled = r.bool();
    const yesWins = r.bool();
    r.bool(); // is_whitelisted_creator
    r.skip(3); // pending_review, cancel_reason, market_type (unit enums)
    r.i64(); // flash_acquisition_end
    r.bool(); // event_in_progress
    const primaryPhaseEndTime = r.i64();
    return {
      marketId,
      question,
      resolutionRule,
      oracle: sources.filter(Boolean).join(", "),
      startTime,
      endTime,
      resolutionTime,
      createdAt,
      resolvedAt,
      cancelledAt,
      primaryPhaseEndTime: primaryPhaseEndTime > 0 ? primaryPhaseEndTime : null,
      lastYesPrice: scaled(lastYes, PRICE_SCALE),
      totalVolumeBase: totalVolume.toString(),
      activeVolumeBase: activeVolume.toString(),
      totalTrades: Number(totalTrades),
      isActive,
      isGraduated,
      isResolved,
      isCancelled,
      yesWins,
    };
  } catch {
    return null;
  }
}
