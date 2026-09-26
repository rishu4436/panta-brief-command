"use client";

import { useEffect, useRef, useState } from "react";
import type {
  BriefPayload,
  BriefTone,
  CatalogTradeRow,
  MarketCatalogItem,
} from "@/lib/types";
import { describeErr } from "@/lib/errors";
import { formatFriendlyIst } from "@/lib/format";
import { BriefMarkdown } from "./BriefMarkdown";
import { Panel } from "./Panel";

const AUTO_BRIEF = true;
const TONES: { id: BriefTone; label: string }[] = [
  { id: "bull", label: "Bull" },
  { id: "neutral", label: "Neutral" },
  { id: "bear", label: "Bear" },
];

export function AiBrief({
  market,
  tape,
  auto = false,
}: {
  market: MarketCatalogItem;
  tape: CatalogTradeRow[];
  auto?: boolean;
}) {
  const [brief, setBrief] = useState<BriefPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tone, setTone] = useState<BriefTone>("neutral");
  const ranFor = useRef<string | null>(null);

  const run = async (nextTone: BriefTone = tone) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Server fetches + sanitizes market/tape itself; send only id + tone.
        body: JSON.stringify({ marketId: market.marketId, tone: nextTone }),
      });
      const json = (await res.json()) as BriefPayload & {
        code?: string;
        detail?: string;
        tone?: BriefTone;
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

  useEffect(() => {
    if (!AUTO_BRIEF || !auto) return;
    if (!market?.marketId) return;
    const key = `${market.marketId}:${tone}`;
    if (ranFor.current === key) return;
    ranFor.current = key;
    void run(tone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, market.marketId, tape.length, tone]);

  const pickTone = (t: BriefTone) => {
    if (t === tone) {
      void run(t);
      return;
    }
    ranFor.current = null;
    setTone(t);
  };

  return (
    <Panel
      title="AI Brief"
      action={
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="min-h-[32px] rounded-md bg-cyan-400/15 px-2.5 py-1 text-[11px] font-semibold text-cyan-300 transition hover:bg-cyan-400/25 active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? "…" : brief ? "Regen" : "Generate"}
        </button>
      }
    >
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Brief tone">
        {TONES.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={tone === t.id}
            onClick={() => pickTone(t.id)}
            disabled={busy}
            className={`min-h-[36px] rounded-full border px-3 py-1.5 text-[11px] font-medium transition active:scale-[0.98] disabled:opacity-50 ${
              tone === t.id
                ? t.id === "bull"
                  ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-300"
                  : t.id === "bear"
                    ? "border-rose-400/40 bg-rose-500/15 text-rose-300"
                    : "border-cyan-400/40 bg-cyan-400/10 text-cyan-300"
                : "border-[#1f1f23] bg-[#0a0a0b] text-zinc-500 hover:border-[#2a2a2e] hover:text-zinc-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-2 rounded-md border border-rose-500/25 bg-rose-500/10 px-2.5 py-2 text-xs text-rose-200">
          {error}
        </div>
      )}
      {!brief && !error && (
        <div className="space-y-2">
          {busy ? (
            <>
              <div className="skeleton h-3 w-full" />
              <div className="skeleton h-3 w-5/6" />
              <div className="skeleton h-3 w-4/6" />
              <p className="type-lede pt-1">Generating desk narrative…</p>
            </>
          ) : (
            <p className="type-body text-zinc-500">
              Desk narrative from live prices + tape. Pick Bull / Neutral / Bear, then generate.
            </p>
          )}
        </div>
      )}
      {brief && (
        <div className="animate-fade-in">
          <div className="type-meta mb-2 flex flex-wrap items-center gap-2">
            <span
              className={`rounded border px-1.5 py-0.5 ${
                brief.source === "openai"
                  ? "border-cyan-400/30 text-cyan-400"
                  : "border-[#2a2a2e] text-zinc-500"
              }`}
            >
              {brief.source === "openai" ? "OpenAI" : "Template"}
            </span>
            <span className="rounded border border-[#1f1f23] px-1.5 py-0.5 capitalize text-zinc-500">
              {tone}
            </span>
            <span className="font-num">
              {formatFriendlyIst(brief.generatedAt)}
            </span>
          </div>
          <BriefMarkdown source={brief.narrative} />
        </div>
      )}
    </Panel>
  );
}
