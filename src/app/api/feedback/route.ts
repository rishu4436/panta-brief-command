import { NextRequest, NextResponse } from "next/server";
import { cleanComment, FeedbackInput, type FeedbackRow } from "@/lib/evidence/schema";
import { readLimitedJson, reject } from "@/lib/evidence/http";
import { appendEvidence } from "@/lib/evidence/store";

/** POST /api/feedback — one rating of an AI brief ("Useful? / Accurate?" + optional comment). */
export async function POST(req: NextRequest) {
  const read = await readLimitedJson(req, "feedback", 10);
  if (!read.ok) return read.res;
  const parsed = FeedbackInput.safeParse(read.body);
  if (!parsed.success) return reject(400, "INVALID_FEEDBACK", parsed.error.issues[0]?.message?.slice(0, 120));
  const row: FeedbackRow = { ...parsed.data, comment: cleanComment(parsed.data.comment), t: new Date().toISOString() };
  try {
    const stored = await appendEvidence("feedback", row);
    return NextResponse.json({ ok: true, stored }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return reject(500, "FEEDBACK_NOT_STORED");
  }
}
