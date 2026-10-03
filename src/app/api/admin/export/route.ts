import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { summarize, type FeedbackRow, type UsageEventRow } from "@/lib/evidence/schema";
import { readEvidence } from "@/lib/evidence/store";

/**
 * GET /api/admin/export?kind=summary|feedback|events[&format=ndjson]
 * Authorization: Bearer <ADMIN_EXPORT_SECRET>
 *
 * Disabled (404) unless ADMIN_EXPORT_SECRET is set (≥ 24 chars). Rows are
 * returned exactly as stored, newest first; the summary is computed from them.
 */
export const dynamic = "force-dynamic";

function authorized(req: NextRequest, secret: string): boolean {
  const header = req.headers.get("authorization") || "";
  const given = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  const secret = process.env.ADMIN_EXPORT_SECRET?.trim() || "";
  if (secret.length < 24) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });
  if (!authorized(req, secret)) {
    return NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  }
  const kind = req.nextUrl.searchParams.get("kind") || "summary";
  const format = req.nextUrl.searchParams.get("format") || "json";
  const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

  if (kind === "summary") {
    const [events, feedback] = await Promise.all([
      readEvidence<UsageEventRow>("events"),
      readEvidence<FeedbackRow>("feedback"),
    ]);
    return NextResponse.json(
      { generatedAt: new Date().toISOString(), store: events.store, summary: summarize(events.rows, feedback.rows) },
      { headers },
    );
  }
  if (kind !== "feedback" && kind !== "events") {
    return NextResponse.json({ code: "INVALID_KIND", detail: "kind must be summary, feedback or events" }, { status: 400 });
  }
  const { rows, store } = await readEvidence(kind);
  if (format === "ndjson") {
    return new NextResponse(rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""), {
      headers: { ...headers, "Content-Type": "application/x-ndjson", "X-Evidence-Store": store },
    });
  }
  return NextResponse.json({ kind, store, count: rows.length, rows }, { headers });
}
