import { humanError, isErrorCode } from "./error-messages";

/**
 * One line for the UI. Error bodies `{ code, detail }` go through the single
 * code → message mapping (error-messages.ts); a raw code is never the whole
 * message (it is kept as a short "ref" for support).
 */
export function describeErr(e: unknown): string {
  if (!e) return "Unknown error";
  if (typeof e === "string") return isErrorCode(e) ? humanError(e) : e;
  if (e instanceof Error) {
    const any = e as Error & { body?: unknown; status?: number };
    if (any.body && typeof any.body === "object" && any.body !== null) {
      const b = any.body as Record<string, unknown>;
      const code = b.code ? String(b.code) : b.error && isErrorCode(String(b.error)) ? String(b.error) : undefined;
      const detailRaw = b.detail ?? b.message;
      const detail = detailRaw
        ? typeof detailRaw === "string"
          ? detailRaw
          : JSON.stringify(detailRaw)
        : undefined;
      if (code) return humanError(code, detail, any.status);
      if (detail) return detail;
    }
    const msg = tidyWalletMessage(e.message);
    if (msg && isErrorCode(msg)) return humanError(msg, null, any.status);
    return msg || "Error";
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/**
 * web3.js appends developer instructions to SendTransactionError messages
 * ("Catch the `SendTransactionError` and call `getLogs()`…"). Users only need
 * the reason, so drop the hint and fold "Simulation failed. Message:" into one line.
 */
export function tidyWalletMessage(msg: string): string {
  return msg
    .replace(/\s*Catch the `SendTransactionError` and call `getLogs\(\)` on it for full details\.?/g, "")
    .replace(/Simulation failed\.\s*Message:\s*/i, "Simulation failed: ")
    .replace(/Transaction simulation failed:\s*/i, "")
    .trim();
}
