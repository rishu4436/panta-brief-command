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
    return e.message || "Error";
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
