import "server-only";

/**
 * The model boundary for the AI Debate Arena. Same provider and key as the
 * AI Brief (OpenAI chat completions, OPENAI_API_KEY / OPENAI_MODEL), with
 * JSON-object output, no tools, low temperature, an output-token cap and a
 * timeout. No key → "unavailable" (the arena says so; nothing is invented).
 *
 * Tests replace this boundary through debate deps (deps.ts); no test ever
 * calls a real model.
 */

export type ModelUsage = { inputTokens: number | null; outputTokens: number | null };
export type ModelCall =
  | { kind: "ok"; content: string; usage: ModelUsage }
  | { kind: "unavailable"; reason: string }
  | { kind: "failed"; reason: string };

export type ModelRequest = { system: string; user: string; maxOutputTokens: number; timeoutMs: number };

export interface DebateModel {
  readonly provider: string;
  readonly model: string;
  available(): boolean;
  complete(req: ModelRequest): Promise<ModelCall>;
}

export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

export function openAiDebateModel(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): DebateModel {
  const key = () => (env.OPENAI_API_KEY || "").trim();
  const model = (env.OPENAI_MODEL || "").trim() || DEFAULT_OPENAI_MODEL;
  return {
    provider: "openai",
    model,
    available: () => key().length > 0,
    async complete(req) {
      const apiKey = key();
      if (!apiKey) return { kind: "unavailable", reason: "OPENAI_API_KEY is not configured" };
      let res: Response;
      try {
        res = await fetchImpl("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          signal: AbortSignal.timeout(req.timeoutMs),
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            temperature: 0.2,
            max_completion_tokens: req.maxOutputTokens,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: req.system },
              { role: "user", content: req.user },
            ],
          }),
        });
      } catch (e) {
        return { kind: "failed", reason: e instanceof Error && e.name === "TimeoutError" ? "model timed out" : "model request failed" };
      }
      if (res.status === 401 || res.status === 403) return { kind: "unavailable", reason: `model provider rejected the key (HTTP ${res.status})` };
      if (!res.ok) return { kind: "failed", reason: `model provider error (HTTP ${res.status})` };
      let json: { choices?: { message?: { content?: string }; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      try {
        json = await res.json();
      } catch {
        return { kind: "failed", reason: "model returned non-JSON" };
      }
      const choice = json.choices?.[0];
      const content = choice?.message?.content?.trim();
      if (!content) return { kind: "failed", reason: "model returned no content" };
      if (choice?.finish_reason === "length") return { kind: "failed", reason: "model output hit the token cap" };
      return { kind: "ok", content, usage: { inputTokens: json.usage?.prompt_tokens ?? null, outputTokens: json.usage?.completion_tokens ?? null } };
    },
  };
}
