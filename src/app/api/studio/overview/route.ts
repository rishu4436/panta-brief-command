import { NextRequest } from "next/server";
import { errorResponse, ok } from "@/lib/rooms/http";
import { studioAuth, studioDeps } from "@/lib/studio/http";
import { getStudioOverview } from "@/lib/studio/service";

export const dynamic = "force-dynamic";

/** GET /api/studio/overview — the signed-in creator's aggregate metrics (own rooms only). */
export async function GET(req: NextRequest) {
  const auth = await studioAuth(req);
  if (!auth.ok) return auth.res;
  try {
    return ok(await getStudioOverview(studioDeps(), auth.wallet));
  } catch (e) {
    return errorResponse(e);
  }
}
