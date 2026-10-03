/**
 * Solana cluster check for the configured RPC, run before any Panta build
 * and again before signing.
 *
 * Panta's markets live on mainnet-beta: the program 6gM5afTQ…, the USDC mint
 * EPjFWdd5… and every decoded order were mainnet (3 Oct 2026). The browser
 * asks through the /api/rpc relay, so this verifies the relay's private
 * upstream (SOLANA_RPC_URL) end to end. A devnet/testnet/local RPC would let the app
 * fetch a blockhash, broadcast and "confirm" against the wrong chain.
 *
 * Policy:
 *  - genesis ≠ mainnet → fail closed with a clear message (wrong network);
 *  - the getGenesisHash call itself fails/times out → also fail closed
 *    ("couldn't confirm"), because the same RPC is needed next for the
 *    blockhash, broadcast and confirmation; if it can't answer this cheap
 *    call, signing would fail or be unverifiable anyway. The user can retry.
 *  - only a successful match is cached (per endpoint, for the page's
 *    lifetime: a genesis hash never changes); failures are retried next time.
 */

export const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const TESTNET_GENESIS_HASH = "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY";
export const GENESIS_CHECK_TIMEOUT_MS = 8_000;

const KNOWN: Record<string, string> = {
  [DEVNET_GENESIS_HASH]: "devnet",
  [TESTNET_GENESIS_HASH]: "testnet",
};

export type NetworkCheck =
  | { ok: true }
  | { ok: false; kind: "wrong_network" | "check_failed"; message: string };

type GenesisSource = { rpcEndpoint: string; getGenesisHash(): Promise<string> };

const verified = new Set<string>();

export async function checkMainnet(conn: GenesisSource, timeoutMs = GENESIS_CHECK_TIMEOUT_MS): Promise<NetworkCheck> {
  if (verified.has(conn.rpcEndpoint)) return { ok: true };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let hash: string;
  try {
    hash = await Promise.race([
      conn.getGenesisHash(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer in ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
      }),
    ]);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      kind: "check_failed",
      message: `Couldn't confirm the Solana RPC is on mainnet (${why.slice(0, 120)}). Nothing was built or signed; try again.`,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (hash === MAINNET_GENESIS_HASH) {
    verified.add(conn.rpcEndpoint);
    return { ok: true };
  }
  const name = KNOWN[hash] ?? "an unknown network";
  return {
    ok: false,
    kind: "wrong_network",
    message: `The configured Solana RPC is on ${name}, not mainnet-beta, where Panta markets live. Signing blocked.`,
  };
}

/** Throws the check's message when the RPC isn't verifiably mainnet. */
export async function assertMainnet(conn: GenesisSource): Promise<void> {
  const r = await checkMainnet(conn);
  if (!r.ok) throw new Error(r.message);
}

/** Tests only. */
export function __resetNetworkCheckForTests() {
  verified.clear();
}
