/**
 * Server-side Solana JSON-RPC relay (POST /api/rpc).
 *
 * The browser's Connection points at `${origin}/api/rpc`; this module
 * forwards to the private SOLANA_RPC_URL (e.g. a Helius URL with its API key),
 * so the provider key never reaches the client bundle, the CSP or the network
 * tab. No public-RPC fallback: unset SOLANA_RPC_URL → 503 RPC_NOT_CONFIGURED
 * (outside production, NEXT_PUBLIC_DEFAULT_RPC is accepted for local dev).
 *
 * Methods: only the JSON-RPC calls the client actually makes (web3.js 1.x
 * method → RPC name), derived from the code:
 *  - getGenesisHash             network.ts checkMainnet (before build + sign)
 *  - getLatestBlockhash         solana.ts resolveLastValidBlockHeight
 *  - sendTransaction            Connection.sendRawTransaction (Book claims,
 *                               primary buy); preflight runs inside it
 *  - getSignatureStatuses       solana.ts confirmSignature / checkSignatureOnce
 *  - getBlockHeight             solana.ts blockhash-expiry check
 *  - getAccountInfo             vault-authority / creator-fee-vault checks
 *  - getTokenAccountsByOwner    hooks.ts useUsdcBalance (jsonParsed)
 * Wallet adapters (Phantom, Solflare) only use signTransaction here: they
 * make no Connection calls, and confirmation is HTTP polling (no websocket).
 */

export const RPC_METHODS = new Set([
  "getGenesisHash",
  "getLatestBlockhash",
  "sendTransaction",
  "getSignatureStatuses",
  "getBlockHeight",
  "getAccountInfo",
  "getTokenAccountsByOwner",
]);

export const RPC_MAX_BATCH = 10;
export const RPC_MAX_BODY_BYTES = 32 * 1024;
export const RPC_UPSTREAM_TIMEOUT_MS = 10_000;
/**
 * Per-IP requests per minute. A trade is ~10 calls plus confirmation polling
 * (≤90 s at one status call every 2 s and a block-height call every 3rd poll
 * → ~60 calls); a claim the same. 300 leaves room for retries and the
 * balance chip.
 */
export const RPC_RATE_LIMIT = 300;

export type RpcUpstream = { url: string } | { error: "RPC_NOT_CONFIGURED" };

export function rpcUpstream(env: Record<string, string | undefined> = process.env): RpcUpstream {
  const v = env.SOLANA_RPC_URL?.trim() || (env.NODE_ENV !== "production" ? env.NEXT_PUBLIC_DEFAULT_RPC?.trim() : "");
  if (!v) return { error: "RPC_NOT_CONFIGURED" };
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" && u.protocol !== "http:") return { error: "RPC_NOT_CONFIGURED" };
  } catch {
    return { error: "RPC_NOT_CONFIGURED" };
  }
  return { url: v };
}

type Id = string | number | null;
export type RpcCall = { jsonrpc: "2.0"; id: Id; method: string; params?: unknown[] | Record<string, unknown> };

export type ParsedBody =
  | { ok: true; calls: RpcCall[]; batch: boolean }
  | { ok: false; status: number; code: number; message: string; id: Id };

function validCall(v: unknown): v is RpcCall {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const c = v as Record<string, unknown>;
  const idOk = c.id === undefined || c.id === null || typeof c.id === "string" || typeof c.id === "number";
  const paramsOk = c.params === undefined || Array.isArray(c.params) || (typeof c.params === "object" && c.params !== null);
  return c.jsonrpc === "2.0" && typeof c.method === "string" && c.method.length <= 64 && idOk && paramsOk;
}

/** Shape + method allowlist + batch cap. Errors are JSON-RPC style. */
export function parseRpcBody(raw: unknown): ParsedBody {
  const batch = Array.isArray(raw);
  const list = batch ? (raw as unknown[]) : [raw];
  const rawId = !batch && raw && typeof raw === "object" ? (raw as { id?: unknown }).id : null;
  const firstId: Id = typeof rawId === "string" || typeof rawId === "number" ? rawId : null;
  if (list.length === 0) return { ok: false, status: 400, code: -32600, message: "Empty batch", id: null };
  if (list.length > RPC_MAX_BATCH) {
    return { ok: false, status: 400, code: -32600, message: `Batch too large (max ${RPC_MAX_BATCH})`, id: null };
  }
  for (const c of list) {
    if (!validCall(c)) return { ok: false, status: 400, code: -32600, message: "Invalid request", id: firstId };
    if (!RPC_METHODS.has(c.method)) {
      return { ok: false, status: 403, code: -32601, message: `Method not allowed: ${c.method.replace(/[^A-Za-z0-9_]/g, "").slice(0, 40)}`, id: c.id ?? null };
    }
  }
  return { ok: true, calls: list as RpcCall[], batch };
}

/**
 * Remove anything identifying the upstream (full URL, host, query values such
 * as api-key) from a text before it is returned to the browser.
 */
export function redactUpstream(text: string, upstreamUrl: string): string {
  let out = text;
  const needles = new Set<string>([upstreamUrl]);
  try {
    const u = new URL(upstreamUrl);
    needles.add(u.host);
    needles.add(u.hostname);
    for (const [, v] of u.searchParams) if (v.length >= 6) needles.add(v);
    if (u.pathname.length > 8) needles.add(u.pathname);
    if (u.username) needles.add(u.username);
    if (u.password) needles.add(u.password);
  } catch {
    /* unparseable: only the raw string */
  }
  for (const n of [...needles].sort((a, b) => b.length - a.length)) {
    if (n) out = out.split(n).join("[rpc]");
  }
  return out.replace(/api[-_]?key=[^&"\s]*/gi, "api-key=[redacted]");
}

export function rpcError(id: Id, code: number, message: string) {
  return { jsonrpc: "2.0" as const, id, error: { code, message } };
}
