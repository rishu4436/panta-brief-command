import "server-only";

/**
 * Brief narrative = interpretation of precomputed signals.
 *
 * Both paths (OpenAI and the deterministic template) read the same
 * MarketSignals object from src/lib/panta/signals.ts. Neither recomputes
 * numbers, and neither gives buy/sell recommendations. Every brief has four
 * sections: Observation · Evidence · Risk · Execution considerations.
 */

import { catalogText, type MarketSignals } from "./panta/signals";
import { BRIEF_MODES } from "./brief-modes";
import type { BriefMode, Market } from "./types";

const SECTION_HEADERS = [
  "### Observation",
  "### Evidence",
  "### Risk",
  "### Execution considerations",
] as const;

/**
 * Deterministic guard: phrases that read as trading advice. An LLM answer that
 * matches is discarded in favour of the template.
 */
const ADVICE_RE =
  /\b(you should|we recommend|i recommend|recommend(?:ed|s)? (?:buying|selling|a position)|consider (?:buying|selling|going|entering|adding)|buy now|sell now|go long|go short|take a position|size (?:up|down|carefully|your)|requires? conviction|prefer (?:primary )?(?:yes|no)|good entry|attractive entry|undervalued|overvalued|strong buy|strong sell)\b/i;

export function containsAdvice(text: string): boolean {
  return ADVICE_RE.test(text);
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const pct = (n: number | null, dp = 1) => (n == null ? "—" : `${(n * 100).toFixed(dp)}%`);

function istTime(unixSec: number | null): string {
  if (unixSec == null) return "n/a";
  return (
    new Date(unixSec * 1000).toLocaleString("en-IN", {
      timeZone: "Asia/Calcutta",
      dateStyle: "medium",
      timeStyle: "short",
    }) + " IST"
  );
}

function duration(minutes: number | null): string {
  if (minutes == null) return "n/a";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 48 * 60) return `${(minutes / 60).toFixed(minutes < 600 ? 1 : 0)}h`;
  return `${(minutes / 1440).toFixed(1)}d`;
}

const num = (n: number | null, dp = 2) =>
  n == null ? "n/a" : n.toLocaleString("en-US", { maximumFractionDigits: dp });

function sourceLabel(s: MarketSignals["probability"]["source"]): string {
  if (s === "settled") return "settlement";
  if (s === "spot") return "live spot";
  if (s === "primary_curve") return "primary curve";
  return "unpriced";
}

function question(m: Market): string {
  return (m.title || "").trim() || "Untitled market";
}

// ---------------------------------------------------------------------------
// Shared evidence lines (derived only from signals)
// ---------------------------------------------------------------------------

function probabilityLine(s: MarketSignals): string {
  if (s.probability.yes == null) return "No market price is available.";
  return `Market probability: YES ${pct(s.probability.yes)} / NO ${pct(s.probability.no)} (${sourceLabel(s.probability.source)}).`;
}

function flowLine(s: MarketSignals): string {
  if (s.flow.yesFlowShare == null) return "Flow: no sided prints in the window.";
  const basis = s.flow.basis === "shares" ? "share-weighted" : "print-weighted";
  return `Flow (${basis}): YES ${pct(s.flow.yesFlowShare)} · NO ${pct(1 - s.flow.yesFlowShare)} across ${s.tape.count} prints (${s.tape.yesPrints} YES / ${s.tape.noPrints} NO).`;
}

function divergenceLine(s: MarketSignals): string {
  const d = s.divergence;
  if (d.gapPts == null) return `Price vs flow: not compared — ${d.reason || "insufficient data"}`;
  if (d.direction === "aligned") return `Price vs flow: aligned (flow ${d.gapPts >= 0 ? "+" : ""}${d.gapPts} pts vs price).`;
  return `Price vs flow: flow is ${Math.abs(d.gapPts)} pts ${d.direction === "flow_above_price" ? "above" : "below"} the market's YES probability.`;
}

function windowLine(s: MarketSignals): string {
  if (s.tape.count === 0) return "Tape window: empty.";
  return `Tape window: ${s.tape.count} prints over ${duration(s.tape.windowMinutes)}; last print ${duration(s.tape.lastPrintAgeMinutes)} ago.`;
}

function volumeLine(s: MarketSignals): string {
  const parts: string[] = [];
  if (s.volume.catalogUsdc != null) parts.push(`catalog volume ${num(s.volume.catalogUsdc)} USDC (lifetime)`);
  if (s.volume.recentUsdc != null) parts.push(`${num(s.volume.recentUsdc)} USDC in the window`);
  else if (s.volume.recentShares != null) parts.push(`${num(s.volume.recentShares)} shares in the window`);
  return parts.length ? `Volume: ${parts.join("; ")}.` : "Volume: not reported.";
}

function resolutionLine(s: MarketSignals): string {
  const r = s.resolution;
  if (r.resolutionTime == null) return "Resolution time: not provided.";
  if (r.passed) return `Resolution time ${istTime(r.resolutionTime)} has passed${s.resolved ? "" : " — settlement pending"}.`;
  return `Resolution: ${istTime(r.resolutionTime)} (in ${duration(r.minutesToResolution)}).`;
}

function riskLines(s: MarketSignals, filter?: (id: string) => boolean): string[] {
  const flags = filter ? s.riskFlags.filter((f) => filter(f.id)) : s.riskFlags;
  const lines = flags.map((f) => `- ${f.label}`);
  lines.push(`- Data quality **${s.dataQuality.grade.toUpperCase()}** — ${s.dataQuality.reasons.join("; ")}`);
  return lines;
}

const bullets = (xs: string[]) => xs.map((x) => (x.startsWith("- ") ? x : `- ${x}`)).join("\n");

// ---------------------------------------------------------------------------
// Template (no-LLM) narrative
// ---------------------------------------------------------------------------

const FLOW_FLAGS = new Set([
  "no_tape",
  "thin_tape",
  "stale_last_print",
  "one_sided_flow",
  "concentrated_flow",
  "flow_price_divergence",
]);

export function buildTemplateBrief(
  market: Market,
  s: MarketSignals,
  mode: BriefMode = "desk",
): string {
  let observation: string;
  let evidence: string[];
  let risk: string[];

  if (mode === "flow") {
    observation = s.headline;
    evidence = [
      flowLine(s),
      s.flow.imbalance != null
        ? `Imbalance ${s.flow.imbalance >= 0 ? "+" : ""}${s.flow.imbalance.toFixed(2)} on a −1 (all NO) to +1 (all YES) scale.`
        : "Imbalance: not computable.",
      `Primary prints ${s.tape.primaryPrints} · secondary ${s.tape.secondaryPrints}${s.tape.unknownSidePrints ? ` · ${s.tape.unknownSidePrints} without a side` : ""}.`,
      s.tape.topWalletPrintShare != null
        ? `Largest single wallet placed ${pct(s.tape.topWalletPrintShare, 0)} of prints.`
        : "Wallet concentration: n/a.",
      windowLine(s),
      volumeLine(s),
      divergenceLine(s),
    ];
    risk = riskLines(s, (id) => FLOW_FLAGS.has(id));
  } else if (mode === "risk") {
    const warn = s.riskFlags.filter((f) => f.severity === "warn").length;
    observation = `${warn} warning flag${warn === 1 ? "" : "s"} and ${s.riskFlags.length - warn} informational flag${s.riskFlags.length - warn === 1 ? "" : "s"}; data quality is **${s.dataQuality.grade.toUpperCase()}**.`;
    evidence = [
      probabilityLine(s),
      resolutionLine(s),
      windowLine(s),
      `Probability change across the window: ${s.probabilityChange.value == null ? `not derivable — ${s.probabilityChange.reason}` : pct(s.probabilityChange.value)}`,
    ];
    risk = riskLines(s);
  } else if (mode === "catalysts") {
    const cat = catalogText(market);
    const desc = cat?.text || "";
    observation = cat
      ? `Catalog ${cat.kind} for “${question(market)}”: ${desc.length > 600 ? `${desc.slice(0, 600)}…` : desc}`
      : `The catalog has no description or resolution rule for “${question(market)}”, so catalysts cannot be identified from Panta data. Only the resolution time is known.`;
    evidence = [
      resolutionLine(s),
      cat
        ? `The event that decides this market is whatever the ${cat.kind} above names; there is little else to go on.`
        : "No catalog text to extract catalysts from.",
      probabilityLine(s),
    ];
    risk = [
      "- Catalysts here come only from the catalog text and resolution time; no external news is used.",
      ...riskLines(s, (id) => ["resolution_soon", "resolution_passed", "no_description", "resolved", "cancelled"].includes(id)),
    ];
  } else {
    observation = `${question(market)} — ${s.probability.yes != null ? `the market prices YES at ${pct(s.probability.yes)} (${sourceLabel(s.probability.source)})` : "no market price is available"}. ${s.headline}`;
    evidence = [probabilityLine(s), flowLine(s), divergenceLine(s), windowLine(s), volumeLine(s), resolutionLine(s)];
    risk = riskLines(s);
  }

  const modeLabel = BRIEF_MODES.find((m) => m.id === mode)?.label || mode;
  return [
    SECTION_HEADERS[0],
    observation,
    "",
    SECTION_HEADERS[1],
    bullets(evidence),
    "",
    SECTION_HEADERS[2],
    risk.join("\n"),
    "",
    SECTION_HEADERS[3],
    bullets(s.execution.lines),
    "",
    `_Deterministic template · ${modeLabel} · signals v${s.version} · no recommendation_`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// LLM narrative (interprets signals; falls back to the template)
// ---------------------------------------------------------------------------

const MODE_FOCUS: Record<BriefMode, string> = {
  desk: "Balanced desk read: summarize what the probability, flow, divergence, timing and data quality say together.",
  flow: "Focus on order flow: print counts, share-weighted split, imbalance, wallet concentration, recency, and how flow compares with price.",
  risk: "Focus on risk: explain each risk flag and the data-quality reasons, and what they limit about reading this market.",
  catalysts:
    "Focus on catalysts, using ONLY the catalog description / resolution rule and the resolution time. If that text is empty or thin, say plainly that catalysts cannot be identified from the available data. Do not use outside knowledge or news.",
};

const SYSTEM_PROMPT = [
  "You are an analyst on a prediction-market desk. You receive precomputed, deterministic evidence (`signals`) about one Panta market.",
  "Rules:",
  "1. Interpret the evidence; do NOT recompute, adjust, or invent numbers. Quote numbers exactly as given (percentages may be rounded to one decimal).",
  "2. Use only the provided fields. No outside facts, news, or speculation about events.",
  "3. Never give buy, sell, hold, or sizing recommendations. Do not say what the reader should do, which side to prefer, or that a trade 'requires conviction'. Describe; do not advise.",
  "4. If a field is null, say it is unavailable and why (a reason field is usually provided).",
  "5. Output markdown with exactly these four sections, in order: `### Observation`, `### Evidence`, `### Risk`, `### Execution considerations`. Evidence and Risk are bullet lists. Execution considerations restates the factual execution lines (phase, quote required, TTLs) without advice.",
  "6. Under 220 words.",
].join("\n");

export async function maybeOpenAIBrief(
  market: Market,
  signals: MarketSignals,
  mode: BriefMode = "desk",
): Promise<{ narrative: string; source: "openai" | "template" }> {
  const template = () => ({ narrative: buildTemplateBrief(market, signals, mode), source: "template" as const });
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return template();

  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const input = {
    mode,
    modeFocus: MODE_FOCUS[mode],
    market: {
      question: question(market),
      description: (market.description || "").slice(0, 1500) || null,
      resolutionRule: (market.resolutionRule || "").slice(0, 1500) || null,
      category: market.category || null,
      phase: market.phase || null,
      resolutionTimeIst: istTime(signals.resolution.resolutionTime),
    },
    signals,
  };

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_completion_tokens: 700,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(input) },
        ],
      }),
    });
    if (!res.ok) return template();
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) return template();
    // Structure + advice guard: discard answers that drift.
    if (!SECTION_HEADERS.every((h) => content.includes(h)) || containsAdvice(content)) {
      return template();
    }
    return { narrative: content.slice(0, 4000), source: "openai" };
  } catch {
    return template();
  }
}
