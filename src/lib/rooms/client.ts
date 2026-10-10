"use client";

/**
 * Browser side of Prediction Rooms: same-origin fetchers + TanStack hooks.
 * The server is the only authority for rooms; nothing here is persisted in
 * localStorage.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import bs58 from "bs58";
import { useEffect } from "react";
import type { Room } from "./domain";
import { announceSessionChange, browserSessionSync, expiryDelayMs, signInEvent } from "./session-sync";

export class RoomApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    /** Parsed error body (e.g. currentRevision on a forecast conflict). */
    public body: unknown = null,
  ) {
    super(message);
    this.name = "RoomApiError";
  }
}

/** Same-origin JSON call; non-2xx → RoomApiError with the server's code and safe message. */
export async function call<T>(url: string, init?: RequestInit): Promise<T> {
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
    throw new RoomApiError(res.status, b.code || `HTTP_${res.status}`, msg, body);
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

/**
 * Mount once (Providers): another tab's sign-in / sign-out / wallet switch
 * makes this tab re-read the session from the server (the message itself
 * authorises nothing), and the session is re-read once when it expires.
 */
export function useRoomSessionSync() {
  const qc = useQueryClient();
  const session = useRoomSession();
  const expiresAt = session.data?.expiresAt ?? null;
  useEffect(() => {
    const sync = browserSessionSync();
    if (!sync) return;
    return sync.subscribe(() => {
      void qc.invalidateQueries({ queryKey: roomKeys.session() });
    });
  }, [qc]);
  useEffect(() => {
    const delay = expiryDelayMs(expiresAt, Date.now());
    if (delay === null) return;
    const t = setTimeout(() => void qc.invalidateQueries({ queryKey: roomKeys.session() }), delay);
    return () => clearTimeout(t);
  }, [expiresAt, qc]);
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
  /** The wallet this browser was signed in as before, if any (labels the cross-tab event). */
  previousWallet?: string | null,
): Promise<RoomSessionState> {
  const ch = await call<{ nonce: string; message: string; wallet: string }>("/api/rooms/auth/challenge", {
    method: "POST",
    body: JSON.stringify({ wallet }),
  });
  if (ch.wallet !== wallet) throw new RoomApiError(400, "WALLET_MISMATCH", "The sign-in request named a different wallet.");
  const signature = await signMessage(new TextEncoder().encode(ch.message));
  const res = await call<RoomSessionState>("/api/rooms/auth/verify", {
    method: "POST",
    body: JSON.stringify({ nonce: ch.nonce, signature: bs58.encode(signature) }),
  });
  // Only after the server accepted the signature: other tabs re-read the session.
  announceSessionChange(signInEvent(previousWallet, wallet));
  return res;
}

/** Ends the room session (server clears the HttpOnly cookie), then tells other tabs to re-read it. */
export async function signOutRooms(): Promise<unknown> {
  const res = await call("/api/rooms/auth/session", { method: "DELETE" });
  announceSessionChange("signed-out");
  return res;
}

/**
 * Wallet-menu "Sign out": the existing logout (server clears the HttpOnly
 * cookie), then this tab re-reads the session; signOutRooms already told the
 * other tabs. The wallet stays connected; signing in again needs a fresh
 * challenge signature. If the request fails, the re-read still shows the truth.
 */
export async function signOutAndRefresh(qc: { invalidateQueries: (f: { queryKey: readonly unknown[] }) => Promise<unknown> }): Promise<{ ok: boolean }> {
  let ok = true;
  try {
    await signOutRooms();
  } catch {
    ok = false;
  }
  await qc.invalidateQueries({ queryKey: roomKeys.session() });
  return { ok };
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
