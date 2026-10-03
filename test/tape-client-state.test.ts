/**
 * P2 #4: the market page's tape keeps loading / failed / empty / loaded apart.
 * A failed request must render an error (with a retry), never "0 prints" or
 * an empty tape.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TradeTape } from "@/components/TradeTape";
import { TapeSparkline } from "@/components/TapeSparkline";
import type { Trade } from "@/lib/panta/domain";
import { printsLabel, tapeRows, tapeState } from "@/lib/tape-status";

const err = new Error("Panta 504");
const trade = { id: "t1", signature: "sig1", side: "yes", wallet: "W1", blockTime: 1_790_000_000, isPrimary: true } as unknown as Trade;
const q = (o: Partial<{ isPending: boolean; isError: boolean; data: Trade[] | undefined; error: unknown }>) =>
  tapeState<Trade>({ isPending: false, isError: false, data: undefined, error: null, ...o });

const html = (s: ReturnType<typeof q>, retry = true) =>
  renderToStaticMarkup(createElement(TradeTape, { state: s, onRetry: retry ? () => {} : undefined }));

describe("tape client state", () => {
  it("failure: error + retry, no rows, never 0 prints", () => {
    const s = q({ isError: true, error: err });
    expect(tapeRows(s)).toBeNull();
    expect(printsLabel(s)).not.toMatch(/^0/);
    const h = html(s);
    expect(h).toContain('data-tape-state="failed"');
    expect(h).toContain("Panta 504");
    expect(h).toContain("Retry");
    expect(h).not.toContain("No prints yet");
    expect(h).not.toContain(">Side<");
  });
  it("failure after an earlier empty result is still a failure", () => {
    const h = html(q({ isError: true, data: [], error: err }));
    expect(h).toContain('data-tape-state="failed"');
    expect(h).not.toContain("No prints yet");
  });
  it("loading: skeleton only, no empty copy, no error", () => {
    const s = q({ isPending: true });
    expect(printsLabel(s)).not.toMatch(/^0/);
    const h = html(s);
    expect(h).toContain('data-tape-state="loading"');
    expect(h).not.toContain("No prints yet");
    expect(h).not.toContain("failed");
  });
  it("success-empty: genuine empty tape", () => {
    const s = q({ data: [] });
    expect(tapeRows(s)).toBeNull();
    const h = html(s);
    expect(h).toContain('data-tape-state="empty"');
    expect(h).not.toContain("Retry");
  });
  it("success-data: rows render, no error", () => {
    const s = q({ data: [trade] });
    expect(tapeRows(s)).toEqual([trade]);
    const h = html(s);
    expect(h).toContain("YES");
    expect(h).not.toContain('role="alert"');
  });
  it("refresh failure over loaded data: rows kept with a refresh-failed banner + retry", () => {
    const h = html(q({ isError: true, data: [trade], error: err }));
    expect(h).toContain('data-tape-state="refresh-failed"');
    expect(h).toContain("YES");
    expect(h).toContain("Retry");
  });
  it("no retry button when no retry handler is wired", () => {
    expect(html(q({ isError: true, error: err }), false)).not.toContain("Retry");
  });
  it("sparkline: failure is an error with retry, not 'No flow series'", () => {
    const h = renderToStaticMarkup(createElement(TapeSparkline, { state: q({ isError: true, error: err }), onRetry: () => {} }));
    expect(h).toContain('data-tape-state="failed"');
    expect(h).toContain("Retry");
    expect(h).not.toContain("No flow series yet");
  });
});
