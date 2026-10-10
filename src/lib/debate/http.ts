import "server-only";

import { NextResponse } from "next/server";
import { errorResponse, reject } from "@/lib/rooms/http";
import { DebateError } from "./service";
import { ChallengeLimitError, DebateNotFoundError } from "./types";

/** Debate-specific errors first, then the shared room error mapping. */
export function debateErrorResponse(e: unknown): NextResponse {
  if (e instanceof DebateError) return reject(e.status, e.code, e.message);
  if (e instanceof ChallengeLimitError) return reject(409, "CHALLENGE_LIMIT", e.message.charAt(0).toUpperCase() + e.message.slice(1) + ".");
  if (e instanceof DebateNotFoundError) return reject(404, "DEBATE_NOT_FOUND", "That debate no longer exists in this room.");
  return errorResponse(e);
}
