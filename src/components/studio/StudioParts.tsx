"use client";

import { useState } from "react";
import { NOT_TRACKED, type Insight } from "@/lib/studio/domain";
import { StatusBadge, type StatusTone } from "../ui/StatusBadge";

/** One metric with its definition. `value === null` → "Not tracked yet" (never a fake 0). */
export function Metric({ label, value, definition, sub }: { label: string; value: number | string | null; definition: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-inset/40 p-3">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-3">{label}</dt>
      <dd className="mt-1">
        {value === null ? (
          <span className="text-[14px] font-medium text-ink-3">{NOT_TRACKED}</span>
        ) : (
          <span className="font-num text-[22px] font-semibold text-ink">{typeof value === "number" ? value.toLocaleString("en-US") : value}</span>
        )}
        {sub ? <span className="ml-1.5 text-[11px] text-ink-3">{sub}</span> : null}
        <p className="mt-1 text-[11px] leading-snug text-ink-3">{definition}</p>
      </dd>
    </div>
  );
}

const INSIGHT_TONE: Record<Insight["tone"], StatusTone> = { info: "info", positive: "success", attention: "warning" };
const INSIGHT_LABEL: Record<Insight["tone"], string> = { info: "Note", positive: "Going well", attention: "Worth a look" };

export function InsightsList({ insights }: { insights: Insight[] }) {
  if (!insights.length) return <p className="text-[12px] text-ink-3">No insights from the current numbers.</p>;
  return (
    <ul className="space-y-2.5">
      {insights.map((i) => (
        <li key={i.id} className="rounded-xl border border-line bg-inset/40 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={INSIGHT_TONE[i.tone]} size="xs">
              {INSIGHT_LABEL[i.tone]}
            </StatusBadge>
            <p className="text-[13px] font-semibold text-ink">{i.title}</p>
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-2">{i.detail}</p>
          <p className="mt-1 text-[11px] text-ink-3">Based on: {i.basis}</p>
        </li>
      ))}
    </ul>
  );
}

export function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
    } catch {
      setCopied(`${key}:failed`);
    }
    setTimeout(() => setCopied(null), 2000);
  };
  const label = (key: string, idle: string) => (copied === key ? "Copied" : copied === `${key}:failed` ? "Copy failed" : idle);
  return { copy, label };
}

export const formatPct = (bps: number | null) => (bps === null ? "—" : `${(bps / 100).toFixed(1)}%`);
