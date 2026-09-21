/** Server-only Panta GET helper (live API). Do not invent routes. */

const UPSTREAM =
  process.env.PANTA_API_BASE_URL?.replace(/\/$/, "") ||
  "https://live-api.panta.market/api/v1";

export async function pantaServerGet<T>(path: string): Promise<T | null> {
  try {
    const key = process.env.PANTA_API_KEY?.trim();
    const headers: Record<string, string> = { Accept: "application/json" };
    if (key) headers["X-Api-Key"] = key;
    const res = await fetch(`${UPSTREAM}${path}`, {
      headers,
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
