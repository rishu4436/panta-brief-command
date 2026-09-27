import { chromium } from "/workspace/.tools/pw/node_modules/playwright-core/index.mjs";
const [mode, url, sel, out, w = "1440", h = "900"] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const p = await b.newPage({ viewport: { width: +w, height: +h } });
await p.route(/\/api\/panta\/markets(\?|$)/, async (route) => {
  if (mode === "loading") { await new Promise((r) => setTimeout(r, 60000)); return route.abort().catch(() => {}); }
  if (mode === "error") return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "upstream_unavailable" }) });
  if (mode === "empty") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], nextCursor: null }) });
  return route.continue();
});
await p.goto(url, { waitUntil: "domcontentloaded" });
const el = p.locator(sel).first();
await el.waitFor({ timeout: 15000 });
await el.scrollIntoViewIfNeeded();
await p.waitForTimeout(mode === "loading" ? 2500 : 9000);
if (sel === "body") await p.screenshot({ path: out }); else await el.screenshot({ path: out });
console.log(out); await b.close(); process.exit(0);
