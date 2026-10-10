import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { clientIp } from "@/lib/rate-limit";
import { limitShared } from "@/lib/shared-store";

const MAX_BODY_BYTES = 2 * 1024;

export function reject(status: number, code: string, detail?: string, headers?: Record<string, string>) {
  return NextResponse.json({ error: code, code, ...(detail ? { detail } : {}) }, { status, headers });
}

/** Size cap (default 2 KB), per-IP limit (the IP is used only for the counter key, never stored), JSON parse. */
export async function readLimitedJson(
  req: NextRequest,
  bucket: string,
  limit: number,
  maxBytes: number = MAX_BODY_BYTES,
): Promise<{ ok: true; body: unknown } | { ok: false; res: NextResponse }> {
  const declared = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, res: reject(413, "PAYLOAD_TOO_LARGE") };
  const rl = await limitShared(`${bucket}:${clientIp(req.headers)}`, limit, 60_000);
  if (!rl.ok) {
    return { ok: false, res: reject(429, "RATE_LIMITED", undefined, { "Retry-After": String(rl.retryAfterSec) }) };
  }
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) return { ok: false, res: reject(413, "PAYLOAD_TOO_LARGE") };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, res: reject(400, "INVALID_JSON") };
  }
}
