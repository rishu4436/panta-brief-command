"use client";

import { useState } from "react";
import type { BriefPayload } from "@/lib/types";
import { anonId, usageEnabled } from "@/lib/telemetry";

type Thumb = "up" | "down" | null;

function Thumbs({ label, value, onChange }: { label: string; value: Thumb; onChange: (v: Thumb) => void }) {
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={label}>
      <span className="text-[12px] text-ink-2">{label}</span>
      {(["up", "down"] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(value === v ? null : v)}
          className={`inline-flex h-9 min-w-9 items-center justify-center rounded-md border px-2 text-[14px] transition ${
            value === v ? "border-cyan-400/50 bg-cyan-400/10 text-cyan-200" : "border-line text-ink-3 hover:border-line-strong hover:text-ink"
          }`}
        >
          <span aria-hidden="true">{v === "up" ? "👍" : "👎"}</span>
          <span className="sr-only">{v === "up" ? "Yes" : "No"}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * "Useful? / Accurate?" rating for one brief, with an optional comment.
 * Stored first-party via /api/feedback with the brief's source, mode and
 * signals version — never shown back as aggregate data in the app.
 */
export function BriefFeedback({ brief }: { brief: BriefPayload }) {
  const [useful, setUseful] = useState<Thumb>(null);
  const [accurate, setAccurate] = useState<Thumb>(null);
  const [comment, setComment] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const key = `${brief.market.marketId}:${brief.mode}:${brief.generatedAt}`;
  const [sentKey, setSentKey] = useState<string | null>(null);

  const canSend = useful != null || accurate != null || comment.trim().length > 0;

  const send = async () => {
    setState("sending");
    setErr(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(usageEnabled() && anonId() ? { anonId: anonId() } : {}),
          marketId: brief.market.marketId,
          mode: brief.mode,
          useful,
          accurate,
          ...(comment.trim() ? { comment: comment.trim().slice(0, 500) } : {}),
          briefSource: brief.source,
          signalsVersion: brief.signals.version,
          generatedAt: brief.generatedAt,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { detail?: string; code?: string };
        throw new Error(res.status === 429 ? "Too many ratings in a minute, try again shortly." : j.detail || j.code || `HTTP ${res.status}`);
      }
      setState("sent");
      setSentKey(key);
    } catch (e) {
      setState("error");
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  if (state === "sent" && sentKey === key) {
    return <p className="mt-3 text-[12px] text-ink-3" role="status">Thanks — your rating of this brief was recorded.</p>;
  }

  return (
    <div className="mt-3 rounded-lg border border-line bg-surface/60 p-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Thumbs label="Useful?" value={useful} onChange={setUseful} />
        <Thumbs label="Accurate?" value={accurate} onChange={setAccurate} />
      </div>
      <label className="mt-2 block text-[12px] text-ink-3">
        <span className="sr-only">Comment (optional)</span>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value.slice(0, 500))}
          rows={2}
          maxLength={500}
          placeholder="Optional: what was useful, wrong or missing? (no personal data please)"
          className="field mt-1 min-h-[56px] text-[13px]"
        />
      </label>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-ink-3">Sent to Brief Command only, with this brief&apos;s mode and source. No wallet, no IP stored.</span>
        <button type="button" className="btn btn-secondary btn-sm" disabled={!canSend || state === "sending"} onClick={() => void send()}>
          {state === "sending" ? "Sending…" : "Send feedback"}
        </button>
      </div>
      {state === "error" && err ? (
        <p className="mt-2 text-[12px] text-rose-300" role="alert">
          Couldn&apos;t send: {err}
        </p>
      ) : null}
    </div>
  );
}
