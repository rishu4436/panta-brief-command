import { NextRequest, NextResponse } from "next/server";
import { UsageEventInput, type UsageEventRow } from "@/lib/evidence/schema";
import { readLimitedJson, reject } from "@/lib/evidence/http";
import { appendEvidence } from "@/lib/evidence/store";
import { storeHeaderValue } from "@/lib/shared-store";

/** POST /api/events — first-party anonymous usage event (see src/lib/telemetry.ts). */
export async function POST(req: NextRequest) {
  // Respect Do Not Track / Global Privacy Control even if a client sends anyway.
  if (req.headers.get("dnt") === "1" || req.headers.get("sec-gpc") === "1") {
    return new NextResponse(null, { status: 204 });
  }
  const read = await readLimitedJson(req, "events", 60);
  if (!read.ok) return read.res;
  const parsed = UsageEventInput.safeParse(read.body);
  if (!parsed.success) return reject(400, "INVALID_EVENT", parsed.error.issues[0]?.message?.slice(0, 120));
  const row: UsageEventRow = { ...parsed.data, t: new Date().toISOString() };
  try {
    const stored = await appendEvidence("events", row);
    // 204 has no body; the store (and whether it is shared) is in the header.
    return new NextResponse(null, { status: 204, headers: { "X-Evidence-Store": storeHeaderValue(stored) } });
  } catch {
    return reject(500, "EVENT_NOT_STORED");
  }
}
