import { NextRequest } from "next/server";
import { slugProblem, SLUG_PROBLEM_TEXT } from "@/lib/rooms/domain";
import { roomDeps } from "@/lib/rooms/deps";
import { errorResponse, limitRequest, ok } from "@/lib/rooms/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/rooms/slug-check?slug=… — advisory availability for the create
 * form. The UNIQUE constraint at create time is what actually decides.
 */
export async function GET(req: NextRequest) {
  const limited = await limitRequest(req, "slugCheck");
  if (limited) return limited;
  const slug = (req.nextUrl.searchParams.get("slug") || "").trim().toLowerCase().slice(0, 96);
  const problem = slugProblem(slug);
  if (problem) return ok({ slug, available: false, reason: problem, message: SLUG_PROBLEM_TEXT[problem] });
  try {
    const taken = await roomDeps().repo.isSlugTaken(slug);
    return ok({ slug, available: !taken, reason: taken ? "taken" : null, message: taken ? "Already taken." : null });
  } catch (e) {
    return errorResponse(e);
  }
}
