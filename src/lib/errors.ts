export function describeErr(e: unknown): string {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  if (e instanceof Error) {
    const any = e as Error & { body?: unknown; status?: number };
    if (any.body && typeof any.body === "object" && any.body !== null) {
      const b = any.body as Record<string, unknown>;
      const code = b.code ? String(b.code) : undefined;
      const detailRaw = b.detail ?? b.message;
      const detail = detailRaw
        ? typeof detailRaw === "string"
          ? detailRaw
          : JSON.stringify(detailRaw)
        : undefined;
      if (code && detail) return `${code}: ${detail}`;
      if (code) return code;
      if (detail) return detail;
    }
    return tidyWalletMessage(e.message) || "Error";
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
