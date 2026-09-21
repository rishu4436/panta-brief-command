"use client";

import { useState } from "react";
import type {
  BriefPayload,
  CatalogTradeRow,
  MarketCatalogItem,
} from "@/lib/types";
import { describeErr } from "@/lib/errors";
import { Panel } from "./Panel";

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
    <Panel
      title="AI Brief"
      action={
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="rounded-md border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 text-[11px] font-medium text-cyan-300 transition hover:bg-cyan-400/20 disabled:opacity-50"
        >
          {busy ? "…" : brief ? "Regen" : "Generate"}
        </button>
      }
    >
      {error && (
        <div className="mb-2 rounded-md border border-rose-500/25 bg-rose-500/10 px-2.5 py-2 text-xs text-rose-200">
          {error}
        </div>
      )}
      {!brief && !error && (
        <p className="text-[12px] leading-relaxed text-zinc-500">
          Desk narrative from live prices + tape. Templated by default.
        </p>
      )}
      {brief && (
        <div className="animate-fade-in">
          <div className="mb-2 flex items-center gap-2 text-[10px] text-zinc-600">
            <span
              className={`rounded border px-1.5 py-0.5 ${
                brief.source === "openai"
                  ? "border-cyan-400/30 text-cyan-400"
                  : "border-[#2a2a2e] text-zinc-500"
              }`}
            >
              {brief.source === "openai" ? "OpenAI" : "Template"}
            </span>
            <span className="font-num">
              {new Date(brief.generatedAt).toLocaleString("en-IN", {
                timeZone: "Asia/Calcutta",
              })}{" "}
              IST
            </span>
          </div>
          <pre className="whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-zinc-300">
            {brief.narrative}
          </pre>
        </div>
      )}
    </Panel>
  );
}
