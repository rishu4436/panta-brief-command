"use client";

import { useSyncExternalStore } from "react";
import { browserOptsOut, setUsagePrefs, USAGE_PREFS_EVENT, usageEnabled, walletSharingEnabled } from "@/lib/telemetry";

function subscribe(cb: () => void) {
  window.addEventListener(USAGE_PREFS_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(USAGE_PREFS_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** Footer control for first-party usage stats (anonymous by default). */
export function UsageConsent() {
  const snap = useSyncExternalStore(
    subscribe,
    () => `${browserOptsOut() ? "dnt" : usageEnabled() ? "on" : "off"}|${walletSharingEnabled() ? "w" : ""}`,
    () => "ssr|",
  );
  const [state, w] = snap.split("|");
  if (state === "ssr") return null;
  if (state === "dnt") {
    return <p className="text-[12px] text-ink-3">Usage stats: off (your browser sends Do Not Track / GPC).</p>;
  }
  const on = state === "on";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-ink-3">
      <label className="inline-flex min-h-11 items-center gap-2">
        <input type="checkbox" checked={on} onChange={(e) => setUsagePrefs({ enabled: e.target.checked })} />
        Anonymous usage stats (first-party, no trackers)
      </label>
      <label className={`inline-flex min-h-11 items-center gap-2 ${on ? "" : "opacity-50"}`}>
        <input type="checkbox" disabled={!on} checked={on && w === "w"} onChange={(e) => setUsagePrefs({ shareWallet: e.target.checked })} />
        Include my connected wallet address
      </label>
    </div>
  );
}
