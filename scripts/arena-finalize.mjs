#!/usr/bin/env node
/**
 * Arena finalization CLI: calls the protected POST /api/arena/finalize on a
 * running Brief Command server (the finalization service runs inside the app
 * so both storage adapters and the same evidence checks are used).
 *
 *   ROOMS_ADMIN_TOKEN=... npm run arena:finalize -- --market <marketId>
 *   ROOMS_ADMIN_TOKEN=... npm run arena:finalize -- --room <slug>
 *   ROOMS_ADMIN_TOKEN=... npm run arena:finalize -- --pending [--limit 10]
 *   options: --url http://localhost:3100 (default; or ARENA_BASE_URL)
 *
 * The token is read from the environment only (never a flag, never printed).
 * One run = one request; there is no polling loop.
 */

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const usage = () => {
  console.error("usage: npm run arena:finalize -- (--market <id> | --room <slug> | --pending [--limit N]) [--url <base>]");
  process.exit(2);
};

const token = (process.env.ROOMS_ADMIN_TOKEN || "").trim();
if (!token) {
  console.error("ROOMS_ADMIN_TOKEN is not set in the environment.");
  process.exit(2);
}
const base = (opt("url") || process.env.ARENA_BASE_URL || "http://localhost:3100").replace(/\/+$/, "");
let body;
if (opt("market")) body = { marketId: opt("market") };
else if (opt("room")) body = { roomSlug: opt("room") };
else if (args.includes("--pending")) body = opt("limit") ? { pending: true, limit: Number(opt("limit")) } : { pending: true };
else usage();

let res;
try {
  res = await fetch(`${base}/api/arena/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
} catch (e) {
  console.error(`Couldn't reach ${base}: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
const text = await res.text();
let json;
try {
  json = JSON.parse(text);
} catch {
  json = { raw: text.slice(0, 500) };
}
if (!res.ok) {
  console.error(`HTTP ${res.status}`, JSON.stringify(json, null, 2));
  process.exit(1);
}
for (const r of json.reports ?? []) {
  console.log(`${r.marketId}  ${r.result}  ${r.message}${r.scoresWritten !== undefined ? `  (scores ${r.scoresWritten}, global ${r.globalScoresWritten})` : ""}`);
}
if (args.includes("--json")) console.log(JSON.stringify(json, null, 2));
