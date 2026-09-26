import { describe, expect, it } from "vitest";
import { formatOddsPct, formatTapeSize, formatVolumeUsdc } from "@/lib/format";
import { fromBaseUnits, humanAmount, marketVolumeUsdc, normalizePantaTrade } from "@/lib/panta/normalize";

describe("units: human vs base (6 decimals)", () => {
  it("1 USDC human equals 1000000 base units", () => {
    expect(humanAmount("1")).toBe(1);
    expect(fromBaseUnits("1000000")).toBe(1);
    expect(fromBaseUnits(1_000_000)).toBe(1);
  });

  it("trade amountUsdc and amountUsdcBase normalize to the same USDC", () => {
    expect(normalizePantaTrade({ amountUsdc: "1" }).amountUsdc).toBe(1);
    expect(normalizePantaTrade({ amountUsdcBase: "1000000" }).amountUsdc).toBe(1);
  });

  it("never guesses units from magnitude (a large human value stays human)", () => {
    expect(normalizePantaTrade({ amountUsdc: "1000000" }).amountUsdc).toBe(1_000_000);
  });

  it("sharesBase converts ÷1e6; human shares win when both exist", () => {
    expect(normalizePantaTrade({ sharesBase: "48647771" }).shares).toBeCloseTo(48.647771, 6);
    expect(normalizePantaTrade({ shares: "48.647771", sharesBase: "48647771" }).shares).toBeCloseTo(48.647771, 6);
  });

  it("market volume: human field preferred, *Base divided", () => {
    expect(marketVolumeUsdc({ volumeUsdc: "12.5" })).toBe(12.5);
    expect(marketVolumeUsdc({ volumeUsdcBase: "12500000" })).toBe(12.5);
  });

  it("side falls back to yes/no amounts only for direction", () => {
    const t = normalizePantaTrade({ yesAmount: 48647771, noAmount: 0, sharesBase: "48647771" });
    expect(t.side).toBe("yes");
    expect(t.shares).toBeCloseTo(48.647771, 6);
    expect(t.amountUsdc).toBeNull();
  });

  it("null / missing / garbage fields degrade to null", () => {
    const t = normalizePantaTrade({ shares: "abc", amountUsdc: null, blockTime: undefined });
    expect(t.shares).toBeNull();
    expect(t.amountUsdc).toBeNull();
    expect(t.blockTime).toBeNull();
    expect(t.side).toBeNull();
  });
});

describe("format", () => {
  it("probability 0.63 is shown as 63%", () => {
    expect(formatOddsPct("0.63")).toBe("63.0%");
    expect(formatOddsPct(0.63)).toBe("63.0%");
    expect(formatOddsPct(null)).toBe("—");
  });

  it("volume formatting hides bare zero and labels USDC", () => {
    expect(formatVolumeUsdc(0)).toBe("—");
    expect(formatVolumeUsdc("1")).toBe("1 USDC");
  });

  it("tape size prefers USDC paid, else shares by side", () => {
    expect(formatTapeSize(normalizePantaTrade({ amountUsdc: "2" }))).toBe("2 USDC");
    expect(formatTapeSize(normalizePantaTrade({ side: "no", shares: "3" }))).toBe("3 NO");
  });
});
