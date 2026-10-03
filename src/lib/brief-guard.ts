/**
 * Live-safety guard for LLM briefs. Numbers come from deterministic signals;
 * the model only interprets. Everything the model returns is checked here and
 * any failure falls back to the deterministic template:
 *  - exactly the five sections, in order, each non-empty, no other headings;
 *  - no advice language;
 *  - no number that is not present in the provided evidence (signals JSON +
 *    the deterministic template lines; catalog-text numbers only as plain
 *    numbers, never as percentages);
 *  - no probability / odds / likelihood claim when the market has no usable
 *    probability (e.g. inconsistent YES/NO prices);
 *  - no echo of prompt-injection phrasing.
 * Market description / resolution text is untrusted (written by market
 * creators): it is sanitized and delimited before it reaches the model.
 */
import { BRIEF_SECTIONS } from "./brief-sections";

export const UNTRUSTED_OPEN = "<<<UNTRUSTED_CATALOG_TEXT>>>";
export const UNTRUSTED_CLOSE = "<<<END_UNTRUSTED_CATALOG_TEXT>>>";

/**
 * Untrusted catalog text → inert plain text: control characters, markdown
 * structure (headings, code fences, tables, links/HTML) and anything that
 * looks like our delimiters are removed; whitespace collapsed; length capped.
 */
export function sanitizeUntrustedText(input: string | null | undefined, max = 1500): string {
  if (!input) return "";
  let s = String(input).normalize("NFKC");
  s = s.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, " ");
  s = s.replace(/<{2,}|>{2,}/g, " "); // our delimiter shape
  s = s.replace(/[<>`#|{}[\]\\]/g, " "); // markdown / HTML / JSON structure
  s = s.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export function delimitUntrusted(text: string): string | null {
  return text ? `${UNTRUSTED_OPEN} ${text} ${UNTRUSTED_CLOSE}` : null;
}

const ADVICE_RE =
  /\b(you should|we recommend|i recommend|recommend(?:ed|s)? (?:buying|selling|a position)|consider (?:buying|selling|going|entering|adding)|buy now|sell now|go long|go short|take a position|size (?:up|down|carefully|your)|requires? conviction|prefer (?:primary )?(?:yes|no)|good entry|attractive entry|undervalued|overvalued|strong buy|strong sell|(?:buy|sell|back|bet on|load up on) (?:the )?(?:yes|no)\b|worth buying|good bet|safe bet)\b/i;

export function containsAdvice(text: string): boolean {
  return ADVICE_RE.test(text);
}

const INJECTION_ECHO_RE =
  /\b(ignore (?:all |the )?(?:previous|prior|above) (?:instructions|rules)|system prompt|as an ai\b|new instructions|disregard (?:the )?(?:rules|instructions))/i;

// --- numbers -----------------------------------------------------------------

const NUM_RE = /(?<![A-Za-z0-9_.])[-+−]?\d[\d,]*(?:\.\d+)?(?:\s?%)?/g;

function canon(n: number): string {
  return String(Number(n.toFixed(6)));
}

/** Every rounding (0–4 dp) of x, |x|, and (for fractions) x·100. */
function addForms(set: Set<string>, x: number) {
  if (!Number.isFinite(x)) return;
  const bases = [x, Math.abs(x)];
  if (Math.abs(x) <= 1) bases.push(x * 100, Math.abs(x) * 100);
  for (const b of bases) for (let dp = 0; dp <= 4; dp++) set.add(canon(Number(b.toFixed(dp))));
}

function numbersIn(text: string): { raw: string; value: number; pct: boolean }[] {
  const out: { raw: string; value: number; pct: boolean }[] = [];
  for (const m of text.matchAll(NUM_RE)) {
    const raw = m[0];
    const pct = raw.includes("%");
    const v = Number(raw.replace(/[,%\s+]/g, "").replace("−", "-"));
    if (Number.isFinite(v)) out.push({ raw, value: v, pct });
  }
  return out;
}

export type EvidenceNumbers = { strict: Set<string>; plain: Set<string> };

/**
 * Allowed numbers: anything in the signals JSON or the deterministic template
 * (strict — may be used as a percentage), plus numbers in the catalog text /
 * question (plain only — a "90%" in a description is never evidence).
 */
export function evidenceNumbers(signals: unknown, templateTexts: string[], catalogTexts: string[]): EvidenceNumbers {
  const strict = new Set<string>(["0", "1", "100"]);
  // Numeric values (and plain numeric strings such as raw prices) only — not
  // digits inside ISO timestamps or ids.
  const walk = (v: unknown) => {
    if (typeof v === "number") addForms(strict, v);
    else if (typeof v === "string" && /^-?\d+(?:\.\d+)?$/.test(v.trim())) addForms(strict, Number(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(signals);
  for (const t of templateTexts) for (const n of numbersIn(t)) addForms(strict, n.value);
  const plain = new Set<string>();
  for (const t of catalogTexts) for (const n of numbersIn(t)) if (!n.pct) plain.add(canon(n.value));
  return { strict, plain };
}

// --- probability claims --------------------------------------------------------

const PROB_WORD_RE = /\b(probabilit\w*|likel\w*|chance\w*|odds|implied|implies|implying|favou?red|expected to (?:win|resolve))\b/i;
const NEGATION_RE = /\b(unavailable|not available|not read as|no usable|inconsistent|cannot|can't|not derivable|not computable|isn't|is not|are not)\b/i;
const DIRECT_PROB_RE =
  /(\d+(?:\.\d+)?\s?%\s*(?:likely|chance|probability|odds))|((?:probabilit\w*|chances?|odds|likelihood)\b[^.%\n]{0,40}?\d+(?:\.\d+)?\s?%)|(\b(?:yes|no)\b\s+(?:is|looks|seems)\s+(?:\w+\s+)?likely)/i;

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim());
}

// --- structure -----------------------------------------------------------------

const EXPECTED = BRIEF_SECTIONS.map((s) => s.name.toLowerCase());

export type GuardResult = { ok: true } | { ok: false; reason: string };

/** Rounded forms of the market's own YES/NO probability (the only odds a brief may state). */
export function probabilityForms(yes: number | null, no: number | null): Set<string> {
  const out = new Set<string>();
  for (const p of [yes, no]) if (p != null) addForms(out, p);
  return out;
}

export function checkLlmBrief(
  content: string,
  ctx: { probabilityAvailable: boolean; probability?: Set<string>; evidence: EvidenceNumbers },
): GuardResult {
  const text = content.trim();
  if (!text) return { ok: false, reason: "empty" };
  if (text.length > 4000) return { ok: false, reason: "too_long" };

  // Structure: the five headings exactly, in order, each with a body; nothing else.
  const headings = [...text.matchAll(/^\s{0,3}(#{1,6})\s*(.+?)\s*#*\s*$/gm)];
  const names = headings.map((h) => h[2].trim().toLowerCase());
  if (names.length !== EXPECTED.length || names.some((n, i) => n !== EXPECTED[i])) {
    return { ok: false, reason: "sections" };
  }
  if (headings.some((h) => h[1] !== "###")) return { ok: false, reason: "sections" };
  if (!text.startsWith(headings[0][0].trim())) return { ok: false, reason: "sections" };
  for (let i = 0; i < headings.length; i++) {
    const start = (headings[i].index ?? 0) + headings[i][0].length;
    const end = i + 1 < headings.length ? (headings[i + 1].index ?? text.length) : text.length;
    if (!text.slice(start, end).trim()) return { ok: false, reason: `empty_section:${EXPECTED[i]}` };
  }

  if (containsAdvice(text)) return { ok: false, reason: "advice" };
  if (INJECTION_ECHO_RE.test(text)) return { ok: false, reason: "injection_echo" };

  // Numbers must come from the evidence.
  for (const n of numbersIn(text)) {
    const c = canon(n.value);
    if (ctx.evidence.strict.has(c)) continue;
    if (!n.pct && ctx.evidence.plain.has(c)) continue;
    return { ok: false, reason: `number_not_in_evidence:${n.raw.trim()}` };
  }

  // A likelihood stated as a percentage must be the market's own probability.
  for (const s of sentences(text)) {
    const m = s.match(DIRECT_PROB_RE);
    if (!m) continue;
    if (!ctx.probabilityAvailable) return { ok: false, reason: "probability_claim" };
    const nums = numbersIn(m[0]).map((n) => canon(n.value));
    if (!nums.length || nums.some((n) => !ctx.probability?.has(n))) return { ok: false, reason: "probability_claim_not_market" };
  }

  // No probability claims at all when Panta's prices give no usable probability.
  if (!ctx.probabilityAvailable) {
    for (const s of sentences(text)) {
      const hasPct = /\d\s?%/.test(s);
      const hasFraction = /(?<![\d.])0?\.\d+/.test(s);
      if (PROB_WORD_RE.test(s) && (hasPct || hasFraction) && !NEGATION_RE.test(s)) {
        return { ok: false, reason: "probability_claim" };
      }
    }
  }
  return { ok: true };
}
