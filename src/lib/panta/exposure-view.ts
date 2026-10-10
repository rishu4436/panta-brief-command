/**
 * Which state the Portfolio overview's Exposure / Largest-position cards show
 * (pure presentation over portfolioIntel; no accounting here).
 *
 *  - The positions read hasn't finished, or failed with nothing loaded: never
 *    show zero or "empty" (that would invent a confirmed empty wallet).
 *  - A successful read with no positions: "No open exposure".
 *  - Positions held but no valid mark: valuation unavailable (existing note).
 *  - Valid marks that are all 0: zero exposure. Otherwise the normal view.
 */

import { formatMarkUsdc, LARGEST_UNAVAILABLE_NOTE, MARKS_LOADING_NOTE, type PortfolioIntel } from "./position-intel";

export type PortfolioReadState = "loading" | "failed" | "loaded";

export type ExposureView = "loading" | "read-failed" | "empty" | "marks-pending" | "valuation-unavailable" | "zero" | "valued";

/** From the positions query: data present → loaded (a failed refetch keeps showing the last good read). */
export function portfolioReadState(q: { hasData: boolean; isError: boolean }): PortfolioReadState {
  if (q.hasData) return "loaded";
  return q.isError ? "failed" : "loading";
}

export function exposureView(read: PortfolioReadState, intel: Pick<PortfolioIntel, "positionCount" | "marksPending" | "noValidMarks" | "totalValidMarked">): ExposureView {
  if (read === "loading") return "loading";
  if (read === "failed") return "read-failed";
  if (intel.positionCount === 0) return "empty";
  if (intel.marksPending) return "marks-pending";
  if (intel.noValidMarks) return "valuation-unavailable";
  return intel.totalValidMarked === 0 ? "zero" : "valued";
}

export const POSITIONS_LOADING_NOTE = "Loading positions…";
export const POSITIONS_READ_FAILED_NOTE = "Positions couldn't be read · exposure not shown";
export const NO_POSITIONS_NOTE = "No open exposure · this wallet holds no positions";

/** Card text for every non-"valued" view (valued renders the split / largest position). */
export function exposureNote(v: Exclude<ExposureView, "valued">): string {
  switch (v) {
    case "loading":
      return POSITIONS_LOADING_NOTE;
    case "read-failed":
      return POSITIONS_READ_FAILED_NOTE;
    case "empty":
      return NO_POSITIONS_NOTE;
    case "marks-pending":
      return MARKS_LOADING_NOTE;
    case "valuation-unavailable":
      return LARGEST_UNAVAILABLE_NOTE;
    case "zero":
      return `No open exposure · every valid mark is ${formatMarkUsdc(0)}`;
  }
}
