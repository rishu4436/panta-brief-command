/**
 * Landing v2 (Phase 10): copy, CTAs, honesty labels and the community
 * unavailable state. Server sections are rendered to static HTML.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
}));
// The module switcher lazy-loads the desk previews; render a marker instead.
vi.mock("next/dynamic", () => ({ default: () => () => createElement("div", { "data-dynamic-preview": "" }) }));

import { CommunityUnavailable, CommunityUnavailablePage } from "@/components/community/CommunityUnavailable";
import { ArenaFeature } from "@/components/landing/v2/ArenaFeature";
import { CapabilityRail } from "@/components/landing/v2/CapabilityRail";
import { CreatorsFeature } from "@/components/landing/v2/CreatorsFeature";
import { DebateFeature } from "@/components/landing/v2/DebateFeature";
import { DEMO_BUCKETS, DEMO_CONSENSUS, DEMO_LEADERBOARD, DEMO_MARKET, DEMO_PARTICIPANTS } from "@/components/landing/v2/demo";
import { FinalCall } from "@/components/landing/v2/FinalCall";
import { Hero } from "@/components/landing/v2/Hero";
import { Journey } from "@/components/landing/v2/Journey";
import { ParticipationPaths } from "@/components/landing/v2/ParticipationPaths";
import { PlatformFeature } from "@/components/landing/v2/PlatformFeature";
import { PlatformModules } from "@/components/landing/v2/PlatformModules";
import { RoomsFeature } from "@/components/landing/v2/RoomsFeature";
import { communityAvailabilityAtBuild } from "@/lib/rooms/availability";

const html = (node: ReactNode) => renderToStaticMarkup(node as never);
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const hrefs = (h: string) => [...h.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

const SECTIONS = [Hero, CapabilityRail, ParticipationPaths, RoomsFeature, ArenaFeature, DebateFeature, CreatorsFeature, PlatformFeature, Journey, FinalCall];
const page = SECTIONS.map((S) => html(createElement(S))).join("\n");

/** App routes that exist as directories under src/app (static segments only). */
function appRoutes(): Set<string> {
  const root = path.join(process.cwd(), "src/app");
  const out = new Set<string>(["/"]);
  const walk = (dir: string, prefix: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (!statSync(full).isDirectory() || name.startsWith("[") || name === "api") continue;
      const route = `${prefix}/${name}`;
      if (readdirSync(full).some((f) => /^page\.tsx?$/.test(f))) out.add(route);
      walk(full, route);
    }
  };
  walk(root, "");
  return out;
}

describe("landing v2 copy and structure", () => {
  it("has exactly one h1 with the three-line headline, and h2s for every section", () => {
    expect(page.match(/<h1[\s>]/g)).toHaveLength(1);
    const h1 = text(page.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)![1]);
    expect(h1).toContain("Read the market.");
    expect(h1).toContain("Test your thesis.");
    expect(h1).toContain("Bring others in.");
    for (const h2 of [
      "Two ways to take part.",
      "Every market deserves a conversation.",
      "Build a track record, not just an opinion.",
      "Two sides. Real evidence. Better questions.",
      "Build your own prediction community.",
      "From research to execution.",
      "Turn market curiosity into collective intelligence.",
    ]) {
      expect(text(page)).toContain(h2);
    }
    // Every section after the hero has exactly one h2 (the rail and the journey included).
    for (const S of SECTIONS.slice(1)) expect(html(createElement(S)).match(/<h2[\s>]/g), S.name).toHaveLength(1);
    expect(html(createElement(Hero))).not.toMatch(/<h2[\s>]/);
  });

  it("states the positioning and the hero copy", () => {
    const t = text(page);
    expect(t).toContain("A prediction-market platform for intelligence, forecasting, community and execution");
    expect(t).toContain("Discover live prediction markets, make free community forecasts, challenge ideas with evidence, and trade through your own Solana wallet—all in one workspace.");
    expect(t).toContain("Forecast for free.");
    expect(t).toContain("Trade only when you choose.");
  });

  it("primary CTAs point at the right real routes", () => {
    const ctas = [...page.matchAll(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => [text(m[2]).trim(), m[1]] as const);
    const find = (label: string) => ctas.filter(([l]) => l === label).map(([, h]) => h);
    expect(find("Explore Markets")).toEqual(["/desk", "/desk"]);
    expect(find("Explore Prediction Rooms")).toEqual(["/rooms"]);
    expect(find("Discover Rooms")).toEqual(["/rooms"]);
    expect(find("Explore the Arena")).toEqual(["/arena"]);
    expect(find("Open Creator Studio")).toEqual(["/studio", "/studio"]);
    expect(find("Explore Rooms")).toEqual(["/rooms"]);
  });

  it("every link on the landing is a real app route", () => {
    const routes = appRoutes();
    const links = hrefs(page);
    expect(links.length).toBeGreaterThan(8);
    for (const h of links) expect(routes.has(h.split(/[?#]/)[0]), h).toBe(true);
  });

  it("separates forecasting from trading", () => {
    const t = text(html(createElement(ParticipationPaths)));
    expect(t).toContain("No funds needed");
    expect(t).toContain("Real funds · your wallet");
    expect(t).toContain("Forecasts never execute trades");
  });

  it("labels every product composition as illustrative and keeps market price and community forecast distinct", () => {
    for (const S of [Hero, RoomsFeature, ArenaFeature, DebateFeature, CreatorsFeature]) {
      expect(html(createElement(S)), S.name).toMatch(/Illustrative/i);
    }
    const rooms = text(html(createElement(RoomsFeature)));
    expect(rooms).toContain("Market price");
    expect(rooms).toContain("Community forecast");
    expect(rooms).toContain("Neither is official or guaranteed");
    // Demo numbers are coherent: consensus is the bucket mean and differs from the market price.
    expect(DEMO_PARTICIPANTS).toBe(DEMO_BUCKETS.reduce((a, b) => a + b, 0));
    expect(DEMO_CONSENSUS).not.toBe(DEMO_MARKET.yes);
  });

  it("uses no fake identities: placeholder forecasters only, no wallet-like addresses", () => {
    for (const f of DEMO_LEADERBOARD) expect(f.id).toMatch(/^Forecaster \d{2}$/);
    expect(page).not.toMatch(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/);
    expect(text(page)).not.toMatch(/testimonial|\bprofit(s)? of\b|\bwon \$|\bguaranteed returns?\b/i);
  });

  it("arena copy is honest about when scoring happens and who is ranked", () => {
    const t = text(html(createElement(ArenaFeature)));
    expect(t).toContain("only after a market's outcome is verified");
    expect(t).toMatch(/Provisional/);
    expect(t).toContain("five scored markets");
  });

  it("debate copy: provider required, placeholder sources, no winner", () => {
    const t = text(html(createElement(DebateFeature)));
    expect(t).toContain("only when an AI provider is available");
    expect(t).toContain("no side is declared the winner");
    expect(t).toMatch(/Source A · illustrative/);
    expect(t).not.toMatch(/https?:\/\//);
  });

  it("platform section reuses the desk previews and states its limits", () => {
    const h = html(createElement(PlatformFeature));
    expect(h).toContain("data-dynamic-preview");
    const t = text(h);
    for (const s of ["Secondary-market execution is not supported", "not yet proven by a completed creation", "disabled on read-only preview", "not claimed to be comprehensively tested in production"]) {
      expect(t).toContain(s);
    }
  });

  it("section 06 tabs: one tabpanel per tab, linked both ways, roving tabindex, inactive panels inert", () => {
    const h = html(createElement(PlatformModules));
    const tabs = [...h.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map((m) => m[0]);
    const panels = [...h.matchAll(/<div[^>]*role="tabpanel"[^>]*>/g)].map((m) => m[0]);
    expect(tabs).toHaveLength(5);
    expect(panels).toHaveLength(5);
    const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
    const panelIds = new Set(panels.map((p) => attr(p, "id")));
    expect(panelIds.size).toBe(5);
    tabs.forEach((t, i) => {
      const controls = attr(t, "aria-controls");
      expect(panelIds.has(controls), controls).toBe(true);
      const panel = panels.find((p) => attr(p, "id") === controls)!;
      expect(attr(panel, "aria-labelledby")).toBe(attr(t, "id"));
      const selected = i === 0;
      expect(attr(t, "aria-selected")).toBe(String(selected));
      expect(attr(t, "tabindex")).toBe(selected ? "0" : "-1");
      // The inactive panels stay in the DOM (so the stack keeps the tallest height) but are inert.
      expect(/\sinert=""/.test(panel)).toBe(!selected);
      expect(panel).toContain("[grid-area:stack]");
    });
    // No fixed height on the panel stack that could clip content.
    const stack = h.match(/<div[^>]*data-panels[^>]*>/)![0];
    expect(stack).not.toMatch(/\b(min-|max-)?h-\[|height:/);
    // Every capability's points are in the markup before any interaction.
    const t = text(h);
    for (const s of ["Live Panta catalog with categories", "Deterministic signal analysis", "Primary YES / NO buying", "Settlement and claim eligibility", "Named sources of truth"]) {
      expect(t).toContain(s);
    }
  });

  it("debate and creators keep their honesty labels in the compact phone compositions too", () => {
    const d = text(html(createElement(DebateFeature)));
    expect(d.match(/EVIDENCE REFEREE/g)).toHaveLength(2); // phone card + desktop referee
    expect(d).toContain("no winner picked");
    expect(d).toContain("Placeholder sources");
    expect(d.match(/Source A · illustrative/g)!.length).toBeGreaterThanOrEqual(2);
    const c = text(html(createElement(CreatorsFeature)));
    expect(c).toContain("Illustrative metrics");
    expect(c).toContain("Embed visits & forecasts → Studio");
    expect(c).toContain("Wallet counts are wallets, not people");
  });

  it("the social card is static: no fetch, no live data, honest copy", () => {
    const src = readFileSync(path.join(process.cwd(), "src/app/opengraph-image.tsx"), "utf8");
    expect(src).toContain('from "next/og"');
    expect(src).not.toMatch(/\bfetch\(|readFile|https?:\/\//);
    expect(src).toContain("width: 1200, height: 630");
    expect(src).toContain("Read the market.");
    expect(src).not.toMatch(/\d+%\s*(YES|NO)|\$\d|USDC/); // no sample prices or amounts
  });

  it("makes no Panta requests: landing sources import no data hooks or fetch", () => {
    const dir = path.join(process.cwd(), "src/components/landing/v2");
    const files = [path.join(process.cwd(), "src/app/page.tsx"), ...readdirSync(dir).map((f) => path.join(dir, f))];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/useCatalog|useBrief|useHydratedDetails|@\/lib\/data\/hooks|\bfetch\(/);
    }
  });

  it("shows the community notice only when community storage is unavailable", () => {
    expect(html(createElement(Hero))).not.toContain("landing-community-notice");
    const preview = text(html(createElement(Hero, { communityNotice: true })));
    expect(preview).toContain("This read-only preview has no community storage");
    expect(preview).toContain("Rooms, forecasts, the Arena and Creator Studio are unavailable here");
  });

  it("metadata carries the new positioning (and no fabricated ratings)", () => {
    // Source check: importing the root layout would pull in next/font and the wallet providers.
    const src = readFileSync(path.join(process.cwd(), "src/app/layout.tsx"), "utf8");
    expect(src).toContain("A prediction-market platform for intelligence, forecasting, community and execution.");
    expect(src).toContain("Brief Command — Read the market. Test your thesis. Bring others in.");
    expect(src).not.toMatch(/aggregateRating|ratingValue/);
  });
});

describe("community unavailable state", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("is informational: no retry, honest copy, links to what works", () => {
    for (const feature of ["rooms", "create-room", "room", "arena", "studio", "profile"] as const) {
      const h = html(createElement(CommunityUnavailable, { feature }));
      expect(h).toContain('role="status"');
      expect(h).not.toMatch(/Try again/);
      expect(hrefs(h)).toEqual(["/desk", "/"]);
      expect(text(h)).toMatch(/isn't configured|doesn't have it configured/);
    }
    expect(text(html(createElement(CommunityUnavailable, { feature: "studio", readOnly: true })))).toContain("Read-only preview");
    const pageHtml = html(createElement(CommunityUnavailablePage, { feature: "rooms", readOnly: true, eyebrow: "Community", title: "Prediction Rooms", description: "d" }));
    expect(pageHtml.match(/<h1[\s>]/g)).toHaveLength(1);
  });

  it("availability follows the store configuration (config only, no store access)", () => {
    process.env = { ...saved, VERCEL: "1", VERCEL_ENV: "preview", VERCEL_URL: "x.vercel.app", UPSTASH_REDIS_REST_URL: "", UPSTASH_REDIS_REST_TOKEN: "", KV_REST_API_URL: "", KV_REST_API_TOKEN: "" };
    expect(communityAvailabilityAtBuild()).toEqual({ available: false, readOnly: true });
    process.env = { ...saved, VERCEL: "", VERCEL_ENV: "", VERCEL_URL: "", NODE_ENV: "test" };
    expect(communityAvailabilityAtBuild().available).toBe(true);
  });
});
