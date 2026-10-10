import "server-only";

/**
 * Fresh read of ONE Panta `Event` account (the market's on-chain record) by
 * its address = Panta marketId. Used where a decision must rest on the chain
 * itself rather than a cached list: the forecast window (writes) and arena
 * finalization (resolution evidence).
 *
 *  - one JSON-RPC getAccountInfo (commitment "confirmed"), bounded timeout;
 *  - the account must be owned by the Panta program and carry the Event
 *    discriminator, or it is "not_found" (never guessed);
 *  - concurrent callers for the same market share one in-flight request
 *    (no result caching here: every new call after it settles reads again);
 *  - returns the context slot so callers can record provenance.
 *
 * Node's fetch (undici) keeps a per-origin keep-alive pool, so repeated reads
 * reuse the TLS connection to the RPC endpoint.
 */

import { serverRpcUrl } from "@/lib/rpc";
import { PANTA_PROGRAM_ID, decodeEventAccount, type ChainEvent } from "./chain-events";

export const CHAIN_READ_TIMEOUT_MS = 3_000;

export type ChainEventRead =
  | { status: "ok"; event: ChainEvent; slot: number; fetchedAt: number }
  | { status: "not_found"; slot: number | null; fetchedAt: number }
  | { status: "failed"; error: string; fetchedAt: number };

type RpcAccountReply = {
  result?: { context?: { slot?: number }; value: { owner: string; data: [string, string] } | null };
  error?: { message?: string };
};

const BASE58_32 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Pure: interpret a getAccountInfo reply (exported for tests). */
export function interpretEventAccountReply(marketId: string, json: RpcAccountReply, fetchedAt: number): ChainEventRead {
  if (!json || typeof json !== "object" || !json.result) {
    return { status: "failed", error: (json?.error?.message || "RPC returned no result").slice(0, 120), fetchedAt };
  }
  const slot = typeof json.result.context?.slot === "number" ? json.result.context.slot : null;
  const v = json.result.value;
  if (!v) return { status: "not_found", slot, fetchedAt };
  if (v.owner !== PANTA_PROGRAM_ID || !Array.isArray(v.data) || v.data[1] !== "base64") return { status: "not_found", slot, fetchedAt };
  const event = decodeEventAccount(marketId, Buffer.from(v.data[0], "base64"));
  if (!event) return { status: "not_found", slot, fetchedAt };
  if (slot === null) return { status: "failed", error: "RPC reply had no context slot", fetchedAt };
  return { status: "ok", event, slot, fetchedAt };
}

async function readOnce(marketId: string, timeoutMs: number): Promise<ChainEventRead> {
  const started = Date.now();
  try {
    const res = await fetch(serverRpcUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAccountInfo",
        params: [marketId, { encoding: "base64", commitment: "confirmed" }],
      }),
    });
    if (!res.ok) return { status: "failed", error: `RPC HTTP ${res.status}`, fetchedAt: started };
    return interpretEventAccountReply(marketId, (await res.json()) as RpcAccountReply, started);
  } catch (e) {
    return { status: "failed", error: e instanceof Error && e.name === "TimeoutError" ? "RPC timed out" : "RPC unreachable", fetchedAt: started };
  }
}

const inflight = new Map<string, Promise<ChainEventRead>>();

/**
 * Event account read that never joins another caller's request: every call
 * issues its own RPC request (used to authorise forecast writes, so the
 * deciding read always starts after the write arrived). Never throws.
 */
export function readEventAccountFresh(marketId: string, timeoutMs = CHAIN_READ_TIMEOUT_MS): Promise<ChainEventRead> {
  if (!BASE58_32.test(marketId)) return Promise.resolve({ status: "not_found", slot: null, fetchedAt: Date.now() });
  return readOnce(marketId, timeoutMs);
}

/** Fresh Event account read for page views; concurrent calls for one market share a request. Never throws. */
export function readEventAccount(marketId: string, timeoutMs = CHAIN_READ_TIMEOUT_MS): Promise<ChainEventRead> {
  if (!BASE58_32.test(marketId)) return Promise.resolve({ status: "not_found", slot: null, fetchedAt: Date.now() });
  const hit = inflight.get(marketId);
  if (hit) return hit;
  const p = readOnce(marketId, timeoutMs).finally(() => inflight.delete(marketId));
  inflight.set(marketId, p);
  return p;
}
