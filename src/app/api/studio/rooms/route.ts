import { NextRequest } from "next/server";
import { errorResponse, ok, reject } from "@/lib/rooms/http";
import { studioAuth, studioDeps } from "@/lib/studio/http";
import { listStudioRooms, STUDIO_STATUS_FILTERS, type StudioStatusFilter } from "@/lib/studio/service";

export const dynamic = "force-dynamic";

/** GET /api/studio/rooms?q&status&page — the signed-in creator's rooms (any status), paginated. */
export async function GET(req: NextRequest) {
  const auth = await studioAuth(req);
  if (!auth.ok) return auth.res;
  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").slice(0, 80);
  const statusRaw = sp.get("status") ?? "all";
  if (!(STUDIO_STATUS_FILTERS as readonly string[]).includes(statusRaw)) return reject(400, "INVALID_FILTER", "Unknown status filter.");
  const pageRaw = sp.get("page") ?? "1";
  if (!/^\d{1,4}$/.test(pageRaw)) return reject(400, "INVALID_PAGE", "Invalid page.");
  try {
    return ok(await listStudioRooms(studioDeps(), auth.wallet, { q, status: statusRaw as StudioStatusFilter, page: Number(pageRaw) }));
  } catch (e) {
    return errorResponse(e);
  }
}
