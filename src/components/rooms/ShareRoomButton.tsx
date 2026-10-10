"use client";

import { useState } from "react";

/** Native share sheet where available, else copy the canonical link. */
export function ShareRoomButton({ url, title, text }: { url: string; title: string; text?: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const share = async () => {
    const absolute = new URL(url, window.location.origin).toString();
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text, url: absolute });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(absolute);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
    setTimeout(() => setStatus("idle"), 2500);
  };
  return (
    <button type="button" onClick={share} className="btn btn-secondary btn-sm shrink-0" aria-live="polite">
      {status === "copied" ? "Link copied" : status === "failed" ? "Copy failed" : "Share"}
    </button>
  );
}
