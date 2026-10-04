/**
 * WalletProvider onError: silent for the user declining (the ticket shows it
 * as state), console.error for every other wallet error, WalletNotReady still
 * opens the install page like the adapter's default.
 */
import { readFileSync } from "node:fs";
import {
  WalletConnectionError,
  WalletDisconnectedError,
  WalletNotReadyError,
  WalletSendTransactionError,
  WalletSignTransactionError,
  WalletTimeoutError,
  WalletWindowClosedError,
  type Adapter,
} from "@solana/wallet-adapter-base";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleWalletError, onWalletError, walletErrorLevel } from "@/lib/wallet-errors";

afterEach(() => vi.restoreAllMocks());
const adapter = { name: "Phantom", url: "https://phantom.app" } as unknown as Adapter;
const run = (e: Error) => {
  const log = vi.fn();
  const open = vi.fn();
  handleWalletError(e as never, adapter, { log, open });
  return { log, open };
};
const phantomReject = () => Object.assign(new Error("User rejected the request."), { code: 4001 });

describe("silent: user rejection / cancel", () => {
  it("Phantom reject wrapped in WalletSignTransactionError (message + .error code 4001)", () => {
    const e = new WalletSignTransactionError("User rejected the request.", phantomReject());
    expect(walletErrorLevel(e)).toBe("silent");
    const { log, open } = run(e);
    expect(log).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
  it("code-only 4001 on .error, on a cause chain, and string code / ACTION_REJECTED", () => {
    expect(walletErrorLevel(new WalletSignTransactionError("", { code: 4001 }))).toBe("silent");
    expect(walletErrorLevel(new WalletSendTransactionError("x", new Error("y", { cause: { code: "4001" } })))).toBe("silent");
    expect(walletErrorLevel(Object.assign(new Error("z"), { code: "ACTION_REJECTED" }))).toBe("silent");
  });
  it("user cancelling the connect prompt (incl. autoConnect) is silent", () => {
    expect(walletErrorLevel(new WalletConnectionError("User rejected the request.", phantomReject()))).toBe("silent");
    expect(walletErrorLevel(new WalletConnectionError("Connection cancelled by user"))).toBe("silent");
  });
  it("default handler is not reached: Providers passes onError", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    onWalletError(new WalletSignTransactionError("User rejected the request.", phantomReject()), adapter);
    expect(err).not.toHaveBeenCalled();
    expect(readFileSync("src/components/Providers.tsx", "utf8")).toMatch(/<WalletProvider wallets=\{wallets\} autoConnect onError=\{onWalletError\}>/);
  });
});

describe("visible: every other wallet error", () => {
  it.each([
    ["sign failure without rejection", new WalletSignTransactionError("Something went wrong", new Error("internal"))],
    ["sign wrapper with no detail", new WalletSignTransactionError()],
    ["connection failure (autoConnect)", new WalletConnectionError("Unexpected error", new Error("boom"))],
    ["timeout", new WalletTimeoutError()],
    ["disconnected", new WalletDisconnectedError()],
    ["window closed", new WalletWindowClosedError("The wallet window was closed.")],
    ["unknown error", new Error("weird")],
  ])("%s → console.error", (_label, e) => {
    expect(walletErrorLevel(e)).toBe("error");
    const { log, open } = run(e);
    expect(log).toHaveBeenCalledWith(e, adapter);
    expect(open).not.toHaveBeenCalled();
  });
  it("WalletNotReady → logged AND opens the wallet install page (adapter default kept)", () => {
    const e = new WalletNotReadyError();
    const { log, open } = run(e);
    expect(log).toHaveBeenCalledWith(e, adapter);
    expect(open).toHaveBeenCalledWith("https://phantom.app");
  });
  it("real console.error used by default", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    onWalletError(new WalletConnectionError("Unexpected error") as never, adapter);
    expect(err).toHaveBeenCalledTimes(1);
  });
});
