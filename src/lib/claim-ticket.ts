/**
 * Claim ticket state, owned by one wallet. Any wallet change (A→B,
 * disconnect, reconnect) resets the ticket, and updates from a claim run that
 * started under another wallet are dropped, so an old wallet's market,
 * message, signature or attribution status is never shown to the new one.
 */
import { useReducer } from "react";
import type { ClaimKind } from "@/lib/panta/domain";

export type ClaimAttr = "idle" | "reporting" | "reported" | "attributed" | "report-failed" | "not-attributable";
export type ClaimPhase = "idle" | "confirming" | "pending" | "confirmed" | "failed";

export type ClaimTicket = {
  /** Wallet this ticket belongs to (null = disconnected). */
  owner: string | null;
  marketId: string;
  mode: ClaimKind;
  busy: boolean;
  error: string | null;
  msg: string | null;
  sig: string | null;
  attr: ClaimAttr;
  phase: ClaimPhase;
};

export const emptyTicket = (owner: string | null): ClaimTicket => ({
  owner,
  marketId: "",
  mode: "win",
  busy: false,
  error: null,
  msg: null,
  sig: null,
  attr: "idle",
  phase: "idle",
});

export type ClaimResult = Partial<Pick<ClaimTicket, "error" | "msg" | "sig" | "attr" | "phase" | "busy">>;

export type ClaimAction =
  | { type: "wallet"; owner: string | null }
  | { type: "fill"; marketId: string }
  | { type: "setMarket"; marketId: string }
  | { type: "setMode"; mode: ClaimKind }
  | { type: "start"; owner: string }
  /** Async result of a run started by `owner`; ignored if the wallet changed since. */
  | { type: "update"; owner: string; patch: ClaimResult };

export function claimTicketReducer(s: ClaimTicket, a: ClaimAction): ClaimTicket {
  switch (a.type) {
    case "wallet":
      return a.owner === s.owner ? s : emptyTicket(a.owner);
    case "fill":
      return { ...emptyTicket(s.owner), marketId: a.marketId };
    case "setMarket":
      return { ...s, marketId: a.marketId };
    case "setMode":
      return { ...s, mode: a.mode };
    case "start":
      if (a.owner !== s.owner) return s;
      return { ...s, busy: true, error: null, msg: null, sig: null, attr: "idle", phase: "idle" };
    case "update":
      if (a.owner !== s.owner) return s;
      return { ...s, ...a.patch };
  }
}

/** What may be rendered for `wallet`: nothing from another owner, ever. */
export function visibleTicket(s: ClaimTicket, wallet: string | null): ClaimTicket {
  return s.owner === wallet ? s : emptyTicket(wallet);
}

/** Claim ticket keyed to the connected wallet (resets on change). */
export function useClaimTicket(wallet: string | null) {
  const [state, dispatch] = useReducer(claimTicketReducer, wallet, emptyTicket);
  // Reset during render (not in an effect) so a stale ticket never paints.
  if (state.owner !== wallet) dispatch({ type: "wallet", owner: wallet });
  return [visibleTicket(state, wallet), dispatch] as const;
}
