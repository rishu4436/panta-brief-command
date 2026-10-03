import { describe, expect, it } from "vitest";
import { claimTicketReducer as r, emptyTicket, visibleTicket, type ClaimTicket } from "@/lib/claim-ticket";

const A = "4VGFQKGanc5oaLf51mee9m45HmiXRhKruh5mdRaM";
const B = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const M = "5cyMGUVDcToJ8ws5V1sKkGnzthLrLTsqEjo3Pa2HNU8v";

/** A's ticket after a confirmed, reported claim. */
function claimedByA(): ClaimTicket {
  let s = emptyTicket(A);
  s = r(s, { type: "fill", marketId: M });
  s = r(s, { type: "start", owner: A });
  s = r(s, { type: "update", owner: A, patch: { sig: "SIG_A", phase: "confirmed", msg: "Claim confirmed · SIG_A" } });
  s = r(s, { type: "update", owner: A, patch: { attr: "reported", busy: false } });
  return s;
}
const isClean = (s: ClaimTicket) =>
  s.marketId === "" && s.msg === null && s.sig === null && s.error === null && s.attr === "idle" && s.phase === "idle" && !s.busy;

describe("claim ticket keyed to the wallet", () => {
  it("A → B clears market, message and signature", () => {
    const s = r(claimedByA(), { type: "wallet", owner: B });
    expect(s.owner).toBe(B);
    expect(isClean(s)).toBe(true);
  });
  it("A → disconnect → B: cleared at disconnect and stays clean", () => {
    const d = r(claimedByA(), { type: "wallet", owner: null });
    expect(isClean(d)).toBe(true);
    const b = r(d, { type: "wallet", owner: B });
    expect(isClean(b)).toBe(true);
  });
  it("A → disconnect → A (reconnect) still clears the old artefacts", () => {
    const s = r(r(claimedByA(), { type: "wallet", owner: null }), { type: "wallet", owner: A });
    expect(isClean(s)).toBe(true);
  });
  it("claim message in flight, then switch: A's late results never land on B", () => {
    let s = emptyTicket(A);
    s = r(s, { type: "fill", marketId: M });
    s = r(s, { type: "start", owner: A });
    s = r(s, { type: "update", owner: A, patch: { msg: "Claim broadcast · confirming…" } });
    s = r(s, { type: "wallet", owner: B });
    s = r(s, { type: "update", owner: A, patch: { msg: "Claim confirmed · SIG_A", phase: "confirmed" } });
    s = r(s, { type: "update", owner: A, patch: { error: "late failure" } });
    expect(s.owner).toBe(B);
    expect(isClean(s)).toBe(true);
  });
  it("claim signature, then switch: B never sees A's signature or attribution", () => {
    let s = claimedByA();
    expect(s.sig).toBe("SIG_A");
    s = r(s, { type: "wallet", owner: B });
    s = r(s, { type: "update", owner: A, patch: { attr: "attributed" } }); // late ledger poll
    expect(s.sig).toBeNull();
    expect(s.attr).toBe("idle");
  });
  it("a start from another wallet is ignored", () => {
    const s = r(emptyTicket(B), { type: "start", owner: A });
    expect(s.busy).toBe(false);
  });
  it("same wallet keeps the ticket", () => {
    const a = claimedByA();
    expect(r(a, { type: "wallet", owner: A })).toBe(a);
  });
  it("visibleTicket never renders another owner's ticket (transitional render)", () => {
    const v = visibleTicket(claimedByA(), B);
    expect(v.owner).toBe(B);
    expect(isClean(v)).toBe(true);
  });
});
