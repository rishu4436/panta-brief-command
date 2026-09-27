import { readFileSync } from "node:fs";
import { chromium } from "/workspace/.tools/pw/node_modules/playwright-core/index.mjs";
const [out, colW, title, ...pairs] = process.argv.slice(2);
const cols = [];
for (let i = 0; i < pairs.length; i += 2) cols.push({ label: pairs[i], src: "data:image/png;base64," + readFileSync(pairs[i + 1]).toString("base64") });
const html = `<html><body style="margin:0;background:#05070c;font:14px system-ui;color:#cbd5e1">
<div style="padding:14px 18px;font-weight:600;color:#f1f5f9;font-size:16px">${title}</div>
<div style="display:flex;gap:18px;padding:0 18px 18px;align-items:flex-start">${cols.map(c => `<figure style="margin:0;width:${colW}px"><figcaption style="margin-bottom:8px;color:#94a3b8">${c.label}</figcaption><img src="${c.src}" style="width:${colW}px;display:block;border:1px solid #1e293b;border-radius:8px"></figure>`).join("")}</div></body></html>`;
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const p = await b.newPage({ viewport: { width: cols.length * (+colW + 18) + 18, height: 400 } });
await p.setContent(html); await p.waitForTimeout(300);
await p.screenshot({ path: out, fullPage: true }); console.log(out); await b.close();
