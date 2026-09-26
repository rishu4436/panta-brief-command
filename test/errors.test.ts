import { describe, expect, it } from "vitest";
import { describeErr, tidyWalletMessage } from "@/lib/errors";

describe("tidyWalletMessage", () => {
  it("drops web3.js developer hints from send errors", () => {
    const raw =
      "Simulation failed. \nMessage: Transaction simulation failed: Blockhash not found. \nCatch the `SendTransactionError` and call `getLogs()` on it for full details.";
    expect(tidyWalletMessage(raw)).toBe("Simulation failed: Blockhash not found.");
    expect(describeErr(new Error(raw))).toBe("Simulation failed: Blockhash not found.");
  });
  it("leaves ordinary messages alone", () => {
    expect(tidyWalletMessage("Quote expired before approval.")).toBe("Quote expired before approval.");
  });
});
