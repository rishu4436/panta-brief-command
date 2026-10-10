"use client";

/**
 * Browser side of Prediction Rooms: same-origin fetchers + TanStack hooks.
 * The server is the only authority for rooms; nothing here is persisted in
 * localStorage.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import bs58 from "bs58";
import type { Room } from "./domain";

export class RoomApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "RoomApiError";
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      credentials: "same-origin",
      headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
      cache: "no-store",
    });
  } catch {
    throw new RoomApiError(0, "NETWORK", "Couldn't reach Brief Command. Check your connection and try again.");
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const b = (body ?? {}) as { code?: string; detail?: string };
    const msg =
      b.detail ||
      (res.status === 429 ? "Too many requests. Wait a minute and try again." : `Request failed (HTTP ${res.status}).`);
    throw new RoomApiError(res.status, b.code || `HTTP_${res.status}`, msg);
  }
  return body as T;
}

export const roomKeys = {
  list: () => ["rooms", "list"] as const,
  session: () => ["rooms", "session"] as const,
};

export function fetchRooms(): Promise<{ rooms: Room[] }> {
  return call("/api/rooms?limit=50");
}

export function useRooms() {
  return useQuery({ queryKey: roomKeys.list(), queryFn: fetchRooms, staleTime: 30_000, retry: 1 });
}

export type RoomSessionState = { wallet: string | null; expiresAt: string | null };

export function useRoomSession() {
  return useQuery({
    queryKey: roomKeys.session(),
    queryFn: () => call<RoomSessionState>("/api/rooms/auth/session"),
    staleTime: 15_000,
    retry: 1,
  });
}

export function useInvalidateRooms() {
  const qc = useQueryClient();
  return {
    session: () => qc.invalidateQueries({ queryKey: roomKeys.session() }),
    list: () => qc.invalidateQueries({ queryKey: roomKeys.list() }),
  };
}

/**
 * Challenge → wallet.signMessage → verify. Costs nothing and moves no funds:
 * signMessage signs plain text; no transaction is built or sent.
 */
export async function verifyWalletOwnership(
  wallet: string,
  signMessage: (message: Uint8Array) => Promise<Uint8Array>,
): Promise<RoomSessionState> {
  const ch = await call<{ nonce: string; message: string; wallet: string }>("/api/rooms/auth/challenge", {
    method: "POST",
    body: JSON.stringify({ wallet }),
  });
  if (ch.wallet !== wallet) throw new RoomApiError(400, "WALLET_MISMATCH", "The sign-in request named a different wallet.");
  const signature = await signMessage(new TextEncoder().encode(ch.message));
  return call<RoomSessionState>("/api/rooms/auth/verify", {
    method: "POST",
    body: JSON.stringify({ nonce: ch.nonce, signature: bs58.encode(signature) }),
  });
}

export function signOutRooms(): Promise<unknown> {
  return call("/api/rooms/auth/session", { method: "DELETE" });
}

export type SlugCheck = { slug: string; available: boolean; reason: string | null; message: string | null };

export function checkSlug(slug: string, signal?: AbortSignal): Promise<SlugCheck> {
  return call(`/api/rooms/slug-check?slug=${encodeURIComponent(slug)}`, { signal });
}

export type CreateRoomRequest = {
  title: string;
  description: string;
  slug: string;
  marketId: string;
  visibility: "public" | "unlisted";
  idempotencyKey: string;
};

export function createRoomRequest(body: CreateRoomRequest): Promise<{ status: "created" | "replayed"; room: Room; url: string }> {
  return call("/api/rooms", { method: "POST", body: JSON.stringify(body) });
}

/** 32 url-safe random chars for one create attempt. */
export function newIdempotencyKey(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
