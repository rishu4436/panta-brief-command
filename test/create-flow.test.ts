/**
 * Phase 3 · Create Market — orchestration gates: mainnet before build (Q) and
 * before sign (R), registration retry never builds/signs/broadcasts (U),
 * single-flight quote/build/register (V/W/X), image upload grant handling (Y),
 * and signing disabled in Stage A.
 */
import { describe, expect, it, vi } from "vitest";
import { createMarketActions, CREATE_SIGNING_ENABLED, type CreateFlowDeps } from "@/lib/panta/create-flow";
import { bindCreateQuote, freezeRegistration } from "@/lib/panta/create-market";
import { TIMELINE_CONFIRM_REQUIRED, timelineConfirmationError } from "@/lib/panta/create-rules";
import type { NetworkCheck } from "@/lib/network";
import { FX, WALLET, inputOf, marketConfigReader, nowFor } from "./create-helpers";

const S = FX.breaking;
const input = inputOf(S);
const NOW = nowFor(S);
const MAINNET: NetworkCheck = { ok: true };
const DEVNET: NetworkCheck = { ok: false, kind: "wrong_network", message: "The configured Solana RPC is on devnet, not mainnet-beta, where Panta markets live. Signing blocked." };
const SIG = "5VEJv1R" + "1".repeat(80);
const CONFIRMED = { confirmed: true, edited: false };

function deps(over: Partial<CreateFlowDeps> = {}) {
  const postPanta = vi.fn<CreateFlowDeps["postPanta"]>(async (path) => {
    if (path === "markets/create/quote") return S.quote;
    if (path === "markets/create/build") return S.build;
    if (path === "markets/register") return { createId: S.quote.createId, marketId: S.quote.expectedEventPda, status: "registered", signature: SIG };
    if (path === "markets/create/image-upload") {
      return {
        uploadUrl: "https://api.cloudinary.com/v1_1/dyvupboym/image/upload",
        publicId: "balr-market/events/usr_abc/0123456789abcdef",
        expiresAt: new Date(NOW + 300_000).toISOString(),
        fields: { folder: "balr-market/events", public_id: "usr_abc/0123456789abcdef", timestamp: 1, api_key: "k", signature: "s" },
      };
    }
    throw new Error("unexpected path");
  });
  const checkNetwork = vi.fn(async () => MAINNET);
  const postUpload = vi.fn<CreateFlowDeps["postUpload"]>(async () => ({
    public_id: "balr-market/events/usr_abc/0123456789abcdef",
    resource_type: "image",
    format: "png",
    secure_url: "https://res.cloudinary.com/dyvupboym/image/upload/v1/balr-market/events/usr_abc/0123456789abcdef.png",
  }));
  const d: CreateFlowDeps = { postPanta, postUpload, checkNetwork, rpc: marketConfigReader(), now: () => NOW - 120_000 + 90_000, ...over };
  return { d, postPanta, checkNetwork, postUpload };
}
const sessionAt = () => bindCreateQuote(S.quote, input, NOW);
const paths = (f: ReturnType<typeof deps>["postPanta"]) => f.mock.calls.map((c) => c[0]);

// Stage A's "signing is disabled" gate is replaced in Stage B: signing is enabled, but only through the
// full pipeline (final check → simulation → exact-bytes signing). Without the signing deps it refuses.
describe("Stage B: signing only through the verified pipeline", () => {
  it("CREATE_SIGNING_ENABLED is true", () => expect(CREATE_SIGNING_ENABLED).toBe(true));
  it("without signing deps, simulate and approve refuse before any wallet / network action", async () => {
    const { d, postPanta } = deps();
    const a = createMarketActions(d);
    const s = sessionAt();
    await expect(a.simulate({ session: s, build: null, currentInput: input, connectedWallet: WALLET })).rejects.toThrow(/not configured|Signing blocked/);
    await expect(
      a.approveAndBroadcast({ session: s, build: null, currentInput: input, connectedWallet: WALLET, simulated: {} as never }),
    ).rejects.toThrow(/not configured/);
    expect(paths(postPanta)).toEqual([]);
  });
});

describe("Q: network gate before build", () => {
  it("wrong network → build is never requested from Panta", async () => {
    const { d, postPanta } = deps({ checkNetwork: vi.fn(async () => DEVNET) });
    await expect(createMarketActions(d).build(sessionAt(), WALLET)).rejects.toThrow(/devnet/);
    expect(paths(postPanta)).not.toContain("markets/create/build");
  });
  it("RPC check failure → build is never requested", async () => {
    const { d, postPanta } = deps({ checkNetwork: vi.fn(async (): Promise<NetworkCheck> => ({ ok: false, kind: "check_failed", message: "Couldn't confirm the Solana RPC is on mainnet" })) });
    await expect(createMarketActions(d).build(sessionAt(), WALLET)).rejects.toThrow(/Couldn't confirm/);
    expect(postPanta).not.toHaveBeenCalled();
  });
  it("mainnet → real build verifies and the fee is bound on-chain", async () => {
    const { d } = deps();
    const r = await createMarketActions(d).build(sessionAt(), WALLET);
    expect(r.verified.ok).toBe(true);
    expect(r.paymentOnChain).toBeNull();
  });
  it("a different wallet than the quoted one is refused before any network call", async () => {
    const { d, checkNetwork, postPanta } = deps();
    await expect(createMarketActions(d).build(sessionAt(), "11111111111111111111111111111112")).rejects.toThrow(/wallet/);
    expect(checkNetwork).not.toHaveBeenCalled();
    expect(postPanta).not.toHaveBeenCalled();
  });
});

describe("R: network gate before sign", () => {
  it("revalidateBeforeSign blocks on wrong network even with a verified build", async () => {
    const good = deps();
    const b = await createMarketActions(good.d).build(sessionAt(), WALLET);
    const { d } = deps({ checkNetwork: vi.fn(async () => DEVNET) });
    const r = await createMarketActions(d).revalidateBeforeSign({ session: sessionAt(), build: b.build, currentInput: input, connectedWallet: WALLET });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/devnet/);
  });
  it("revalidateBeforeSign passes on mainnet with unchanged inputs", async () => {
    const { d } = deps();
    const a = createMarketActions(d);
    const b = await a.build(sessionAt(), WALLET);
    const r = await a.revalidateBeforeSign({ session: sessionAt(), build: b.build, currentInput: input, connectedWallet: WALLET });
    expect(r.ok).toBe(true);
  });
});

describe("U: registration retry", () => {
  it("retry re-sends the frozen createId + signature only; no build, network check, sign or broadcast", async () => {
    let attempt = 0;
    const { d, postPanta, checkNetwork } = deps();
    const base = d.postPanta;
    d.postPanta = vi.fn<CreateFlowDeps["postPanta"]>(async (path, body) => {
      if (path === "markets/register" && attempt++ === 0) throw new Error("TX_NOT_FOUND");
      return base(path, body);
    });
    const a = createMarketActions(d);
    const frozen = freezeRegistration(sessionAt(), SIG);
    await expect(a.register(frozen)).rejects.toThrow(/TX_NOT_FOUND/);
    const r = await a.register(frozen);
    expect(r.marketId).toBe(S.quote.expectedEventPda);
    const calls = (d.postPanta as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.map((c) => c[0])).toEqual(["markets/register", "markets/register"]);
    expect(calls[0][1]).toEqual({ createId: S.quote.createId, signature: SIG });
    expect(calls[1][1]).toEqual(calls[0][1]);
    expect(checkNetwork).not.toHaveBeenCalled();
    expect(postPanta).toHaveBeenCalledTimes(1); // base delegate: only the successful register
  });
  it("a registration response for another market is rejected", async () => {
    const { d } = deps({ postPanta: vi.fn(async () => ({ createId: S.quote.createId, marketId: FX.standard.quote.expectedEventPda, status: "registered", signature: SIG })) });
    await expect(createMarketActions(d).register(freezeRegistration(sessionAt(), SIG))).rejects.toThrow(/not the quoted event address/);
  });
});

describe("V/W/X: single-flight", () => {
  it("V: double-click quote sends one request and both callers get the same session", async () => {
    const { d, postPanta } = deps({ now: () => NOW });
    const a = createMarketActions(d);
    const [x, y] = await Promise.all([a.quote(input, CONFIRMED), a.quote(input, CONFIRMED)]);
    expect(x).toBe(y);
    expect(paths(postPanta).filter((p) => p === "markets/create/quote")).toHaveLength(1);
  });
  it("W: double-click build sends one request", async () => {
    const { d, postPanta, checkNetwork } = deps();
    const a = createMarketActions(d);
    const s = sessionAt();
    const [x, y] = await Promise.all([a.build(s, WALLET), a.build(s, WALLET)]);
    expect(x).toBe(y);
    expect(paths(postPanta).filter((p) => p === "markets/create/build")).toHaveLength(1);
    expect(checkNetwork).toHaveBeenCalledTimes(1);
  });
  it("X: double-click register sends one request", async () => {
    const { d, postPanta } = deps();
    const a = createMarketActions(d);
    const f = freezeRegistration(sessionAt(), SIG);
    const [x, y] = await Promise.all([a.register(f), a.register(f)]);
    expect(x).toBe(y);
    expect(paths(postPanta).filter((p) => p === "markets/register")).toHaveLength(1);
  });
  it("quote is refused client-side (no request) when guards fail", async () => {
    const { d, postPanta } = deps({ now: () => NOW });
    await expect(createMarketActions(d).quote({ ...input, sourcesOfTruth: [] }, CONFIRMED)).rejects.toThrow(/source/);
    expect(postPanta).not.toHaveBeenCalled();
  });
});

describe("timeline confirmation gate (suggested defaults are not consent)", () => {
  it("pure rule: neither ticked nor edited is an error; either one clears it; missing state fails closed", () => {
    expect(timelineConfirmationError({ confirmed: false, edited: false })).toBe(TIMELINE_CONFIRM_REQUIRED);
    expect(timelineConfirmationError({ confirmed: true, edited: false })).toBeNull();
    expect(timelineConfirmationError({ confirmed: false, edited: true })).toBeNull();
    expect(timelineConfirmationError(null)).toBe(TIMELINE_CONFIRM_REQUIRED);
    expect(timelineConfirmationError(undefined)).toBe(TIMELINE_CONFIRM_REQUIRED);
    expect(timelineConfirmationError({ confirmed: "yes", edited: 1 } as never)).toBe(TIMELINE_CONFIRM_REQUIRED);
  });
  it("untouched defaults without the checkbox: quote refused, Panta never called (even with otherwise valid input)", async () => {
    const { d, postPanta } = deps({ now: () => NOW });
    await expect(createMarketActions(d).quote(input, { confirmed: false, edited: false })).rejects.toThrow(/Confirm the timeline/);
    expect(postPanta).not.toHaveBeenCalled();
  });
  it("ticking 'I confirm this timeline' allows the quote", async () => {
    const { d, postPanta } = deps({ now: () => NOW });
    const s = await createMarketActions(d).quote(input, { confirmed: true, edited: false });
    expect(s.createId).toBe(S.quote.createId);
    expect(paths(postPanta)).toEqual(["markets/create/quote"]);
  });
  it("editing a time field yourself also counts as confirmation", async () => {
    const { d, postPanta } = deps({ now: () => NOW });
    await createMarketActions(d).quote(input, { confirmed: false, edited: true });
    expect(paths(postPanta)).toEqual(["markets/create/quote"]);
  });
  it("confirmation never bypasses the timeline rules themselves", async () => {
    const { d, postPanta } = deps({ now: () => NOW });
    await expect(createMarketActions(d).quote({ ...input, endTime: input.startTime - 1 }, CONFIRMED)).rejects.toThrow();
    expect(postPanta).not.toHaveBeenCalled();
  });
});

describe("Y: image upload flow", () => {
  const png = () => new File([new Uint8Array([137, 80, 78, 71])], "x.png", { type: "image/png" });
  it("grant from Panta, bytes straight to the granted Cloudinary URL, validated URL back", async () => {
    const { d, postPanta, postUpload } = deps({ now: () => NOW });
    const url = await createMarketActions(d).uploadImage(png());
    expect(url).toMatch(/^https:\/\/res\.cloudinary\.com\/dyvupboym\/image\/upload\//);
    expect(postPanta).toHaveBeenCalledWith("markets/create/image-upload", {});
    expect(postUpload.mock.calls[0][0]).toBe("https://api.cloudinary.com/v1_1/dyvupboym/image/upload");
    const form = postUpload.mock.calls[0][1];
    expect(form.get("signature")).toBe("s");
    expect(form.get("file")).toBeInstanceOf(File);
  });
  it("malformed grant → nothing is uploaded", async () => {
    const { d, postUpload } = deps({ now: () => NOW, postPanta: vi.fn(async () => ({ uploadUrl: "https://evil.example/upload", publicId: "x", fields: {} })) });
    await expect(createMarketActions(d).uploadImage(png())).rejects.toThrow(/rejected/);
    expect(postUpload).not.toHaveBeenCalled();
  });
  it("malformed Cloudinary response → no image URL is accepted", async () => {
    const { d } = deps({ now: () => NOW, postUpload: vi.fn(async () => ({ secure_url: "https://evil.example/x.png", public_id: "balr-market/events/usr_abc/0123456789abcdef" })) });
    await expect(createMarketActions(d).uploadImage(png())).rejects.toThrow(/unexpected image URL/);
  });
  it("disallowed file type is refused before any request", async () => {
    const { d, postPanta } = deps({ now: () => NOW });
    await expect(createMarketActions(d).uploadImage(new File(["<svg/>"], "x.svg", { type: "image/svg+xml" }))).rejects.toThrow(/PNG/);
    expect(postPanta).not.toHaveBeenCalled();
  });
});
