/**
 * Cross-tab room-session sync. When a tab signs in, signs out or switches the
 * signed-in wallet, it announces ONLY the event type to its other tabs.
 *
 * Security model: the message is a hint, never proof. It carries no wallet,
 * token, signature, nonce or session data; receivers ignore everything but a
 * known event type and respond by re-reading GET /api/rooms/auth/session (the
 * HttpOnly cookie stays the only authority). A forged message can at most
 * trigger one extra same-origin read.
 *
 * Loops: each message has a random id; a tab ignores ids it has seen (its own
 * included) and never re-announces on receive. No polling: expiry is a single
 * timer per tab at the session's expiresAt (every tab shares the cookie, so
 * each one notices on its own).
 *
 * Transport: BroadcastChannel; storage events on browsers without it.
 */

export const SESSION_SYNC_CHANNEL = "pbc-rooms-session";
export const SESSION_SYNC_STORAGE_KEY = "pbc-rooms-session-sync";

export const SESSION_SYNC_EVENTS = ["signed-in", "signed-out", "wallet-changed", "expired"] as const;
export type SessionSyncEvent = (typeof SESSION_SYNC_EVENTS)[number];

type Wire = { v: 1; type: SessionSyncEvent; id: string };

const ID_RE = /^[A-Za-z0-9_-]{8,40}$/;
const MAX_SEEN = 64;

/** Only {v:1, type, id}; anything else (extra claims included) is dropped. */
export function parseSyncMessage(raw: unknown): Wire | null {
  let v: unknown = raw;
  if (typeof v === "string") {
    if (v.length > 200) return null;
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== 3 || o.v !== 1 || typeof o.id !== "string" || !ID_RE.test(o.id)) return null;
  if (typeof o.type !== "string" || !(SESSION_SYNC_EVENTS as readonly string[]).includes(o.type)) return null;
  return { v: 1, type: o.type as SessionSyncEvent, id: o.id };
}

type ChannelLike = { postMessage(m: unknown): void; close(): void; onmessage: ((e: { data: unknown }) => void) | null };
type StorageLike = { setItem(k: string, v: string): void; removeItem(k: string): void };
type StorageEventLike = { key: string | null; newValue: string | null };

export type SessionSyncEnv = {
  createChannel?: ((name: string) => ChannelLike) | null;
  storage?: StorageLike | null;
  /** Subscribe to storage events (fallback transport); returns unsubscribe. */
  onStorage?: ((fn: (e: StorageEventLike) => void) => () => void) | null;
  randomId?: () => string;
};

export type SessionSync = {
  announce(type: SessionSyncEvent): void;
  subscribe(fn: (type: SessionSyncEvent) => void): () => void;
  close(): void;
};

function defaultId(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function createSessionSync(env: SessionSyncEnv): SessionSync {
  const seen = new Set<string>();
  const listeners = new Set<(t: SessionSyncEvent) => void>();
  const remember = (id: string) => {
    seen.add(id);
    if (seen.size > MAX_SEEN) seen.delete(seen.values().next().value as string);
  };
  const receive = (raw: unknown) => {
    const m = parseSyncMessage(raw);
    if (!m || seen.has(m.id)) return;
    remember(m.id);
    // Deliver only the type. Never re-announce here.
    for (const fn of [...listeners]) {
      try {
        fn(m.type);
      } catch {
        /* a listener error must not break the others */
      }
    }
  };

  let channel: ChannelLike | null = null;
  try {
    channel = env.createChannel ? env.createChannel(SESSION_SYNC_CHANNEL) : null;
  } catch {
    channel = null;
  }
  let offStorage: (() => void) | null = null;
  if (channel) {
    channel.onmessage = (e) => receive(e?.data);
  } else if (env.onStorage) {
    offStorage = env.onStorage((e) => {
      if (e.key === SESSION_SYNC_STORAGE_KEY && e.newValue) receive(e.newValue);
    });
  }

  return {
    announce(type) {
      if (!(SESSION_SYNC_EVENTS as readonly string[]).includes(type)) return;
      const id = (env.randomId ?? defaultId)();
      remember(id);
      const msg: Wire = { v: 1, type, id };
      try {
        if (channel) channel.postMessage(msg);
        else if (env.storage) {
          // The storage event fires in OTHER tabs only; remove right away (nothing lingers).
          env.storage.setItem(SESSION_SYNC_STORAGE_KEY, JSON.stringify(msg));
          env.storage.removeItem(SESSION_SYNC_STORAGE_KEY);
        }
      } catch {
        /* best effort: other tabs still catch up on their next session read */
      }
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    close() {
      listeners.clear();
      offStorage?.();
      try {
        channel?.close();
      } catch {
        /* ignore */
      }
    },
  };
}

let instance: SessionSync | null = null;

/** The browser's singleton (null on the server). */
export function browserSessionSync(): SessionSync | null {
  if (typeof window === "undefined") return null;
  if (instance) return instance;
  let storage: StorageLike | null = null;
  try {
    storage = window.localStorage;
  } catch {
    storage = null;
  }
  instance = createSessionSync({
    createChannel: typeof BroadcastChannel === "function" ? (name) => new BroadcastChannel(name) as unknown as ChannelLike : null,
    storage,
    onStorage: (fn) => {
      const h = (e: StorageEvent) => fn({ key: e.key, newValue: e.newValue });
      window.addEventListener("storage", h);
      return () => window.removeEventListener("storage", h);
    },
  });
  return instance;
}

export function announceSessionChange(type: SessionSyncEvent): void {
  browserSessionSync()?.announce(type);
}

/** Which event a completed local sign-in is, given the wallet signed in before (if known). */
export function signInEvent(previousWallet: string | null | undefined, wallet: string): SessionSyncEvent {
  return previousWallet && previousWallet !== wallet ? "wallet-changed" : "signed-in";
}

/** ms until this tab should re-read an expiring session (null: nothing to schedule). */
export function expiryDelayMs(expiresAt: string | null | undefined, nowMs: number): number | null {
  if (!expiresAt) return null;
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return null;
  // +1 s so the server agrees it has expired; clamp to setTimeout's max.
  return Math.min(Math.max(0, t - nowMs + 1_000), 2_147_000_000);
}
