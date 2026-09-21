"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

/** Shared chrome frame for static desk mocks — never live API. */
export function MockFrame({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-xl border border-[#1f1f23] bg-[#0e0e10] shadow-2xl shadow-black/40 ${className}`}
    >
      <div className="flex items-center gap-2 border-b border-[#1f1f23] px-3 py-2">
        <span className="h-1.5 w-1.5 rounded-full bg-[#2a2a2e]" />
        <span className="h-1.5 w-1.5 rounded-full bg-[#2a2a2e]" />
        <span className="h-1.5 w-1.5 rounded-full bg-[#2a2a2e]" />
        <span className="ml-1.5 font-num text-[10px] text-zinc-500">{title}</span>
        <span className="ml-auto rounded border border-[#1f1f23] px-1.5 py-0.5 font-num text-[8px] uppercase tracking-wider text-zinc-600">
          illustrative
        </span>
      </div>
      {children}
    </div>
  );
}

export function TiltCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) {
    return <div className={className}>{children}</div>;
  }
  return (
    <motion.div
      className={`landing-haptic ${className}`}
      style={{ transformPerspective: 900 }}
      whileHover={{
        rotateX: -4,
        rotateY: 6,
        y: -4,
        transition: { type: "spring", stiffness: 320, damping: 22 },
      }}
      whileTap={{ scale: 0.98 }}
    >
      {children}
    </motion.div>
  );
}

/** Mirrored YES/NO outcome card — Prediction Royale / beUI energy. */
export function MockMarketCard({
  label = "Will SOL close above $250 this week?",
  yes = 0.62,
  no = 0.38,
}: {
  label?: string;
  yes?: number;
  no?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <TiltCard>
      <MockFrame title="desk · market card">
        <div className="p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-600">
            Crypto · Primary
          </div>
          <div className="mt-2 text-[14px] font-semibold leading-snug text-zinc-100">
            {label}
          </div>
          <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-[#1f1f23]">
            <motion.div
              className="h-full bg-emerald-500"
              initial={reduce ? false : { scaleX: 0 }}
              animate={{ scaleX: 1 }}
              style={{ width: `${yes * 100}%`, originX: 0 }}
              transition={{ duration: reduce ? 0 : 0.8, ease: [0.22, 1, 0.36, 1] }}
            />
            <motion.div
              className="h-full bg-rose-500"
              initial={reduce ? false : { scaleX: 0 }}
              animate={{ scaleX: 1 }}
              style={{ width: `${no * 100}%`, originX: 1 }}
              transition={{ duration: reduce ? 0 : 0.8, delay: reduce ? 0 : 0.1, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <YesNoBtn side="yes" pct={Math.round(yes * 100)} />
            <YesNoBtn side="no" pct={Math.round(no * 100)} />
          </div>
        </div>
      </MockFrame>
    </TiltCard>
  );
}

export function YesNoBtn({
  side,
  pct,
}: {
  side: "yes" | "no";
  pct: number;
}) {
  const reduce = useReducedMotion();
  const isYes = side === "yes";
  return (
    <motion.button
      type="button"
      className={`landing-haptic flex items-center justify-between rounded-md border px-3 py-2 text-left ${
        isYes
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          : "border-rose-500/30 bg-rose-500/10 text-rose-300"
      }`}
      whileHover={reduce ? undefined : { scale: 1.03 }}
      whileTap={reduce ? undefined : { scale: 0.94 }}
      aria-label={`${isYes ? "YES" : "NO"} illustrative ${pct}%`}
    >
      <span className="text-[11px] font-semibold">{isYes ? "YES" : "NO"}</span>
      <span className="font-num text-[12px]">{pct}¢</span>
    </motion.button>
  );
}

export function MockBriefPanel() {
  return (
    <TiltCard>
      <MockFrame title="desk · AI brief">
        <div className="space-y-2.5 p-4" aria-hidden>
          <div className="flex items-center gap-2">
            <span className="rounded bg-cyan-400/15 px-1.5 py-0.5 font-num text-[9px] text-cyan-300">
              BRIEF
            </span>
            <span className="text-[10px] text-zinc-600">tone · operator</span>
          </div>
          <div className="h-2 w-full rounded bg-[#1c1c1f]" />
          <div className="h-2 w-[92%] rounded bg-[#1c1c1f]" />
          <div className="h-2 w-[78%] rounded bg-[#1c1c1f]" />
          <div className="mt-3 rounded-md border border-[#1f1f23] bg-[#111113] p-3">
            <div className="text-[10px] text-zinc-500">Edge hypothesis</div>
            <div className="mt-1.5 h-2 w-4/5 rounded bg-[#1c1c1f]" />
            <div className="mt-1.5 h-2 w-3/5 rounded bg-[#1c1c1f]" />
          </div>
          <div className="mt-2 h-8 rounded-md bg-cyan-400/90" />
        </div>
      </MockFrame>
    </TiltCard>
  );
}

export function MockTicketPanel() {
  return (
    <TiltCard>
      <MockFrame title="desk · execute ticket">
        <div className="p-4" aria-hidden>
          <div className="flex items-center justify-between text-[10px] text-zinc-500">
            <span>Primary buy</span>
            <span className="font-num text-cyan-400/80">1-shot</span>
          </div>
          <div className="mt-3 space-y-1.5">
            {["Quote", "Build VT", "Sign", "Submit", "Verify", "Attribute"].map(
              (s, i) => (
                <div
                  key={s}
                  className="flex items-center gap-2 rounded-md border border-[#1f1f23] bg-[#111113] px-2.5 py-1.5"
                >
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded-full font-num text-[8px] ${
                      i < 3
                        ? "bg-emerald-500/20 text-emerald-400"
                        : i === 3
                          ? "bg-cyan-400/20 text-cyan-300"
                          : "bg-[#1c1c1f] text-zinc-600"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="text-[11px] text-zinc-300">{s}</span>
                </div>
              ),
            )}
          </div>
        </div>
      </MockFrame>
    </TiltCard>
  );
}

export function MockBookPanel() {
  return (
    <TiltCard>
      <MockFrame title="desk · book">
        <div className="divide-y divide-[#1f1f23]" aria-hidden>
          {[
            { side: "YES", tint: "text-emerald-400" },
            { side: "NO", tint: "text-rose-400" },
            { side: "YES", tint: "text-emerald-400" },
          ].map((row, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="h-2 max-w-[10rem] rounded bg-[#1c1c1f]" />
                <div className="h-1.5 w-16 rounded bg-[#1c1c1f]" />
              </div>
              <span className={`font-num text-[11px] font-semibold ${row.tint}`}>
                {row.side}
              </span>
            </div>
          ))}
        </div>
      </MockFrame>
    </TiltCard>
  );
}

export function MockCatalogChrome() {
  return (
    <MockFrame title="brief-command · catalog chrome">
      <div className="divide-y divide-[#1f1f23]" aria-hidden>
        {[0.58, 0.41, 0.73].map((yes, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-2.5 max-w-[11rem] rounded bg-[#1c1c1f]" />
              <div className="flex gap-1.5">
                <div className="h-1.5 w-10 rounded bg-[#1c1c1f]" />
                <div className="h-1.5 w-8 rounded bg-[#1c1c1f]" />
              </div>
            </div>
            <div className="flex h-1.5 w-20 overflow-hidden rounded-full bg-[#1f1f23] sm:w-24">
              <div
                className="h-full bg-emerald-500/85"
                style={{ width: `${yes * 100}%` }}
              />
              <div
                className="h-full bg-rose-500/85"
                style={{ width: `${(1 - yes) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </MockFrame>
  );
}
