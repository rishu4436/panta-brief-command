import type { BriefTone, CatalogTradeRow, MarketCatalogItem } from "./types";
import { formatFriendlyIst, formatOddsPct, formatVolumeUsdc, impliedSide } from "./format";

export type { BriefTone };

function tapeSummary(tape: CatalogTradeRow[]): {
  count: number;
  yesBuys: number;
  noBuys: number;
  lastSide: string | null;
} {
  let yesBuys = 0;
  let noBuys = 0;
  for (const t of tape) {
    const side = (t.side || "").toLowerCase();
    const yesAmt = Number(t.yesAmount ?? 0);
    const noAmt = Number(t.noAmount ?? 0);
    if (side === "yes" || yesAmt > noAmt) yesBuys += 1;
    else if (side === "no" || noAmt > yesAmt) noBuys += 1;
  }
  const last = tape[0];
  let lastSide: string | null = null;
  if (last) {
    lastSide =
      last.side ||
      (Number(last.yesAmount ?? 0) > Number(last.noAmount ?? 0) ? "yes" : "no");
  }
  return { count: tape.length, yesBuys, noBuys, lastSide };
}

function toneHeader(tone: BriefTone): string {
  if (tone === "bull") return "Tone preset: **Bull** — emphasize YES catalysts and upside flow.";
  if (tone === "bear") return "Tone preset: **Bear** — emphasize NO catalysts, fade risk, and downside flow.";
  return "Tone preset: **Neutral** — balanced desk read without directional spin.";
}

function toneDeskNote(
  lean: string,
  tone: BriefTone,
): string {
  if (tone === "bull") {
    return lean === "NO"
      ? "Bull preset vs NO-priced curve: thesis is contrarian — size only if resolution criteria clearly favor YES and quote avgPrice still works."
      : "Bull preset: prefer primary YES when quote fee/slippage stay inside risk limits; do not chase expired quotes.";
  }
  if (tone === "bear") {
    return lean === "YES"
      ? "Bear preset vs YES-priced curve: look for NO entries on weak tape / wide fee; confirm endTime and oracle before fading."
      : "Bear preset: lean NO or stay flat unless tape prints clear YES exhaustion and quote remains fresh.";
  }
  return lean === "YES"
    ? "Curve prices YES as the favorite. Size primary buys carefully — bonding-curve avgPrice from quote is the binding fill, not the spot label."
    : lean === "NO"
      ? "Curve prices NO ahead. Contrarian YES requires conviction on resolution criteria; check endTime and oracle source before size."
      : lean === "EVEN"
        ? "Market is balanced. Edge comes from information timing and fee/slippage discipline on primary fills."
        : "List endpoints return null prices — open detail (this page) for live odds before trading.";
}

export function buildTemplateBrief(
  market: MarketCatalogItem,
  tape: CatalogTradeRow[],
  tone: BriefTone = "neutral",
): string {
  const { yes, no } = impliedSide(market);
  const yesPct = formatOddsPct(yes);
  const noPct = formatOddsPct(no);
  const vol = formatVolumeUsdc(market.volumeUsdc ?? market.totalVolumeUsdc);
  const phase = market.phase || "unknown";
  const status = market.status || (market.resolved ? "resolved" : "open");
  const tapeStats = tapeSummary(tape);

  const lean =
    yes !== null && no !== null
      ? Number(yes) > Number(no)
        ? "YES"
        : Number(no) > Number(yes)
          ? "NO"
          : "EVEN"
      : "UNPRICED";

  const end =
    market.endTime != null
      ? new Date(market.endTime * 1000).toLocaleString("en-IN", {
          timeZone: "Asia/Calcutta",
          dateStyle: "medium",
          timeStyle: "short",
        }) + " IST"
      : "n/a";

  const flowNote =
    tapeStats.count === 0
      ? "No recent tape prints in the catalog window — liquidity discovery is thin; treat odds as soft until flow appears."
      : `Tape shows ${tapeStats.count} recent print(s): ~${tapeStats.yesBuys} YES-leaning vs ~${tapeStats.noBuys} NO-leaning. Last print lean: ${(tapeStats.lastSide || "n/a").toUpperCase()}.`;

  const headline =
    (market.title || "").trim() ||
    (market.description || "").trim().slice(0, 140) ||
    market.marketId;

  return [
    `## Desk brief — ${headline}`,
    "",
    toneHeader(tone),
    "",
    `**Thesis lean:** ${lean}  ·  **Phase:** ${phase}  ·  **Status:** ${status}`,
    `**Implied odds:** YES ${yesPct} / NO ${noPct}  ·  **Catalog volume:** ${vol}`,
    `**Category:** ${market.category || "—"}  ·  **Region:** ${market.region || "—"}  ·  **Window end:** ${end}`,
    "",
    "### Situation",
    market.description?.trim()
      ? market.description.trim().slice(0, 600)
      : "No catalog description provided — rely on resolution source and on-chain curve state.",
    "",
    "### Tape read",
    flowNote,
    "",
    "### Desk notes",
    toneDeskNote(lean, tone),
    "",
    "### Risks",
    "- Primary-only flow in this desk; secondary AMM routing is out of scope for v1.",
    "- Quote sessions expire quickly — sign/broadcast promptly after build.",
    "- Resolution disputes and oracle lag can reprice outcomes after the window.",
    "",
    `_Generated ${formatFriendlyIst(new Date())} · ${tone} · Powered by Panta_`,
  ].join("\n");
}

function toneSystemHint(tone: BriefTone): string {
  if (tone === "bull") {
    return "Adopt a constructive/bull tone toward YES without fabricating prices. Highlight catalysts that could lift YES.";
  }
  if (tone === "bear") {
    return "Adopt a cautious/bear tone favoring NO or flat. Stress fade risk, fee drag, and why YES may be overextended.";
  }
  return "Stay balanced and desk-neutral. No cheerleading either side.";
}

export async function maybeOpenAIBrief(
  market: MarketCatalogItem,
  tape: CatalogTradeRow[],
  tone: BriefTone = "neutral",
): Promise<{ narrative: string; source: "openai" | "template" }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return { narrative: buildTemplateBrief(market, tape, tone), source: "template" };
  }

  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const { yes, no } = impliedSide(market);
  const prompt = {
    tone,
    title: (market.title || "").trim() || (market.description || "").trim(),
    description: market.description,
    category: market.category,
    phase: market.phase,
    status: market.status,
    yesPrice: yes,
    noPrice: no,
    volumeUsdc: market.volumeUsdc,
    endTime: market.endTime,
    // Tape rows arrive pre-normalized by sanitizeTape(): human `shares` and
    // `amountUsdc` only (see src/lib/panta/normalize.ts for unit contracts).
    recentTape: tape.slice(0, 20).map((t) => ({
      side: t.side,
      shares: (t as { shares?: string }).shares,
      amountUsdc: t.amountUsdc,
      isPrimary: t.isPrimary,
      blockTime: t.blockTime,
    })),
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
        temperature: 0.4,
        max_completion_tokens: 700,
        messages: [
          {
            role: "system",
            content:
              `You are a prediction-market desk analyst. Write a concise markdown brief (Situation, Tape read, Desk notes, Risks) from the JSON. No investment advice disclaimer spam. Be concrete about YES/NO odds and flow. ${toneSystemHint(tone)}`,
          },
          {
            role: "user",
            content: JSON.stringify(prompt),
          },
        ],
      }),
    });
    if (!res.ok) {
      return { narrative: buildTemplateBrief(market, tape, tone), source: "template" };
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return { narrative: buildTemplateBrief(market, tape, tone), source: "template" };
    }
    return { narrative: content, source: "openai" };
  } catch {
    return { narrative: buildTemplateBrief(market, tape, tone), source: "template" };
  }
}
