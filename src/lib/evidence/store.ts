import "server-only";

/**
 * Evidence persistence: the shared store (Upstash Redis list, newest first)
 * when configured, else an append-only JSON-lines log on local disk
 * (EVIDENCE_LOG_DIR, default <tmpdir>/panta-brief-evidence). On Vercel the
 * disk fallback is per instance and ephemeral, so configure the shared store
 * before collecting real evidence there; the API reports which one was used.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { EPHEMERAL_WARNING, guardStore, sharedStore, storeStatus } from "@/lib/shared-store";

export type EvidenceKind = "feedback" | "events";
export type EvidenceStore = "redis" | "file";

const MAX_ROWS: Record<EvidenceKind, number> = { feedback: 5_000, events: 50_000 };

function logPath(kind: EvidenceKind) {
  const dir = process.env.EVIDENCE_LOG_DIR?.trim() || path.join(os.tmpdir(), "panta-brief-evidence");
  return { dir, file: path.join(dir, `${kind}.jsonl`) };
}

/** What a client is told about where its row went (never pretends to be shared). */
export function evidenceStoreInfo(stored: EvidenceStore): { stored: EvidenceStore; shared: boolean; warning: string | null } {
  if (stored === "redis") return { stored, shared: true, warning: null };
  return {
    stored,
    shared: false,
    warning: storeStatus().configured
      ? "Shared store call failed; this row was written to the instance's temporary disk and may be lost."
      : EPHEMERAL_WARNING,
  };
}

export async function appendEvidence(kind: EvidenceKind, row: unknown): Promise<EvidenceStore> {
  const store = sharedStore();
  if (store) {
    try {
      await guardStore("evidence write", () => store.pushList(`evidence:${kind}`, row, MAX_ROWS[kind]));
      return "redis";
    } catch (e) {
      console.warn(`[evidence] shared store write failed, using file log:`, e instanceof Error ? e.message : e);
    }
  }
  const { dir, file } = logPath(kind);
  await fs.mkdir(dir, { recursive: true });
  await fs.appendFile(file, JSON.stringify(row) + "\n", "utf8");
  return "file";
}

/** Newest first, at most `max` rows. */
export async function readEvidence<T>(kind: EvidenceKind, max = MAX_ROWS[kind]): Promise<{ rows: T[]; store: EvidenceStore }> {
  const store = sharedStore();
  if (store) {
    try {
      return { rows: await guardStore("evidence read", () => store.readList<T>(`evidence:${kind}`, max)), store: "redis" };
    } catch (e) {
      console.warn(`[evidence] shared store read failed, using file log:`, e instanceof Error ? e.message : e);
    }
  }
  const { file } = logPath(kind);
  let text = "";
  try {
    text = await fs.readFile(file, "utf8");
  } catch {
    return { rows: [], store: "file" };
  }
  const rows: T[] = [];
  const lines = text.split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0 && rows.length < max; i--) {
    try {
      rows.push(JSON.parse(lines[i]) as T);
    } catch {
      /* skip corrupt line */
    }
  }
  return { rows, store: "file" };
}
