"use client";

/**
 * First-party, anonymous usage events → POST /api/events. No third-party
 * trackers, no cookies, no IP or user agent stored.
 *
 * - Anonymous id: random UUID in localStorage (`pbc:anon-id`), so returning
 *   visits on the same browser can be counted. Clearing site data resets it.
 * - Off when the browser sends Do Not Track / Global Privacy Control, or the
 *   user turned usage stats off (footer control, `pbc:usage-off`).
 * - A wallet address is attached only when a wallet is connected AND the user
 *   switched on "include my wallet" (`pbc:usage-wallet` = "1").
 */

import type { UsageEventName } from "@/lib/evidence/schema";

const ANON_KEY = "pbc:anon-id";
const OFF_KEY = "pbc:usage-off";
const WALLET_KEY = "pbc:usage-wallet";
export const USAGE_PREFS_EVENT = "pbc-usage-prefs";

function ls(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function browserOptsOut(): boolean {
  if (typeof navigator === "undefined") return true;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack === "1" || nav.globalPrivacyControl === true;
}

export function usageEnabled(): boolean {
  return !browserOptsOut() && ls()?.getItem(OFF_KEY) !== "1";
}

export function walletSharingEnabled(): boolean {
  return ls()?.getItem(WALLET_KEY) === "1";
}

export function setUsagePrefs(p: { enabled?: boolean; shareWallet?: boolean }) {
  const s = ls();
  if (!s) return;
  if (p.enabled !== undefined) {
    if (p.enabled) s.removeItem(OFF_KEY);
    else s.setItem(OFF_KEY, "1");
  }
  if (p.shareWallet !== undefined) {
    if (p.shareWallet) s.setItem(WALLET_KEY, "1");
    else s.removeItem(WALLET_KEY);
  }
  window.dispatchEvent(new Event(USAGE_PREFS_EVENT));
}

export function anonId(): string | null {
  const s = ls();
  if (!s) return null;
  let id = s.getItem(ANON_KEY);
  if (!id || !/^[a-z0-9-]{8,64}$/i.test(id)) {
    id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    s.setItem(ANON_KEY, id);
  }
  return id;
}

/** The connected wallet (set by WalletButton/Providers) — sent only with consent. */
let connectedWallet: string | null = null;
export function setTelemetryWallet(w: string | null) {
  connectedWallet = w;
}

export function track(event: UsageEventName, props: { marketId?: string; mode?: string } = {}) {
  if (!usageEnabled()) return;
  const id = anonId();
  if (!id) return;
  const body = JSON.stringify({
    anonId: id,
    event,
    path: window.location.pathname.slice(0, 200),
    ...(props.marketId ? { marketId: props.marketId } : {}),
    ...(props.mode ? { mode: props.mode } : {}),
    ...(connectedWallet && walletSharingEnabled() ? { wallet: connectedWallet } : {}),
  });
  try {
    const blob = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon?.("/api/events", blob)) return;
  } catch {
    /* fall through */
  }
  void fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
}
