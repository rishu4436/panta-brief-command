/**
 * Tape (trade prints) display state. Keeps three things apart that must never
 * be merged: a failed tape request, a tape that loaded with zero prints, and
 * a tape whose data could not be read. A failure is never shown as "no prints".
 */
import { describeErr } from "@/lib/errors";

export type TapeState =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "empty" }
  | { kind: "ok"; count: number; refreshFailed: string | null };

export function tapeState<T>(q: { isPending: boolean; isError: boolean; data: T[] | undefined; error: unknown }): TapeState {
  if (q.isError && !q.data) return { kind: "failed", message: describeErr(q.error) };
  if (q.data === undefined) return q.isPending ? { kind: "loading" } : { kind: "failed", message: describeErr(q.error) };
  if (q.data.length === 0) {
    // A refetch error on top of an earlier empty result is still a failure now.
    return q.isError ? { kind: "failed", message: describeErr(q.error) } : { kind: "empty" };
  }
  return { kind: "ok", count: q.data.length, refreshFailed: q.isError ? describeErr(q.error) : null };
}

/** "Prints in window" cell: a number only when the tape actually loaded. */
export function printsLabel(s: TapeState): string {
  return s.kind === "loading" ? "…" : s.kind === "failed" ? "Unavailable" : s.kind === "empty" ? "0" : String(s.count);
}

export type HotTapeSummary = { title: "Tape unavailable" | "Tape partly unavailable" | "Tape quiet"; message: string } | null;

/** Empty-state copy for the Hot tape rail (null when there are prints to show or it is still loading). */
export function hotTapeSummary(input: {
  catalogError: boolean;
  targets: number;
  failed: number;
  succeeded: number;
  busy: boolean;
  hits: number;
}): HotTapeSummary {
  const { catalogError, targets, failed, succeeded, busy, hits } = input;
  if (catalogError && targets === 0) return { title: "Tape unavailable", message: "Market catalog failed to load, so no tape was requested." };
  if (targets === 0) return { title: "Tape quiet", message: "No visible markets to scan yet." };
  if (busy || hits > 0) return null;
  if (failed > 0 && succeeded === 0) {
    return {
      title: "Tape unavailable",
      message: `Tape request failed for all ${failed} market${failed === 1 ? "" : "s"} — this is an error, not a quiet book.`,
    };
  }
  if (failed > 0) {
    return {
      title: "Tape partly unavailable",
      message: `No prints on ${succeeded} scanned book${succeeded === 1 ? "" : "s"}; the tape request failed for ${failed} more.`,
    };
  }
  return { title: "Tape quiet", message: `Quiet on ${succeeded} scanned book${succeeded === 1 ? "" : "s"} — no recent prints yet.` };
}
