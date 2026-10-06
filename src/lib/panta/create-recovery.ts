/**
 * Durable recovery record for a market creation whose transaction may have
 * been sent. Written BEFORE broadcast (as soon as the wallet returns the
 * signature) and updated on every post-broadcast step, so a refresh or crash
 * surfaces "check status" / "retry registration" with the exact frozen
 * createId + signature instead of inviting a second creation.
 *
 * Storage: localStorage, one key per wallet (`panta-brief:create-recovery:<wallet>`),
 * same try/catch pattern as src/lib/storage.ts. localStorage can be
 * unavailable (private mode, quota, disabled): save() then returns false and
 * the UI says so and keeps the signature on screen. It is per browser
 * profile, not synced across devices.
 */

import { z } from "@/lib/zod";
import { BASE58_PUBKEY_RE } from "./routes";
import { CREATE_ID_RE, SIGNATURE_RE } from "./create-market";

export const CREATE_RECOVERY_PREFIX = "panta-brief:create-recovery:";

export const RECOVERY_STAGES = ["signed", "broadcast", "confirmed", "registration_needs_attention"] as const;
export type RecoveryStage = (typeof RECOVERY_STAGES)[number];

const RecordSchema = z.strictObject({
  v: z.literal(1),
  wallet: z.string().regex(BASE58_PUBKEY_RE),
  createId: z.string().regex(CREATE_ID_RE),
  signature: z.string().regex(SIGNATURE_RE),
  expectedEventPda: z.string().regex(BASE58_PUBKEY_RE),
  marketType: z.enum(["standard", "breaking"]),
  paymentBase: z.string().regex(/^\d{1,15}$/),
  question: z.string().min(1).max(512),
  title: z.string().max(200).nullable(),
  recentBlockhash: z.string().regex(BASE58_PUBKEY_RE),
  lastValidBlockHeight: z.number().int().positive(),
  stage: z.enum(RECOVERY_STAGES),
  lastError: z.string().max(300).nullable(),
  savedAt: z.number().int().positive(),
});
export type CreateRecoveryRecord = z.infer<typeof RecordSchema>;

export type KV = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void; key?(i: number): string | null; length?: number };

export type CreateRecoveryStore = {
  /** true only if the record was written and read back identically. */
  save(rec: CreateRecoveryRecord): boolean;
  load(wallet: string): CreateRecoveryRecord | null;
  clear(wallet: string): void;
  /** Wallets with an unresolved record (for the "connect wallet X" banner). */
  wallets(): string[];
};

export function parseRecoveryRecord(raw: string | null): CreateRecoveryRecord | null {
  if (!raw) return null;
  try {
    const r = RecordSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export function createRecoveryStore(kv: () => KV | null): CreateRecoveryStore {
  const key = (w: string) => `${CREATE_RECOVERY_PREFIX}${w}`;
  return {
    save(rec) {
      const r = RecordSchema.safeParse(rec);
      if (!r.success) return false;
      const s = kv();
      if (!s) return false;
      try {
        const text = JSON.stringify(r.data);
        s.setItem(key(rec.wallet), text);
        return s.getItem(key(rec.wallet)) === text;
      } catch {
        return false;
      }
    },
    load(wallet) {
      const s = kv();
      if (!s) return null;
      try {
        const rec = parseRecoveryRecord(s.getItem(key(wallet)));
        return rec && rec.wallet === wallet ? rec : null;
      } catch {
        return null;
      }
    },
    clear(wallet) {
      try {
        kv()?.removeItem(key(wallet));
      } catch {
        /* ignore */
      }
    },
    wallets() {
      const s = kv();
      if (!s || typeof s.key !== "function" || typeof s.length !== "number") return [];
      const out: string[] = [];
      try {
        for (let i = 0; i < s.length; i++) {
          const k = s.key(i);
          if (k && k.startsWith(CREATE_RECOVERY_PREFIX)) {
            const w = k.slice(CREATE_RECOVERY_PREFIX.length);
            if (parseRecoveryRecord(s.getItem(k))?.wallet === w) out.push(w);
          }
        }
      } catch {
        return out;
      }
      return out;
    },
  };
}

/** Browser store (null-safe outside the browser). */
export const browserRecoveryStore = createRecoveryStore(() => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
});
