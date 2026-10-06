/**
 * Minimal JSON-RPC call through the same-origin relay (/api/rpc), used for
 * simulateTransaction with the exact parameter shape the relay allows
 * (rpc-relay.ts checkSimulateParams). Returns `result`; throws on any
 * transport or RPC error so the caller fails closed.
 */
export async function rawRpc(endpoint: string, method: string, params: unknown, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const res = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  if (!json || typeof json !== "object") throw new Error("RPC returned no JSON");
  const j = json as { result?: unknown; error?: { message?: unknown } };
  if (j.error) throw new Error(typeof j.error.message === "string" ? j.error.message.slice(0, 160) : "RPC error");
  if (!("result" in j)) throw new Error("RPC returned no result");
  return j.result;
}
