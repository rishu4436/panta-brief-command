/**
 * Deterministic "Not in data" bullets for the brief UI (client-safe).
 * Secondary with usable last-obs must NOT claim a missing "Live price".
 */
import type { MarketSignals } from "./panta/signals";

export function briefNotInDataItems(s: MarketSignals): string[] {
  const items: string[] = [];
  const secondary = (s.phase || "").toLowerCase() === "secondary" && !s.resolved;
  if (secondary) {
    const obs = s.secondaryLastObserved;
    const hasObs = obs != null && (obs.yes != null || obs.no != null);
    if (!hasObs) items.push("Last observed secondary price from Panta");
    else items.push("Observation time of last secondary price");
    if (s.tape.secondaryPrints === 0) {
      items.push("Observed secondary trade flow (no secondary prints in the window)");
    }
  } else {
    if (s.probability.yes == null) {
      items.push(
        s.probability.reason === "inconsistent_prices"
          ? "A usable probability (Panta's YES/NO prices are inconsistent)"
          : "Live price for this market",
      );
    }
    if (s.tape.count === 0) items.push("Recent trade flow (no prints in the window)");
  }
  items.push("Order-book depth, off-chain news and who the traders are");
  return items;
}
