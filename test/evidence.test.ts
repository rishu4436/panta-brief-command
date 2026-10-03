import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { summarize, type FeedbackRow, type UsageEventRow } from "@/lib/evidence/schema";
import type { SharedStore } from "@/lib/shared-store";

const MARKET = "3wdVRLDiMeuWRjGcFq2FZgAyCLhswTwNSKEHgNFRSZNB";
const WALLET = "4VGFQKGanc5oaLf51mee9m45HmiXRhKruh5mdRaM";
const SECRET = "s3cret-for-tests-0123456789abcdef";

class ListStore implements SharedStore {
  readonly kind = "redis" as const;
  lists = new Map<string, unknown[]>();
  async incrWindow() {
    return { count: 1, ttlMs: 60_000 };
  }
  async getJson() {
    return null;
  }
  async setJson() {}
  async pushList(key: string, value: unknown, max: number) {
    this.lists.set(key, [value, ...(this.lists.get(key) ?? [])].slice(0, max));
  }
  async readList<T>(key: string, max: number) {
    return (this.lists.get(key) ?? []).slice(0, max) as T[];
  }
}

let ip = 0;
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `192.0.2.${++ip % 250}`, ...headers },
    body: JSON.stringify(body),
  });

const feedback = {
  anonId: "anon-1234-abcd",
  marketId: MARKET,
  mode: "flow",
  useful: "up",
  accurate: "down",
  comment: "Flow read was helpful\u0007 but price lagged",
  briefSource: "template",
  signalsVersion: 2,
  generatedAt: "2026-10-03T01:00:00.000Z",
};

async function load(store: SharedStore | null) {
  vi.resetModules();
  (await import("@/lib/shared-store")).__setSharedStoreForTests(store);
  return {
    feedback: (await import("@/app/api/feedback/route")).POST,
    events: (await import("@/app/api/events/route")).POST,
    exportGET: (await import("@/app/api/admin/export/route")).GET,
  };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "pbc-evidence-"));
  vi.stubEnv("EVIDENCE_LOG_DIR", dir);
  vi.stubEnv("ADMIN_EXPORT_SECRET", SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/api/feedback", () => {
  it("stores a cleaned rating in the shared store", async () => {
    const store = new ListStore();
    const { feedback: POST } = await load(store);
    const res = await POST(post("/api/feedback", feedback));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, stored: "redis" });
    const [row] = store.lists.get("evidence:feedback") as FeedbackRow[];
    expect(row).toMatchObject({ marketId: MARKET, useful: "up", accurate: "down", briefSource: "template" });
    expect(row.comment).toBe("Flow read was helpful but price lagged");
    expect(row.t).toMatch(/^\d{4}-/);
    expect(JSON.stringify(row)).not.toContain("192.0.2");
  });

  it("falls back to a JSON-lines log without a store", async () => {
    const { feedback: POST } = await load(null);
    const res = await POST(post("/api/feedback", feedback));
    expect((await res.json()).stored).toBe("file");
    const lines = readFileSync(path.join(dir, "feedback.jsonl"), "utf8").trim().split("\n");
    expect(JSON.parse(lines[0]).mode).toBe("flow");
  });

  it("rejects empty ratings, unknown fields and bad ids", async () => {
    const { feedback: POST } = await load(new ListStore());
    expect((await POST(post("/api/feedback", { ...feedback, useful: null, accurate: null, comment: "" }))).status).toBe(400);
    expect((await POST(post("/api/feedback", { ...feedback, ip: "1.2.3.4" }))).status).toBe(400);
    expect((await POST(post("/api/feedback", { ...feedback, marketId: "../x" }))).status).toBe(400);
  });
});

describe("/api/events", () => {
  it("accepts the six workflow events and stores no IP", async () => {
    const store = new ListStore();
    const { events: POST } = await load(store);
    for (const event of ["visit", "brief_viewed", "quote_requested", "sign_attempted", "trade_verified", "book_opened"]) {
      expect((await POST(post("/api/events", { anonId: "anon-1234-abcd", event, path: "/desk" }))).status).toBe(204);
    }
    const rows = store.lists.get("evidence:events") as UsageEventRow[];
    expect(rows).toHaveLength(6);
    expect(JSON.stringify(rows)).not.toContain("192.0.2");
  });

  it("rejects unknown events, query strings and extra fields", async () => {
    const { events: POST } = await load(new ListStore());
    expect((await POST(post("/api/events", { anonId: "anon-1234-abcd", event: "scroll" }))).status).toBe(400);
    expect((await POST(post("/api/events", { anonId: "anon-1234-abcd", event: "visit", path: "/desk?email=a@b.c" }))).status).toBe(400);
    expect((await POST(post("/api/events", { anonId: "anon-1234-abcd", event: "visit", userAgent: "x" }))).status).toBe(400);
  });

  it("drops events when the browser sends DNT or GPC", async () => {
    const store = new ListStore();
    const { events: POST } = await load(store);
    expect((await POST(post("/api/events", { anonId: "anon-1234-abcd", event: "visit" }, { dnt: "1" }))).status).toBe(204);
    expect((await POST(post("/api/events", { anonId: "anon-1234-abcd", event: "visit" }, { "sec-gpc": "1" }))).status).toBe(204);
    expect(store.lists.get("evidence:events")).toBeUndefined();
  });
});

describe("/api/admin/export", () => {
  const get = (q: string, auth?: string) =>
    new NextRequest(`http://localhost/api/admin/export${q}`, { headers: auth ? { authorization: auth } : {} });

  it("is 404 when no secret is configured and 401 with a wrong secret", async () => {
    const { exportGET } = await load(new ListStore());
    expect((await exportGET(get("?kind=summary", `Bearer ${SECRET}x`))).status).toBe(401);
    expect((await exportGET(get("?kind=summary"))).status).toBe(401);
    vi.stubEnv("ADMIN_EXPORT_SECRET", "");
    expect((await exportGET(get("?kind=summary", `Bearer ${SECRET}`))).status).toBe(404);
  });

  it("exports rows and a summary with the right secret", async () => {
    const store = new ListStore();
    const { feedback: fb, events: ev, exportGET } = await load(store);
    await fb(post("/api/feedback", feedback));
    await ev(post("/api/events", { anonId: "anon-1234-abcd", event: "brief_viewed", marketId: MARKET, mode: "flow" }));
    const rows = await exportGET(get("?kind=feedback", `Bearer ${SECRET}`));
    expect((await rows.json()).count).toBe(1);
    const nd = await exportGET(get("?kind=events&format=ndjson", `Bearer ${SECRET}`));
    expect(nd.headers.get("content-type")).toContain("ndjson");
    expect((await nd.text()).trim().split("\n")).toHaveLength(1);
    const sum = await (await exportGET(get("?kind=summary", `Bearer ${SECRET}`))).json();
    expect(sum.summary.feedback).toMatchObject({ total: 1, useful: { up: 1, down: 0 }, accurate: { up: 0, down: 1 } });
    expect(sum.summary.visitors.unique).toBe(1);
  });
});

describe("summarize", () => {
  const ev = (anonId: string, event: UsageEventRow["event"], t: string, wallet?: string): UsageEventRow => ({ anonId, event, t, ...(wallet ? { wallet } : {}) });
  it("counts returning (≥2 IST days) and multi-workflow (≥2 non-visit events) visitors", () => {
    const s = summarize(
      [
        ev("a", "visit", "2026-10-01T10:00:00.000Z"),
        ev("a", "brief_viewed", "2026-10-01T10:01:00.000Z"),
        ev("a", "quote_requested", "2026-10-02T10:00:00.000Z"),
        ev("b", "visit", "2026-10-01T17:00:00.000Z"), // 22:30 IST on 1 Oct
        ev("b", "visit", "2026-10-01T19:00:00.000Z"), // 00:30 IST on 2 Oct → second IST day
        ev("c", "trade_verified", "2026-10-02T09:00:00.000Z", WALLET),
      ],
      [],
    );
    expect(s.visitors).toEqual({ unique: 3, returning: 2, multiWorkflow: 1, verifiedTrade: 1, walletsShared: 1 });
    expect(s.events.byEvent).toEqual({ visit: 3, brief_viewed: 1, quote_requested: 1, trade_verified: 1 });
  });
  it("is all zeros for no data (nothing is invented)", () => {
    const s = summarize([], []);
    expect(s.visitors.unique).toBe(0);
    expect(s.feedback.total).toBe(0);
    expect(s.events.firstAt).toBeNull();
  });
});
