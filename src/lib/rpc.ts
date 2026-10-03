/**
 * Solana RPC endpoints.
 *
 * Browser: always the same-origin relay `${origin}/api/rpc` (see
 * src/app/api/rpc/route.ts + src/lib/rpc-relay.ts). The provider URL and its
 * API key live only in the server env var SOLANA_RPC_URL, so nothing about the
 * provider reaches the client bundle or the CSP. The relay accepts
 * NEXT_PUBLIC_DEFAULT_RPC as its upstream outside production (local dev only);
 * the browser never reads it.
 *
 * PUBLIC_MAINNET_RPC is used only by server-side discovery reads
 * (catalog-server) when no private RPC is configured — never by the relay.
 */
export const PUBLIC_MAINNET_RPC = "https://api.mainnet-beta.solana.com";
export const RPC_RELAY_PATH = "/api/rpc";

/** Absolute relay URL for web3.js Connection (it rejects relative URLs). */
export function clientRpcEndpoint(origin: string): string {
  return `${origin.replace(/\/+$/, "")}${RPC_RELAY_PATH}`;
}

/** Server-side RPC for discovery reads: private env first, public last. */
export function serverRpcUrl(env: Record<string, string | undefined> = process.env): string {
  return env.PANTA_DISCOVERY_RPC_URL?.trim() || env.SOLANA_RPC_URL?.trim() || PUBLIC_MAINNET_RPC;
}
