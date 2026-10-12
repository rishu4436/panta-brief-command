/**
 * Tests never reach the network. Outbound fetch to anything but loopback
 * rejects immediately (a fast, deterministic "upstream down"), so no test can
 * pass or fail because of live Panta / Solana data or availability. Tests that
 * need upstream data stub it (vi.stubGlobal("fetch", ...), injected sources or
 * the module's __set…ForTests hooks), which replaces this default.
 *
 * Exception: the opt-in live Upstash run (PHASE8_LIVE_UPSTASH=1, see
 * test/helpers/isolated-redis.ts) may reach *.upstash.io and nothing else.
 */
const realFetch = globalThis.fetch;
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const liveUpstash = process.env.PHASE8_LIVE_UPSTASH === "1";

export const BLOCKED_NETWORK_MESSAGE = "network access is disabled in tests";

globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  let host = "";
  try {
    host = new URL(url).host;
  } catch {
    return realFetch(input, init);
  }
  if (LOOPBACK.test(host) || (liveUpstash && host.endsWith(".upstash.io"))) return realFetch(input, init);
  return Promise.reject(new TypeError(`${BLOCKED_NETWORK_MESSAGE}: ${host}`));
}) as typeof fetch;
