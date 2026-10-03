import { describe, expect, it } from "vitest";
import { validateAmountUsdc } from "../src/lib/panta/validate";

describe("validateAmountUsdc", () => {
  it.each([
    [".5", "0.50"],
    ["0.5", "0.50"],
    [".05", "0.05"],
    ["1", "1.00"],
    ["25.50", "25.50"],
  ])("accepts %s as %s", (raw, value) => {
    expect(validateAmountUsdc(raw)).toEqual({ ok: true, value });
  });

  it.each(["", ".", "1.", "0.505", ".505", "-1", "1e2", "abc", "0", ".0", "0.00", "10001"])(
    "rejects %j",
    (raw) => {
      expect(validateAmountUsdc(raw).ok).toBe(false);
    },
  );
});
