import "server-only";

/**
 * Embed responses: HTML with the embed-only security headers (the one place
 * framing is allowed), never cookies, never a session read.
 */

import { embedSecurityHeaders } from "@/lib/security-headers";
import { renderEmbedNotFound } from "./html";
import type { EmbedOptions } from "./options";
import { EMBED_CSS_HASH } from "./styles";

/** Same caching for found and not-found pages so the two can't be told apart by headers. */
export const EMBED_CACHE_CONTROL = "public, max-age=30, s-maxage=30, stale-while-revalidate=60";

export const EMBED_RATE_LIMIT_PER_MIN = 120;

export function embedHtml(html: string, status = 200, cacheControl = EMBED_CACHE_CONTROL): Response {
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": cacheControl,
      ...embedSecurityHeaders(EMBED_CSS_HASH),
    },
  });
}

export const embedNotFound = (o: EmbedOptions, homeUrl: string) => embedHtml(renderEmbedNotFound(o, homeUrl), 404);
