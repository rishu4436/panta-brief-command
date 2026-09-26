import { describe, expect, it } from "vitest";
import { buildTemplateBrief, containsAdvice } from "@/lib/brief";
import { SAMPLE_BRIEF, SAMPLE_MARKET, SAMPLE_NARRATIVE, SAMPLE_SIGNALS } from "@/components/landing/sample";

describe("landing sample brief", () => {
  it("is exactly what the real template produces for the sample data", () => {
    expect(SAMPLE_NARRATIVE).toBe(buildTemplateBrief(SAMPLE_MARKET, SAMPLE_SIGNALS, "desk"));
  });
  it("is labelled as template output and contains no advice", () => {
    expect(SAMPLE_BRIEF.source).toBe("template");
    expect(containsAdvice(SAMPLE_NARRATIVE)).toBe(false);
  });
  it("is clearly not a live market id", () => {
    expect(SAMPLE_MARKET.marketId).toMatch(/sample/);
  });
});
