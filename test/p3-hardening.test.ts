/**
 * P3 pass: quote-expiry copy, mainnet genesis check, admin no-store,
 * CSP/anti-framing headers, clientIp trust order, Activity scope, brief
 * Observation / Evidence / Interpretation sections.
 */
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkMainnet,
  DEVNET_GENESIS_HASH,
  MAINNET_GENESIS_HASH,
  TESTNET_GENESIS_HASH,
  __resetNetworkCheckForTests,
} from "@/lib/network";
import { QUOTE_EXPIRY_MARGIN_MS, QUOTE_FALLBACK_NOTE, quoteExpiryNote } from "@/lib/trade-state";
import { QuoteSummary } from "@/components/trade/TicketParts";
import { buildCsp, securityHeaders } from "@/lib/security-headers";
import { clientIp } from "@/lib/rate-limit";
import { activityScopeNote, scopeActivity, walletTag } from "@/lib/activity-scope";
import { BRIEF_SECTION_HEADERS, briefSection, briefSectionLayer, TEMPLATE_INTERPRETATION } from "@/lib/brief-sections";
import { BriefMarkdown } from "@/components/BriefMarkdown";
import { SAMPLE_MARKET, SAMPLE_NARRATIVE, SAMPLE_SIGNALS } from "@/components/landing/sample";

// ---------------------------------------------------------------- #2 quote expiry copy
describe("quote expiry copy comes from Panta's expiresAt", () => {
  const received = Date.parse("2026-10-03T05:28:14Z");
  it("states Panta's expiry time (IST), the real lifetime and the margin; no hardcoded ~90s", () => {
    const note = quoteExpiryNote("2026-10-03T05:30:33Z", received); // live quote: 139 s
    expect(note).toBe(`Panta set this quote to expire at 11:00:33 IST (139 s after it arrived); the ticket stops ${QUOTE_EXPIRY_MARGIN_MS / 1000} s early.`);
    expect(note).not.toMatch(/90/);
  });
  it("without expiresAt: the conservative fallback, stated as an assumption", () => {
    expect(quoteExpiryNote(null, received)).toBe(QUOTE_FALLBACK_NOTE);
    expect(quoteExpiryNote("not a date", received)).toBe(QUOTE_FALLBACK_NOTE);
    expect(QUOTE_FALLBACK_NOTE).not.toMatch(/90/);
  });
  it("the ticket renders the derived note", () => {
    const q = { amountUsdc: "1.00", shares: "2.01", side: "no" as const, avgPrice: "0.49", feeUsdc: "0.02" };
    const html = renderToStaticMarkup(
      createElement(QuoteSummary, { quote: q, slippageBps: 100, secondsLeft: 100, totalSeconds: 134, ttlSource: "panta", expiryNote: quoteExpiryNote("2026-10-03T05:30:33Z", received) }),
    );
    expect(html).toContain("11:00:33 IST");
    expect(html).not.toMatch(/~90/);
  });
  it("brief execution lines no longer claim fixed TTLs", () => {
    expect(SAMPLE_SIGNALS.execution.lines.join(" ")).not.toMatch(/~90s|~120s/);
    expect(SAMPLE_SIGNALS.execution.lines.join(" ")).toMatch(/expiresAt/);
  });
});

// ---------------------------------------------------------------- #3 mainnet genesis
describe("Solana network check (genesis hash)", () => {
  beforeEach(() => __resetNetworkCheckForTests());
  const conn = (impl: () => Promise<string>, rpcEndpoint = "https://rpc.example") => ({ rpcEndpoint, getGenesisHash: vi.fn(impl) });

  it("mainnet-beta passes and is cached per endpoint", async () => {
    const c = conn(async () => MAINNET_GENESIS_HASH);
    expect(await checkMainnet(c)).toEqual({ ok: true });
    expect(await checkMainnet(c)).toEqual({ ok: true });
    expect(c.getGenesisHash).toHaveBeenCalledTimes(1);
  });
  it("devnet / testnet / unknown genesis fail closed with a clear message", async () => {
    const d = await checkMainnet(conn(async () => DEVNET_GENESIS_HASH, "https://d"));
    expect(d).toMatchObject({ ok: false, kind: "wrong_network" });
    expect(!d.ok && d.message).toMatch(/devnet, not mainnet-beta.*Signing blocked/);
    expect(await checkMainnet(conn(async () => TESTNET_GENESIS_HASH, "https://t"))).toMatchObject({ ok: false, kind: "wrong_network" });
    const u = await checkMainnet(conn(async () => "1111", "https://u"));
    expect(!u.ok && u.message).toMatch(/unknown network/);
  });
  it("RPC error fails closed (check_failed) and is NOT cached, so a retry can pass", async () => {
    let fail = true;
    const c = conn(async () => {
      if (fail) throw new Error("429 Too Many Requests");
      return MAINNET_GENESIS_HASH;
    });
    const r = await checkMainnet(c);
    expect(r).toMatchObject({ ok: false, kind: "check_failed" });
    expect(!r.ok && r.message).toMatch(/Couldn't confirm.*mainnet.*Nothing was built or signed/);
    fail = false;
    expect(await checkMainnet(c)).toEqual({ ok: true });
  });
  it("a hanging RPC times out instead of blocking forever", async () => {
    const t0 = Date.now();
    const r = await checkMainnet(conn(() => new Promise<string>(() => {}), "https://hang"), 50);
    expect(r).toMatchObject({ ok: false, kind: "check_failed" });
    expect(Date.now() - t0).toBeLessThan(1000);
  });
  it("the build and sign paths call it (primary buy and claim)", () => {
    const buy = readFileSync("src/components/PrimaryBuyPanel.tsx", "utf8");
    const claim = readFileSync("src/components/BookPanel.tsx", "utf8");
    expect(buy.match(/await checkMainnet\(connection\)/g)?.length).toBe(2);
    expect(buy.indexOf("checkMainnet(connection)")).toBeLessThan(buy.indexOf("await requestBuild("));
    expect(claim.match(/await assertMainnet\(connection\)/g)?.length).toBe(2);
    expect(claim.indexOf("assertMainnet(connection)")).toBeLessThan(claim.indexOf("await buildClaim("));
    expect(claim.lastIndexOf("assertMainnet(connection)")).toBeLessThan(claim.indexOf("await signTransaction(tx)"));
  });
});

// ---------------------------------------------------------------- #4 admin no-store
describe("admin export: every response is no-store", () => {
  const SECRET = "s3cret-for-tests-0123456789abcdef";
  const get = (q: string, auth?: string) =>
    new NextRequest(`http://localhost/api/admin/export${q}`, { headers: auth ? { authorization: auth } : {} });
  beforeEach(() => {
    vi.stubEnv("EVIDENCE_LOG_DIR", mkdtempSync(path.join(os.tmpdir(), "pbc-admin-")));
    vi.stubEnv("ADMIN_EXPORT_SECRET", SECRET);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@/lib/evidence/store");
    vi.resetModules();
  });
  async function GET() {
    vi.resetModules();
    (await import("@/lib/shared-store")).__setSharedStoreForTests(null);
    return (await import("@/app/api/admin/export/route")).GET;
  }
  it("401, 400, 200 and disabled-404 all carry Cache-Control: no-store", async () => {
    const h = await GET();
    const r401 = await h(get("?kind=summary", "Bearer nope"));
    const r400 = await h(get("?kind=bogus", `Bearer ${SECRET}`));
    const r200 = await h(get("?kind=diagnostics", `Bearer ${SECRET}`));
    for (const [r, st] of [[r401, 401], [r400, 400], [r200, 200]] as const) {
      expect(r.status).toBe(st);
      expect(r.headers.get("cache-control")).toBe("no-store");
      expect(r.headers.get("x-robots-tag")).toBe("noindex");
    }
    vi.stubEnv("ADMIN_EXPORT_SECRET", "");
    const r404 = await h(get("?kind=summary", `Bearer ${SECRET}`));
    expect(r404.status).toBe(404);
    expect(r404.headers.get("cache-control")).toBe("no-store");
  });
  it("an unexpected failure is a no-store 500 without details", async () => {
    vi.resetModules();
    vi.doMock("@/lib/evidence/store", () => ({ readEvidence: async () => { throw new Error("disk exploded at /secret/path"); } }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET: h } = await import("@/app/api/admin/export/route");
    const r = await h(get("?kind=feedback", `Bearer ${SECRET}`));
    expect(r.status).toBe(500);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(await r.json())).not.toContain("/secret/path");
  });
});

// ---------------------------------------------------------------- #5 CSP
describe("CSP + anti-framing", () => {
  const prod = buildCsp();
  const dir = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(name + " ")) ?? "";
  it("forbids framing and plugins; no eval in production", () => {
    expect(dir(prod, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(dir(prod, "object-src")).toBe("object-src 'none'");
    expect(dir(prod, "script-src")).toBe("script-src 'self' 'unsafe-inline'");
    expect(prod).not.toContain("unsafe-eval");
    expect(dir(buildCsp({ dev: true }), "script-src")).toContain("'unsafe-eval'");
  });
  it("connect-src is 'self' + Panta's exact Cloudinary upload path: RPC goes through /api/rpc, no provider host or key", () => {
    // The only non-self entry is the exact signed-upload endpoint Panta's image-upload grants point at
    // (path-pinned, not a host wildcard) — see security-headers.ts and create-rules.ts.
    expect(dir(prod, "connect-src")).toBe("connect-src 'self' https://api.cloudinary.com/v1_1/dyvupboym/image/upload");
    const fromEnv = securityHeaders({ NODE_ENV: "production", NEXT_PUBLIC_DEFAULT_RPC: "https://mainnet.helius-rpc.com/?api-key=abc", SOLANA_RPC_URL: "https://x.example/?api-key=abc" });
    const csp = fromEnv.find((h) => h.key === "Content-Security-Policy")!.value;
    expect(dir(csp, "connect-src")).toBe("connect-src 'self' https://api.cloudinary.com/v1_1/dyvupboym/image/upload");
    expect(csp).not.toMatch(/helius|api-key|mainnet-beta|x\.example/);
  });
  it("wallet + images: Solflare SDK frame allowed, market images from any https host, no third-party styles", () => {
    expect(dir(prod, "frame-src")).toBe("frame-src https://connect.solflare.com");
    expect(dir(prod, "img-src")).toContain("https:");
    expect(dir(prod, "style-src")).toBe("style-src 'self' 'unsafe-inline'");
  });
  it("securityHeaders sends CSP and X-Frame-Options DENY; next.config applies them to every route", async () => {
    const h = securityHeaders({ NODE_ENV: "production", NEXT_PUBLIC_DEFAULT_RPC: "https://api.mainnet-beta.solana.com" });
    expect(h.find((x) => x.key === "X-Frame-Options")?.value).toBe("DENY");
    expect(h.find((x) => x.key === "Content-Security-Policy")?.value).toContain("frame-ancestors 'none'");
    const cfg = (await import("../next.config")).default;
    const rules = await cfg.headers!();
    expect(rules[0].source).toBe("/:path*");
    expect(rules[0].headers.map((x: { key: string }) => x.key)).toEqual(["Content-Security-Policy", "X-Frame-Options"]);
  });
  it("vendored wallet-adapter CSS = upstream minus the Google Fonts @import", () => {
    const upstream = readFileSync("node_modules/@solana/wallet-adapter-react-ui/styles.css", "utf8");
    const vendored = readFileSync("src/styles/wallet-adapter-ui.css", "utf8");
    expect(upstream.split("\n")[0]).toMatch(/^@import url\('https:\/\/fonts\.googleapis\.com/);
    const body = vendored.replace(/^\/\*[\s\S]*?\*\/\n/, ""); // drop the provenance comment
    expect(body).not.toMatch(/@import|googleapis/);
    expect(vendored.endsWith(upstream.split("\n").slice(1).join("\n"))).toBe(true);
  });
});

// ---------------------------------------------------------------- #6 clientIp
describe("clientIp (Vercel trust assumption)", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  it("prefers x-vercel-forwarded-for, then x-forwarded-for (first hop), then x-real-ip", () => {
    expect(clientIp(h({ "x-vercel-forwarded-for": "203.0.113.7", "x-forwarded-for": "198.51.100.1", "x-real-ip": "192.0.2.9" }))).toBe("203.0.113.7");
    expect(clientIp(h({ "x-forwarded-for": "198.51.100.1, 10.0.0.1", "x-real-ip": "192.0.2.9" }))).toBe("198.51.100.1");
    expect(clientIp(h({ "x-real-ip": "192.0.2.9" }))).toBe("192.0.2.9");
    expect(clientIp(h({}))).toBe("unknown");
    expect(clientIp(h({ "x-forwarded-for": " , " , "x-real-ip": "192.0.2.9" }))).toBe("192.0.2.9");
    expect(clientIp(h({ "x-forwarded-for": "x".repeat(200) })).length).toBe(64);
  });
});

// ---------------------------------------------------------------- #7 Activity scope
describe("Activity: app-wide vs my wallet", () => {
  const ME = "4VGFQKGanc5oaLf51mee9m45HmiXRhKruh5mdRaM";
  const rows = [{ wallet: ME, signature: "a" }, { wallet: "OTHER", signature: "b" }, { wallet: null, signature: "c" }];
  it("app scope shows all rows and says they are from all wallets", () => {
    expect(scopeActivity(rows, "app", ME)).toMatchObject({ scope: "app", hidden: 0 });
    expect(activityScopeNote("app", 50, null)).toMatch(/from all wallets, not just yours/);
  });
  it("wallet scope keeps only the connected wallet's rows and says it's a filter of the latest N", () => {
    const r = scopeActivity(rows, "wallet", ME);
    expect(r.rows.map((x) => x.signature)).toEqual(["a"]);
    expect(r).toMatchObject({ scope: "wallet", hidden: 2 });
    expect(activityScopeNote("wallet", 50, "4VGF…RaM")).toMatch(/Your wallet \(4VGF…RaM\) only, filtered from the latest 50 app-wide rows/);
  });
  it("no wallet connected: falls back to the (labelled) app-wide view", () => {
    expect(scopeActivity(rows, "wallet", null)).toMatchObject({ scope: "app", hidden: 0 });
  });
  it("rows are tagged You / Other wallet / Unknown, never with another wallet's address", () => {
    expect(rows.map((r) => walletTag(r.wallet, ME))).toEqual(["you", "other", "unknown"]);
    expect(walletTag(ME, null)).toBe("other");
    const src = readFileSync("src/components/AttributedTrades.tsx", "utf8");
    expect(src).not.toMatch(/shortAddr\(row\.wallet/);
  });
});

// ---------------------------------------------------------------- #8 brief sections
describe("brief: Observation / Evidence / Interpretation are distinct", () => {
  it("sections map to layers", () => {
    expect(BRIEF_SECTION_HEADERS).toEqual(["### Observation", "### Evidence", "### Interpretation", "### Risk", "### Execution considerations"]);
    expect(briefSectionLayer("Observation")).toBe("observed");
    expect(briefSectionLayer("evidence")).toBe("derived");
    expect(briefSectionLayer("Interpretation")).toBe("interpretation");
    expect(briefSectionLayer("Something else")).toBeNull();
  });
  it("template has all five in order and says plainly it writes no interpretation", async () => {
    const { buildTemplateBrief } = await import("@/lib/brief");
    const t = buildTemplateBrief(SAMPLE_MARKET, SAMPLE_SIGNALS, "desk");
    const idx = BRIEF_SECTION_HEADERS.map((h) => t.indexOf(h));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(briefSection(t, "Interpretation")).toBe(TEMPLATE_INTERPRETATION);
    expect(t).toBe(SAMPLE_NARRATIVE);
  });
  it("an LLM answer without an Interpretation section falls back to the template", async () => {
    vi.resetModules();
    vi.stubEnv("OPENAI_API_KEY", "sk-test-not-real");
    const fourSections = "### Observation\nx\n\n### Evidence\n- y\n\n### Risk\n- z\n\n### Execution considerations\n- w";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: fourSections } }] }), { status: 200 })));
    const { maybeOpenAIBrief } = await import("@/lib/brief");
    expect((await maybeOpenAIBrief(SAMPLE_MARKET, SAMPLE_SIGNALS, "desk")).source).toBe("template");
    const five = "### Observation\nx\n\n### Evidence\n- y\n\n### Interpretation\nThe flow may indicate demand.\n\n### Risk\n- z\n\n### Execution considerations\n- w";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: five } }] }), { status: 200 })));
    expect((await maybeOpenAIBrief(SAMPLE_MARKET, SAMPLE_SIGNALS, "desk")).source).toBe("openai");
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it("the narrative renders a tag per section heading", () => {
    const html = renderToStaticMarkup(
      createElement(BriefMarkdown, {
        source: SAMPLE_NARRATIVE,
        headingAside: (h: string) => createElement("i", { "data-layer": briefSectionLayer(h) ?? "none" }),
      }),
    );
    expect(html).toContain('data-layer="observed"');
    expect(html).toContain('data-layer="derived"');
    expect(html).toContain('data-layer="interpretation"');
  });
});
