/**
 * Brief narrative sections and what kind of statement each one is. Shared by
 * the server (template + LLM structure check) and the UI (section tags), so
 * Observation / Evidence / Interpretation can't be confused.
 *
 *  - Observation: the market's state restated from Panta data   → observed
 *  - Evidence:    the computed signals it rests on, with values  → derived
 *  - Interpretation: what the evidence may mean (LLM) — hedged,
 *    not advice; the template says plainly it writes none        → interpretation
 *  - Risk: deterministic flags                                   → derived
 *  - Execution considerations: factual execution lines           → observed
 */

export type BriefLayer = "observed" | "derived" | "interpretation";

export const BRIEF_SECTIONS = [
  { name: "Observation", layer: "observed" },
  { name: "Evidence", layer: "derived" },
  { name: "Interpretation", layer: "interpretation" },
  { name: "Risk", layer: "derived" },
  { name: "Execution considerations", layer: "observed" },
] as const satisfies readonly { name: string; layer: BriefLayer }[];

export const BRIEF_SECTION_HEADERS = BRIEF_SECTIONS.map((s) => `### ${s.name}`);

/** Layer for a `### Heading` (case-insensitive); null for unknown headings. */
export function briefSectionLayer(heading: string): BriefLayer | null {
  const h = heading.replace(/^#+\s*/, "").trim().toLowerCase();
  return BRIEF_SECTIONS.find((s) => s.name.toLowerCase() === h)?.layer ?? null;
}

/** Body of one `### name` section, or "" when absent. */
export function briefSection(narrative: string, name: string): string {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = narrative.match(new RegExp(`###\\s*${esc}\\s*\\n([\\s\\S]*?)(?=\\n###\\s|$)`, "i"));
  return m ? m[1].trim() : "";
}

/** Template text for the Interpretation section: honest that none is generated. */
export const TEMPLATE_INTERPRETATION =
  "None written: this is the deterministic template (AI unavailable). Observation and Evidence above restate computed signals; read them as description, not a forecast.";
