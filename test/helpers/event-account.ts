/**
 * Builds Panta `Event` account bytes in the on-chain layout decoded by
 * src/lib/panta/chain-events.ts (stable prefix only), for tests.
 */
import { EVENT_DISCRIMINATOR, PANTA_PROGRAM_ID } from "@/lib/panta/chain-events";

export type EventOpts = {
  nowSec?: number;
  start?: number;
  end?: number;
  resolution?: number;
  primaryPhaseEnd?: number;
  resolvedAt?: number;
  active?: boolean;
  graduated?: boolean;
  resolved?: boolean;
  cancelled?: boolean;
  yesWins?: boolean;
  question?: string;
};

export function eventAccountBytes(o: EventOpts = {}): Buffer {
  const now = o.nowSec ?? Math.floor(Date.now() / 1000);
  const parts: Buffer[] = [];
  const i64 = (n: number) => {
    const b = Buffer.alloc(8);
    b.writeBigInt64LE(BigInt(n));
    parts.push(b);
  };
  const u64 = (n: bigint) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(n);
    parts.push(b);
  };
  const u128 = (n: bigint) => {
    u64(n & ((BigInt(1) << BigInt(64)) - BigInt(1)));
    u64(n >> BigInt(64));
  };
  const str = (s: string) => {
    const body = Buffer.from(s, "utf8");
    const len = Buffer.alloc(4);
    len.writeUInt32LE(body.length);
    parts.push(len, body);
  };
  const u8 = (n: number) => parts.push(Buffer.from([n]));
  parts.push(Buffer.from(EVENT_DISCRIMINATOR), Buffer.alloc(32, 7));
  i64(o.start ?? now - 100);
  i64(o.end ?? now + 86_400);
  i64(o.resolution ?? (o.end ?? now + 86_400) + 3600);
  i64(now - 1000);
  i64(o.resolvedAt ?? 0);
  i64(0);
  for (let i = 0; i < 4; i++) u128(BigInt(1));
  u128(BigInt(500_000_000));
  u128(BigInt(12_000_000));
  u128(BigInt(0));
  u128(BigInt(0));
  u64(BigInt(5));
  for (let i = 0; i < 5; i++) u128(BigInt(0));
  i64(0);
  u128(BigInt(0));
  str(o.question ?? "Will Haaland score 8+ points in GW6?");
  str("Resolves YES if FPL reports 8 or more points.");
  const n = Buffer.alloc(4);
  n.writeUInt32LE(1);
  parts.push(n);
  str("https://fantasy.premierleague.com/");
  u128(BigInt(7_000_000));
  u8(253);
  u8(255);
  u8(254);
  u8(o.active === false ? 0 : 1);
  u8(o.graduated ? 1 : 0);
  u8(o.resolved ? 1 : 0);
  u8(o.cancelled ? 1 : 0);
  u8(o.yesWins ? 1 : 0);
  u8(0);
  u8(0);
  u8(0);
  u8(0);
  i64(0);
  u8(0);
  i64(o.primaryPhaseEnd ?? now + 3600);
  parts.push(Buffer.alloc(2600)); // the rest of the account (not decoded)
  return Buffer.concat(parts);
}

/** A getAccountInfo JSON-RPC reply carrying that account. */
export function accountInfoReply(o: EventOpts = {}, slot = 455_000_000, owner = PANTA_PROGRAM_ID) {
  return { jsonrpc: "2.0", id: 1, result: { context: { slot }, value: { owner, data: [eventAccountBytes(o).toString("base64"), "base64"] as [string, string] } } };
}
