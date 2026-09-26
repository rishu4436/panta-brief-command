/**
 * Solana RPC endpoint. Set NEXT_PUBLIC_DEFAULT_RPC to a dedicated provider
 * (Helius, QuickNode, Triton, Alchemy, …). The public mainnet endpoint is only
 * a fallback: it is heavily rate-limited and can drop sends/confirmations.
 */
export const PUBLIC_MAINNET_RPC = "https://api.mainnet-beta.solana.com";

export function resolveRpc(env: string | undefined = process.env.NEXT_PUBLIC_DEFAULT_RPC): {
  endpoint: string;
  isFallback: boolean;
} {
  const v = env?.trim();
  return v ? { endpoint: v, isFallback: false } : { endpoint: PUBLIC_MAINNET_RPC, isFallback: true };
}
