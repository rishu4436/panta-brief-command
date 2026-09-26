"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { IconArrowRight, IconClose, IconPlay } from "../ui/Icons";

/**
 * "Watch Demo": no recorded demo exists yet, so this opens an honest
 * placeholder dialog that points to the live desk and How it works.
 */
export function DemoButton() {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <>
      <button type="button" className="btn btn-secondary btn-lg" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <IconPlay className="h-4 w-4" />
        Watch Demo
      </button>
      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setOpen(false);
        }}
        aria-labelledby="demo-title"
        className="m-auto w-[min(92vw,480px)] rounded-2xl border border-line-strong bg-elevated p-0 text-ink shadow-2xl backdrop:bg-bg/80 backdrop:backdrop-blur-sm"
      >
        <div className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="eyebrow">Demo</p>
              <h2 id="demo-title" className="h-card mt-2">
                Demo video coming soon
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="btn btn-ghost btn-sm -mr-2 -mt-1 h-11 w-11 p-0"
              aria-label="Close dialog"
            >
              <IconClose className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-ink-2">
            We haven&apos;t recorded a walkthrough yet. The fastest way to see Brief Command is the live desk:
            it runs on real Panta markets, and you can browse and read briefs without connecting a wallet.
          </p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <Link href="/desk" className="btn btn-primary">
              Open Trading Desk <IconArrowRight className="h-4 w-4" />
            </Link>
            <a href="#how-it-works" className="btn btn-secondary" onClick={() => setOpen(false)}>
              See how it works
            </a>
          </div>
        </div>
      </dialog>
    </>
  );
}
