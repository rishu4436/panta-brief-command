/**
 * Explicit allowlist for the browser → /api/panta/* proxy.
 *
 * Every entry below corresponds to a real `pantaFetch()` call in `src/`
 * (grep `pantaFetch` to audit). Anything not listed is refused with
 * 403 ROUTE_NOT_ALLOWED; a listed route with the wrong method gets 405.
 * Do not add routes "just in case" — the server attaches PANTA_API_KEY to
 * every forwarded request, so each entry is capability exposed to the public.
 */

export type ProxyMethod = "GET" | "POST";

export type ProxyRoute = {
  id: string;
  /** Matched against the normalized path (segments joined by "/", no slashes at ends). */
  pattern: RegExp;
  methods: readonly ProxyMethod[];
  /** Query keys forwarded upstream (others are dropped). */
  query?: readonly string[];
  /** Forward a validated X-User-Id header (attribution flow only). */
  forwardUserId?: boolean;
};

/** Solana base58 public key (32–44 chars, no 0/O/I/l). */
export const BASE58_PUBKEY = "[1-9A-HJ-NP-Za-km-z]{32,44}";
export const BASE58_PUBKEY_RE = new RegExp(`^${BASE58_PUBKEY}$`);

export const PROXY_ROUTES: readonly ProxyRoute[] = [
  // MarketList, LiveStrip, CommandPalette, PrimaryBuyPanel picker
  {
    id: "markets.list",
    pattern: /^markets$/,
    methods: ["GET"],
    query: ["category", "status", "limit", "cursor"],
  },
  // MarketDetail, MarketList/PrimaryBuyPanel title hydration, BookPanel marks
  {
    id: "markets.detail",
    pattern: new RegExp(`^markets/${BASE58_PUBKEY}$`),
    methods: ["GET"],
  },
  // MarketDetail tape, HotTapeRail
  {
    id: "markets.trades",
    pattern: new RegExp(`^markets/${BASE58_PUBKEY}/trades$`),
    methods: ["GET"],
    query: ["limit"],
  },
  // MarketList category chips
  { id: "categories", pattern: /^categories$/, methods: ["GET"] },
  // BookPanel
  { id: "positions", pattern: /^positions$/, methods: ["GET"], query: ["wallet"] },
  // AttributedTrades + post-attribution ledger check
  {
    id: "account.trades",
    pattern: /^account\/trades$/,
    methods: ["GET"],
    query: ["limit", "kind"],
  },
  // PrimaryBuyPanel execution lifecycle
  { id: "primary.quote", pattern: /^primaryorderquote$/, methods: ["POST"], forwardUserId: true },
  { id: "primary.build", pattern: /^primaryorderbuild$/, methods: ["POST"], forwardUserId: true },
  { id: "primary.submit", pattern: /^primaryordersubmit$/, methods: ["POST"] },
  { id: "primary.verify", pattern: /^primaryorderverify$/, methods: ["POST"] },
  // Attribution report (PrimaryBuyPanel buys, BookPanel win claims)
  { id: "trades.report", pattern: /^trades$/, methods: ["POST"], forwardUserId: true },
  // BookPanel claims
  { id: "claim.win.build", pattern: /^claim\/build$/, methods: ["POST"] },
  {
    id: "claim.creatorFees.build",
    pattern: /^claim\/creator-fees\/build$/,
    methods: ["POST"],
  },
];

export function matchProxyRoute(path: string): ProxyRoute | null {
  for (const r of PROXY_ROUTES) {
    if (r.pattern.test(path)) return r;
  }
  return null;
}

/**
 * Attribution reference (Panta `userId` / `X-User-Id`). User-supplied metadata,
 * not an authenticated identity. Shared by client validation and the proxy.
 */
export const ATTRIBUTION_REF_MAX = 64;
export const ATTRIBUTION_REF_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

export function isValidAttributionRef(v: string): boolean {
  return ATTRIBUTION_REF_RE.test(v);
}
