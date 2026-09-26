import type { NextConfig } from "next";

/**
 * Bundler: webpack, forced by `next dev --webpack` / `next build --webpack`
 * in package.json. No `turbopack` block is kept because nothing runs on it.
 *
 * Why webpack is still forced: the wallet stack (@solana/web3.js,
 * wallet-adapter, Phantom/Solflare adapters) and the whole quote → build →
 * pre-sign check → sign → broadcast → confirm path were exercised end to end
 * on webpack builds. Turbopack also compiles and renders every route on Next
 * 16.3.4 (checked in the batch-3 audit), but the wallet signing path has not
 * been run on it yet, so production stays on the tested bundler until it has.
 *
 * Browser fallbacks: this config used to set `resolve.fallback`
 * { fs, net, tls: false } and externalise `pino-pretty` / `encoding`, the
 * usual shims for WalletConnect/pino-based wallet kits that pull Node
 * built-ins into the browser bundle. This app ships only the Phantom and
 * Solflare adapters (no WalletConnect or pino in the dependency tree), Next
 * already stubs Node built-ins for client bundles, and `next build --webpack`
 * produces the same routes with zero warnings without them, so they were
 * removed as dead config. If a wallet kit that needs them is added later,
 * restore them here.
 *
 * Server-only code (src/lib/panta/server.ts, sanitize.ts, brief.ts) imports
 * `server-only`, so an accidental client import fails the build.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
