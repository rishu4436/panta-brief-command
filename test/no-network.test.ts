/** The test-wide network guard (test/setup/no-network.ts) is active. */
import { describe, expect, it } from "vitest";

describe("tests never reach the network", () => {
  it.each(["https://live-api.panta.market/api/v1/markets/", "https://api.mainnet-beta.solana.com/", "https://example.com/"])("fetch %s rejects immediately", async (url) => {
    const t0 = Date.now();
    await expect(fetch(url)).rejects.toThrow(/network access is disabled in tests/);
    expect(Date.now() - t0).toBeLessThan(100);
  });
});
