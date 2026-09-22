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

function PhasePill({ phase }: { phase: string }) {
  const p = phase.toLowerCase();
  const color =
    p === "primary"
      ? "bg-cyan-400/10 text-cyan-300 border-cyan-400/25"
      : p === "secondary"
        ? "bg-zinc-400/10 text-zinc-300 border-zinc-400/25"
        : p === "resolved"
          ? "bg-emerald-400/10 text-emerald-300 border-emerald-400/25"
          : "bg-zinc-500/10 text-zinc-400 border-zinc-500/25";
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${color}`}
    >
      {phase}
    </span>
  );
}

function MiniProb({ yes }: { yes: number }) {
  const y = Math.round(yes * 100);
  const n = 100 - y;
  return (
    <div className="w-20 shrink-0 sm:w-24">
      <div className="font-num text-[11px] font-semibold tabular-nums text-zinc-100">
        {y}%
      </div>
      <div className="mt-1 flex h-1 w-full overflow-hidden rounded-full bg-[#1f1f23]">
        <div className="h-full bg-emerald-500" style={{ width: `${y}%` }} />
        <div className="h-full bg-rose-500" style={{ width: `${n}%` }} />
      </div>
      <div className="mt-0.5 flex justify-between font-num text-[8px]">
        <span className="text-emerald-400">Y {y}¢</span>
        <span className="text-rose-400">N {n}¢</span>
      </div>
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
        rotateX: -3,
        rotateY: 4,
        y: -3,
        transition: { type: "spring", stiffness: 320, damping: 22 },
      }}
      whileTap={{ scale: 0.98 }}
    >
      {children}
    </motion.div>
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

const CATALOG_ROWS = [
  {
    cat: "Crypto",
    title: "Will SOL close above $250 this week?",
    phase: "Primary",
    yes: 0.58,
    vol: "12.4k USDC",
    ends: "Ends Fri",
  },
  {
    cat: "Politics",
    title: "Fed holds rates through next FOMC?",
    phase: "Primary",
    yes: 0.71,
    vol: "8.1k USDC",
    ends: "Ends Sep 30",
  },
  {
    cat: "Sports",
    title: "Lakers cover −4.5 vs Celtics?",
    phase: "Secondary",
    yes: 0.44,
    vol: "3.2k USDC",
    ends: "Ends tip-off",
  },
];

/** Catalog rows with titles/odds — desk vocabulary, illustrative only. */
export function MockCatalogChrome({ stagger = false }: { stagger?: boolean }) {
  const reduce = useReducedMotion();
  return (
    <MockFrame title="desk · catalog">
      <div className="divide-y divide-[#1f1f23]" aria-hidden>
        {CATALOG_ROWS.map((row, i) => (
          <motion.div
            key={row.title}
            className="flex items-center gap-3 px-3 py-2.5 sm:px-4"
            initial={stagger && !reduce ? { opacity: 0, y: 10 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.35,
              delay: stagger && !reduce ? i * 0.08 : 0,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[9px] font-medium uppercase tracking-wider text-zinc-600">
                  {row.cat}
                </span>
                <PhasePill phase={row.phase} />
              </div>
              <div className="mt-1 truncate text-[12px] font-medium leading-snug text-zinc-100">
                {row.title}
              </div>
              <div className="mt-1 flex gap-2 font-num text-[9px] text-zinc-600">
                <span>{row.vol}</span>
                <span>·</span>
                <span>{row.ends}</span>
              </div>
            </div>
            <MiniProb yes={row.yes} />
          </motion.div>
        ))}
      </div>
    </MockFrame>
  );
}

/** AI brief panel matching AiBrief tone chips + narrative lines. */
export function MockBriefPanel({ reveal = false }: { reveal?: boolean }) {
  const reduce = useReducedMotion();
  const lines = [
    "Tape leans YES after two primary prints at 57–59¢.",
    "Edge: spot SOL momentum vs week-end resolution window.",
    "Risk: overnight gap if macro prints hit before Fri close.",
  ];
  return (
    <TiltCard>
      <MockFrame title="desk · AI brief">
        <div className="space-y-3 p-4" aria-hidden>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded bg-cyan-400/15 px-1.5 py-0.5 font-num text-[9px] text-cyan-300">
              BRIEF
            </span>
            <span className="rounded border border-[#1f1f23] px-1.5 py-0.5 text-[9px] text-zinc-500">
              Template
            </span>
            {(["Bull", "Neutral", "Bear"] as const).map((t) => (
              <span
                key={t}
                className={`rounded-full border px-2 py-0.5 text-[9px] font-medium ${
                  t === "Neutral"
                    ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-300"
                    : "border-[#1f1f23] bg-[#0a0a0b] text-zinc-600"
                }`}
              >
                {t}
              </span>
            ))}
          </div>
          <div className="space-y-2">
            {lines.map((line, i) => (
              <motion.p
                key={line}
                className="text-[12px] leading-relaxed text-zinc-300"
                initial={reveal && !reduce ? { opacity: 0, y: 6 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.35,
                  delay: reveal && !reduce ? 0.12 + i * 0.12 : 0,
                }}
              >
                {line}
              </motion.p>
            ))}
          </div>
          <div className="rounded-md border border-[#1f1f23] bg-[#111113] p-3">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">
              Edge hypothesis
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400">
              Primary YES underprices weekend carry if SOL holds $240+.
            </p>
          </div>
          <div className="flex h-8 items-center justify-center rounded-md bg-cyan-400/90 text-[11px] font-semibold text-[#0a0a0b]">
            Generate brief
          </div>
        </div>
      </MockFrame>
    </TiltCard>
  );
}

const TICKET_STEPS = [
  "Quote",
  "Build VT",
  "Sign",
  "Submit",
  "Verify",
  "Attribute",
] as const;

/** Execute ticket with one cyan active step (stateful, not static list). */
export function MockTicketPanel({ activeStep = 3 }: { activeStep?: number }) {
  return (
    <TiltCard>
      <MockFrame title="desk · execute ticket">
        <div className="p-4" aria-hidden>
          <div className="flex items-center justify-between text-[10px] text-zinc-500">
            <span>Primary buy · YES · 25 USDC</span>
            <span className="font-num text-cyan-400/80">1-shot</span>
          </div>
          <div className="mt-1 text-[11px] font-medium text-zinc-200">
            Will SOL close above $250 this week?
          </div>
          <div className="mt-3 space-y-1.5">
            {TICKET_STEPS.map((s, i) => {
              const done = i < activeStep;
              const active = i === activeStep;
              return (
                <div
                  key={s}
                  className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 ${
                    active
                      ? "border-cyan-400/40 bg-cyan-400/10 shadow-[0_0_12px_rgba(34,211,238,0.12)]"
                      : "border-[#1f1f23] bg-[#111113]"
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded-full font-num text-[8px] ${
                      done
                        ? "bg-cyan-400/20 text-cyan-300"
                        : active
                          ? "bg-cyan-400 text-[#0a0a0b]"
                          : "bg-[#1c1c1f] text-zinc-600"
                    }`}
                  >
                    {done ? "✓" : i + 1}
                  </span>
                  <span
                    className={`text-[11px] ${
                      active ? "font-semibold text-cyan-200" : "text-zinc-300"
                    }`}
                  >
                    {s}
                  </span>
                  {active && (
                    <span className="ml-auto font-num text-[9px] text-cyan-400/70">
                      in flight
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </MockFrame>
    </TiltCard>
  );
}

const BOOK_ROWS = [
  {
    title: "SOL > $250 week",
    side: "YES" as const,
    fill: "Attributed · 25 USDC @ 58¢",
    status: "Open",
    claimable: false,
  },
  {
    title: "Fed holds rates",
    side: "NO" as const,
    fill: "Attributed · 40 USDC @ 28¢",
    status: "Open",
    claimable: false,
  },
  {
    title: "ETH ETF inflow week",
    side: "YES" as const,
    fill: "Resolved win · claim ready",
    status: "Claim",
    claimable: true,
  },
];

/** Book / activity ledger with attributed fills + one claimable win. */
export function MockBookPanel({ slide = false }: { slide?: boolean }) {
  const reduce = useReducedMotion();
  return (
    <TiltCard>
      <MockFrame title="desk · book / activity">
        <div className="divide-y divide-[#1f1f23]" aria-hidden>
          {BOOK_ROWS.map((row, i) => (
            <motion.div
              key={row.title}
              className="flex items-center gap-3 px-4 py-3"
              initial={slide && !reduce ? { opacity: 0, x: 16 } : false}
              animate={{ opacity: 1, x: 0 }}
              transition={{
                duration: 0.4,
                delay: slide && !reduce ? i * 0.1 : 0,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-medium text-zinc-100">
                  {row.title}
                </div>
                <div className="mt-0.5 font-num text-[10px] text-zinc-500">
                  {row.fill}
                </div>
              </div>
              <span
                className={`font-num text-[11px] font-semibold ${
                  row.side === "YES" ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {row.side}
              </span>
              {row.claimable ? (
                <span className="rounded border border-cyan-400/35 bg-cyan-400/10 px-1.5 py-0.5 font-num text-[9px] text-cyan-300">
                  Claim
                </span>
              ) : (
                <span className="rounded border border-[#1f1f23] px-1.5 py-0.5 font-num text-[9px] text-zinc-600">
                  {row.status}
                </span>
              )}
            </motion.div>
          ))}
        </div>
      </MockFrame>
    </TiltCard>
  );
}

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
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-600">
              Crypto
            </span>
            <PhasePill phase="Primary" />
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
              transition={{
                duration: reduce ? 0 : 0.7,
                ease: [0.22, 1, 0.36, 1],
              }}
            />
            <motion.div
              className="h-full bg-rose-500"
              initial={reduce ? false : { scaleX: 0 }}
              animate={{ scaleX: 1 }}
              style={{ width: `${no * 100}%`, originX: 1 }}
              transition={{
                duration: reduce ? 0 : 0.7,
                delay: reduce ? 0 : 0.08,
                ease: [0.22, 1, 0.36, 1],
              }}
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

/**
 * Composed desk snapshot for hero / destination —
 * brief strip + YES/NO + tape rows + sticky ticket chrome.
 */
export function MockComposedDesk({ dense = false }: { dense?: boolean }) {
  return (
    <MockFrame
      title="desk · composed"
      className={dense ? "shadow-[0_0_60px_rgba(34,211,238,0.08)]" : ""}
    >
      <div className="grid gap-0 md:grid-cols-[1.15fr_0.85fr]" aria-hidden>
        {/* Left: market + brief + tape */}
        <div className="border-b border-[#1f1f23] md:border-b-0 md:border-r">
          <div className="border-b border-[#1f1f23] px-3 py-2.5 sm:px-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[9px] font-medium uppercase tracking-wider text-zinc-600">
                Crypto
              </span>
              <PhasePill phase="Primary" />
              <span className="ml-auto font-num text-[9px] text-zinc-600">
                Illustrative sample
              </span>
            </div>
            <div className="mt-1.5 text-[13px] font-semibold leading-snug text-zinc-50">
              Will SOL close above $250 this week?
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-md border border-emerald-500/20 bg-emerald-500/[0.07] px-2.5 py-2">
                <div className="text-[9px] uppercase tracking-wider text-emerald-400/80">
                  Yes
                </div>
                <div className="font-num text-lg font-semibold text-emerald-300">
                  58%
                </div>
              </div>
              <div className="rounded-md border border-rose-500/20 bg-rose-500/[0.07] px-2.5 py-2">
                <div className="text-[9px] uppercase tracking-wider text-rose-400/80">
                  No
                </div>
                <div className="font-num text-lg font-semibold text-rose-300">
                  42%
                </div>
              </div>
            </div>
            <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-[#1f1f23]">
              <div className="h-full w-[58%] bg-emerald-500" />
              <div className="h-full w-[42%] bg-rose-500" />
            </div>
          </div>

          <div className="border-b border-[#1f1f23] px-3 py-2.5 sm:px-4">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="rounded bg-cyan-400/15 px-1.5 py-0.5 font-num text-[8px] text-cyan-300">
                BRIEF
              </span>
              <span className="text-[9px] text-zinc-600">Neutral · Template</span>
            </div>
            <p className="text-[11px] leading-relaxed text-zinc-400">
              Tape leans YES after primary prints at 57–59¢. Weekend carry favors
              holders if SOL holds $240+.
            </p>
          </div>

          <div className="px-3 py-2 sm:px-4">
            <div className="mb-1.5 text-[9px] uppercase tracking-wider text-zinc-600">
              Tape
            </div>
            <div className="space-y-1">
              {[
                { side: "YES", amt: "25 USDC", px: "58¢" },
                { side: "YES", amt: "10 USDC", px: "57¢" },
                { side: "NO", amt: "15 USDC", px: "41¢" },
              ].map((t, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded border border-[#1f1f23] bg-[#111113] px-2 py-1 font-num text-[10px]"
                >
                  <span
                    className={
                      t.side === "YES" ? "text-emerald-400" : "text-rose-400"
                    }
                  >
                    {t.side}
                  </span>
                  <span className="text-zinc-500">{t.amt}</span>
                  <span className="ml-auto text-zinc-400">{t.px}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: sticky ticket */}
        <div className="bg-[#0c0c0e] px-3 py-3 sm:px-4">
          <div className="flex items-center justify-between text-[10px] text-zinc-500">
            <span>Execute</span>
            <span className="font-num text-cyan-400/80">Primary · 1-shot</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <YesNoBtn side="yes" pct={58} />
            <YesNoBtn side="no" pct={42} />
          </div>
          <div className="mt-3 space-y-1">
            {TICKET_STEPS.slice(0, dense ? 6 : 4).map((s, i) => {
              const done = i < 2;
              const active = i === 2;
              return (
                <div
                  key={s}
                  className={`flex items-center gap-2 rounded border px-2 py-1 ${
                    active
                      ? "border-cyan-400/35 bg-cyan-400/8"
                      : "border-[#1f1f23] bg-[#111113]"
                  }`}
                >
                  <span
                    className={`font-num text-[8px] ${
                      done || active ? "text-cyan-300" : "text-zinc-600"
                    }`}
                  >
                    {done ? "✓" : i + 1}
                  </span>
                  <span className="text-[10px] text-zinc-300">{s}</span>
                </div>
              );
            })}
          </div>
          {dense && (
            <div className="mt-3 rounded-md border border-[#1f1f23] bg-[#111113] px-2.5 py-2">
              <div className="text-[9px] uppercase tracking-wider text-zinc-600">
                Book peek
              </div>
              <div className="mt-1 flex items-center justify-between text-[10px]">
                <span className="text-zinc-400">1 open YES · 25 USDC</span>
                <span className="font-num text-emerald-400">Attributed</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </MockFrame>
  );
}
