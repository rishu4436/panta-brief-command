import { NextRequest, NextResponse } from "next/server";

const UPSTREAM =
  process.env.PANTA_API_BASE_URL?.replace(/\/$/, "") ||
  "https://live-api.panta.market/api/v1";

type Ctx = { params: Promise<{ path: string[] }> };

function decodeSeg(seg: string): string {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

async function forward(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  // Decode once (Next may leave encoded segments), then encode exactly once.
  const decoded = (path || []).map(decodeSeg);
  const suffix = decoded.map(encodeURIComponent).join("/");
  const url = new URL(`${UPSTREAM}/${suffix}/`);
  req.nextUrl.searchParams.forEach((value, key) => {
    url.searchParams.set(key, value);
  });

  const headers = new Headers();
  const serverKey = process.env.PANTA_API_KEY?.trim();
  const clientKey = req.headers.get("x-api-key");
  const apiKey = serverKey || clientKey;
  if (apiKey) headers.set("X-Api-Key", apiKey);

  const authorization = req.headers.get("authorization");
  if (authorization) headers.set("Authorization", authorization);
  const userId = req.headers.get("x-user-id");
  if (userId) headers.set("X-User-Id", userId);
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("Content-Type", contentType);
  headers.set("Accept", "application/json");

  const init: RequestInit = {
    method: req.method,
    headers,
    cache: "no-store",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.text();
  }

  try {
    let upstream = await fetch(url.toString(), init);
    let text = await upstream.text();

    // Retry without trailing slash on MARKET_NOT_FOUND (some gateways differ).
    if (
      upstream.status === 404 &&
      req.method === "GET" &&
      /MARKET_NOT_FOUND/i.test(text)
    ) {
      const alt = new URL(`${UPSTREAM}/${suffix}`);
      req.nextUrl.searchParams.forEach((value, key) => {
        alt.searchParams.set(key, value);
      });
      upstream = await fetch(alt.toString(), init);
      text = await upstream.text();
    }

    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("content-type") || "application/json",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "proxy_failed";
    return NextResponse.json(
      {
        code: "PROXY_UNREACHABLE",
        detail: message,
        upstream: UPSTREAM,
      },
      { status: 502 },
    );
  }
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const PUT = forward;
export const DELETE = forward;
