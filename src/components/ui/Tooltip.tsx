"use client";

import { useId, useState, type ReactNode } from "react";

/**
 * Small accessible tooltip for supplementary hints only (never fees or
 * transaction details). Opens on hover and keyboard focus; Escape closes.
 */
export function Tooltip({ label, children, className = "" }: { label: ReactNode; children: ReactNode; className?: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
      aria-describedby={open ? id : undefined}
    >
      {children}
      <span
        id={id}
        role="tooltip"
        className={`pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-max max-w-[240px] -translate-x-1/2 rounded-lg border border-line-strong bg-elevated px-2.5 py-1.5 text-[12px] leading-snug text-ink-2 shadow-xl transition-opacity duration-150 ${
          open ? "opacity-100" : "opacity-0"
        }`}
      >
        {label}
      </span>
    </span>
  );
}
