// QA harness: desk trade ticket states with MOCKED Panta + RPC + wallet.
// Nothing here ships; it drives the production build on :3000.
import { createRequire } from "node:module";
import { chromium } from "/workspace/.tools/pw/node_modules/playwright-core/index.mjs";
const require = createRequire("/workspace/panta-brief-command/package.json");
const { Keypair } = require("@solana/web3.js");
const bs58 = require("bs58").default ?? require("bs58");

const [scenario, out, w = "1280", h = "1100"] = process.argv.slice(2);
const BASE = "http://localhost:3000";
const wallet = Keypair.generate().publicKey;
const MOCK_ID = Keypair.generate().publicKey.toBase58();
const BLOCKHASH = Keypair.generate().publicKey.toBase58();
const SIG = bs58.encode(Uint8Array.from({ length: 64 }, (_, i) => (i * 37 + 11) % 256));
const PANTA = "6gM5afTQBq5VZCfgpGqcsqzfWd5maLSCKWtGjbEobZMp";
const nowSec = Math.floor(Date.now() / 1000);

const MOCK_MARKET = {
  marketId: MOCK_ID,
  title: "QA harness market (mocked responses, not live)",
  category: "Crypto",
  phase: "primary",
  status: "open",
  yesPrice: "0.62",
  noPrice: "0.38",
  primaryYesPrice: "0.62",
  primaryNoPrice: "0.38",
  volumeUsdc: "310.00",
  endTime: nowSec + 20 * 86400,
  resolutionTime: nowSec + 21 * 86400,
};

const opts = {
  connected: scenario !== "disconnected",
  quoteTtlSec: scenario === "expired" ? 7 : 75,
  rejectSign: scenario === "rejected",
  verify: scenario === "verified" ? "confirmed" : "submitted",
  report: scenario === "verified" ? "processed" : "pending",
  sendFail: scenario === "broadcast_failed",
};

const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const ctx = await b.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const page = await ctx.newPage();

await page.addInitScript(
  ({ bytes, b58, connected, rejectSign }) => {
    if (connected) localStorage.setItem("walletName", JSON.stringify("Phantom"));
    else localStorage.removeItem("walletName");
    const pk = { toBytes: () => Uint8Array.from(bytes), toBase58: () => b58, toString: () => b58, equals: () => false };
    const listeners = {};
    const provider = {
      isPhantom: true,
      isConnected: false,
      publicKey: null,
      async connect() {
        this.isConnected = true;
        this.publicKey = pk;
        (listeners.connect || []).forEach((f) => f(pk));
        return { publicKey: pk };
      },
      async disconnect() {
        this.isConnected = false;
        (listeners.disconnect || []).forEach((f) => f());
      },
      on(ev, f) { (listeners[ev] ||= []).push(f); },
      off(ev, f) { listeners[ev] = (listeners[ev] || []).filter((x) => x !== f); },
      removeListener(ev, f) { this.off(ev, f); },
      async signTransaction(tx) {
        await new Promise((r) => setTimeout(r, 300));
        if (rejectSign) {
          const e = new Error("User rejected the request.");
          e.code = 4001;
          throw e;
        }
        if (tx.signatures?.[0]) tx.signatures[0] = Uint8Array.from({ length: 64 }, (_, i) => (i * 37 + 11) % 256);
        return tx;
      },
      async signAllTransactions(txs) { return txs; },
      async signMessage() { throw new Error("not supported in harness"); },
    };
    window.isPhantomInstalled = true;
    window.phantom = { solana: provider };
    window.solana = provider;
  },
  { bytes: Array.from(wallet.toBytes()), b58: wallet.toBase58(), connected: opts.connected, rejectSign: opts.rejectSign },
);

const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

// --- Panta proxy mocks ---------------------------------------------------
await page.route("**/api/panta/**", async (route) => {
  const req = route.request();
  const u = new URL(req.url());
  const p = u.pathname.replace(/^\/api\/panta\//, "").replace(/\/$/, "");
  if (p === "markets" && req.method() === "GET") {
    const res = await route.fetch();
    let data = { items: [] };
    try { data = await res.json(); } catch {}
    if (u.searchParams.get("status") === "primary") data.items = [MOCK_MARKET, ...(data.items || [])];
    return json(route, data);
  }
  if (p === `markets/${MOCK_ID}`) return json(route, MOCK_MARKET);
  if (p === `markets/${MOCK_ID}/trades`) return json(route, { items: [] });
  if (p === "primaryorderquote") {
    const body = JSON.parse(req.postData() || "{}");
    return json(route, {
      quoteId: "qa-quote-1", marketId: MOCK_ID, side: body.side || "yes", amountUsdc: body.amountUsdc || "25",
      shares: "39.10", avgPrice: "0.6394", feeUsdc: "0.25",
      expiresAt: new Date(Date.now() + opts.quoteTtlSec * 1000).toISOString(),
    });
  }
  if (p === "primaryorderbuild") {
    return json(route, {
      orderId: "qa-order-1", quoteId: "qa-quote-1", wallet: wallet.toBase58(), marketId: MOCK_ID, side: "yes",
      amountUsdc: "25", expectedShares: "39.10", feeUsdc: "0.25", status: "built",
      instructions: [{
        programId: PANTA,
        accounts: [
          { pubkey: wallet.toBase58(), isSigner: true, isWritable: true },
          { pubkey: MOCK_ID, isSigner: false, isWritable: true },
        ],
        data: Buffer.from([1, 2, 3, 4]).toString("base64"),
      }],
      recentBlockhash: BLOCKHASH, lastValidBlockHeight: 1_000_000,
    });
  }
  if (p === "primaryordersubmit") return json(route, { orderId: "qa-order-1", status: "submitted", signature: SIG });
  if (p === "primaryorderverify") return json(route, { orderId: "qa-order-1", status: opts.verify, signature: SIG });
  if (p === "trades" && req.method() === "POST") return json(route, { signature: SIG, status: opts.report });
  if (p === "account/trades") return json(route, { items: [] });
  if (p === "positions") return json(route, { items: [] });
  return route.continue();
});

// --- Solana RPC mocks (any JSON-RPC POST) ----------------------------------
await page.route(
  (url) => !url.href.startsWith(BASE),
  async (route) => {
    const req = route.request();
    const body = req.postData() || "";
    if (req.method() !== "POST" || !body.includes('"jsonrpc"')) return route.continue();
    const msg = JSON.parse(body);
    const one = (m) => {
      const r = (result) => ({ jsonrpc: "2.0", id: m.id, result });
      switch (m.method) {
        case "getBlockHeight": return r(999_000);
        case "getLatestBlockhash": return r({ context: { slot: 1 }, value: { blockhash: BLOCKHASH, lastValidBlockHeight: 1_000_000 } });
        case "sendTransaction":
          return opts.sendFail
            ? { jsonrpc: "2.0", id: m.id, error: { code: -32002, message: "Transaction simulation failed: Blockhash not found" } }
            : r(SIG);
        case "getSignatureStatuses":
          return r({ context: { slot: 5 }, value: [{ slot: 5, confirmations: null, err: null, confirmationStatus: "confirmed" }] });
        default: return r(null);
      }
    };
    return json(route, Array.isArray(msg) ? msg.map(one) : one(msg));
  },
);
await page.routeWebSocket(/^wss?:\/\/(?!localhost)/, (ws) => {
  ws.onMessage((raw) => {
    const m = JSON.parse(String(raw));
    if (m.method === "signatureSubscribe") {
      ws.send(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: 7 }));
      setTimeout(() => ws.send(JSON.stringify({ jsonrpc: "2.0", method: "signatureNotification", params: { subscription: 7, result: { context: { slot: 5 }, value: { err: null } } } })), 400);
    } else if (m.method && m.method.endsWith("Subscribe")) {
      ws.send(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: 9 }));
    } else if (m.id != null) {
      ws.send(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: true }));
    }
  });
});

await page.goto(`${BASE}/execute?marketId=${MOCK_ID}`, { waitUntil: "networkidle" }).catch(() => {});
await page.waitForTimeout(2500);
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("console:", m.text().slice(0, 200)); });
if (opts.connected && !(await page.getByRole("button", { name: "Get quote", exact: true }).count())) {
  console.log("autoconnect did not happen; connecting via modal");
  await page.getByRole("button", { name: "Connect wallet", exact: true }).first().click();
  await page.waitForTimeout(800);
  console.log("phantom?", await page.evaluate(() => Boolean(window.phantom?.solana?.isPhantom)), "ls:", await page.evaluate(() => localStorage.getItem("walletName")));
  console.log("modal:", (await page.locator(".wallet-adapter-modal").innerText().catch(() => "none")).replace(/\n/g, " | "));
  await page.locator(".wallet-adapter-modal-list button", { hasText: "Phantom" }).first().click();
  await page.waitForTimeout(1500);
}
const panel = page.locator("section,div").filter({ has: page.getByText("Execute Trade", { exact: true }) }).last();
const ticket = page.getByText("Execute Trade", { exact: true }).first().locator("xpath=ancestor::*[contains(@class,'card') or self::section][1]");
const click = async (name) => {
  const btn = page.getByRole("button", { name, exact: true }).first();
  await btn.waitFor({ state: "visible", timeout: 15000 });
  await btn.click();
};

const shot = async (suffix = "") => {
  const target = (await ticket.count()) ? ticket : panel;
  await target.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(400);
  const file = suffix ? out.replace(/\.png$/, `-${suffix}.png`) : out;
  await target.screenshot({ path: file });
  const title = await target.evaluate((e) => e.innerText.split("\n").slice(0, 3).join(" | "));
  console.log(file, "::", title);
};

try {
  if (scenario === "disconnected") {
    await shot();
  } else {
    await click("Get quote");
    await page.waitForTimeout(1200);
    if (scenario === "quote") await shot();
    else if (scenario === "expired") { await page.waitForTimeout(3500); await shot(); }
    else {
      await click("Review & confirm");
      await page.waitForTimeout(1200);
      if (scenario === "review") await shot();
      else {
        await click("Approve in wallet");
        if (scenario === "rejected") { await page.waitForTimeout(1500); await shot(); }
        else if (scenario === "broadcast_failed") { await page.waitForTimeout(2500); await shot(); }
        else if (scenario === "verifying") {
          await page.waitForTimeout(9000); await shot();
          await page.waitForTimeout(26000); await shot("slow");
        } else if (scenario === "verified") { await page.waitForTimeout(9000); await shot(); }
      }
    }
  }
} catch (e) {
  console.error("harness error:", e.message);
  await page.screenshot({ path: out.replace(/\.png$/, "-debug.png"), fullPage: true });
}
await b.close();
