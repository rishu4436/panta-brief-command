"use client";

import { isValidAttributionRef } from "./panta/routes";
import type { Json } from "./types";

export class ApiError extends Error {
  status: number;
  body: Json;

  constructor(status: number, body: Json) {
    const code =
      body && typeof body === "object" && !Array.isArray(body) && "code" in body
        ? String((body as { code: unknown }).code)
        : `HTTP ${status}`;
    super(code);
    this.status = status;
    this.body = body;
  }
}

/**
 * Browser → Next.js proxy (/api/panta/*). The server injects its own X-Api-Key;
 * this client never sends a key. Only allowlisted routes are forwarded.
 */
export async function pantaFetch<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    query?: Record<string, string | undefined>;
    userId?: string;
  } = {},
): Promise<{ data: T; raw: Json }> {
  const method = options.method || "GET";
  const filtered: Record<string, string> = {};
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined && v !== "") filtered[k] = v;
    }
  }
  const qs =
    Object.keys(filtered).length > 0
      ? "?" + new URLSearchParams(filtered).toString()
      : "";
  const url = `/api/panta${path.startsWith("/") ? path : `/${path}`}${qs}`;

  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  // Attribution reference (user-supplied metadata, not identity). Only sent
  // when it passes the same charset check the proxy enforces.
  const userId = options.userId?.trim();
  if (userId && isValidAttributionRef(userId)) {
    headers["X-User-Id"] = userId;
  }

  let body: string | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  let parsed: Json = null;
  if (text) {
    try {
      parsed = JSON.parse(text) as Json;
    } catch {
      parsed = text;
    }
  }
  if (!res.ok) {
    throw new ApiError(res.status, parsed);
  }
  return { data: parsed as T, raw: parsed };
}
