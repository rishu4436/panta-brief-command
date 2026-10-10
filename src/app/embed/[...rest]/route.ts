import { NextRequest } from "next/server";
import { parseEmbedOptions } from "@/lib/embed/options";
import { appOrigin } from "@/lib/embed/origin";
import { embedNotFound } from "@/lib/embed/respond";

export const dynamic = "force-dynamic";

/** Every other /embed/** path: the same not-found widget, with the embed headers (not the app's). */
export async function GET(req: NextRequest): Promise<Response> {
  return embedNotFound(parseEmbedOptions(req.nextUrl.searchParams), appOrigin());
}
