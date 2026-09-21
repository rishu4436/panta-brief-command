"use client";

import { useState } from "react";
import type {
  BriefPayload,
  CatalogTradeRow,
  MarketCatalogItem,
} from "@/lib/types";
import { describeErr } from "@/lib/errors";
import { GlassCard } from "./GlassCard";

export function AiBrief({
  market,
  tape,
}: {
  market: MarketCatalogItem;
  tape: CatalogTradeRow[];
}) {
  const [brief, setBrief] = useState<BriefPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ market, tape }),
      });
      const json = (await res.json()) as BriefPayload & {
        code?: string;
        detail?: string;
      };
      if (!res.ok) {
        throw new Error(json.detail || json.code || `HTTP ${res.status}`);
      }
      setBrief(json);
    } catch (e) {
      setError(describeErr(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <GlassCard
      title="AI Brief"
      action={
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="rounded-md bg-gradient-to-r from-cyan-500 to-violet-500 px-3 py-1 text-[11px] font-semibold text-slate-950 shadow-lg shadow-cyan-500/20 disabled:opacity-50"
        >
          {busy ? "Generating…" : brief ? "Regenerate" : "Generate brief"}
        </button>
      }
    >
      {error && (
        <div className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {error}
        </div>
      )}
      {!brief && !error && (
        <p className="text-sm text-zinc-400">
          Desk narrative from live detail prices + trade tape. Templated by
          default; set <code className="text-cyan-300/80">OPENAI_API_KEY</code>{" "}
          for LLM briefs.
        </p>
      )}
      {brief && (
        <div>
          <div className="mb-2 flex items-center gap-2 text-[11px] text-zinc-500">
            <span
              className={`rounded-full border px-2 py-0.5 ${
                brief.source === "openai"
                  ? "border-violet-400/40 text-violet-300"
                  : "border-cyan-400/40 text-cyan-300"
              }`}
            >
              {brief.source === "openai" ? "OpenAI" : "Template"}
            </span>
            <span>
              {new Date(brief.generatedAt).toLocaleString("en-IN", {
                timeZone: "Asia/Calcutta",
              })}{" "}
              IST
            </span>
          </div>
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-zinc-200">
            {brief.narrative}
          </pre>
        </div>
      )}
    </GlassCard>
  );
}
