"use client";

import Link from "next/link";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BrandMark } from "@/components/BrandMark";
import {
  MockBookPanel,
  MockBriefPanel,
  MockCatalogChrome,
  MockMarketCard,
  MockTicketPanel,
  YesNoBtn,
} from "./mocks";

const PATH = [
  {
    id: "intel",
    step: "01",
    title: "Intel",
    href: "/desk",
    body: "Scan the live catalog, open a market, read odds and tape. Density over demos.",
    mock: "catalog" as const,
  },
  {
    id: "brief",
    step: "02",
    title: "Brief",
    href: "/desk",
    body: "One-click desk narrative from real detail prices and trade prints. Templated or OpenAI.",
    mock: "brief" as const,
  },
  {
    id: "execute",
    step: "03",
    title: "Execute",
    href: "/execute",
    body: "Primary buy in one shot: Quote → Build → Sign → Submit → Verify → Attribute.",
    mock: "ticket" as const,
  },
  {
    id: "book",
    step: "04",
    title: "Book",
    href: "/book",
    body: "Positions, attributed fills, win and creator-fee claims when markets resolve.",
    mock: "book" as const,
  },
];

const IMMERSION = [
  {
    title: "Market card",
    body: "Mirrored YES/NO bars, phase chrome, press-scale outcomes — Prediction Royale energy, Brief Command desk DNA.",
    panel: "card" as const,
  },
  {
    title: "AI brief",
    body: "Operator narrative that sits next to the tape. Generate, skim, act — no blog posts.",
    panel: "brief" as const,
  },
  {
    title: "Execute ticket",
    body: "Sticky one-shot pipeline. Wallet signs once; server proxy keeps the API key dark.",
    panel: "ticket" as const,
  },
  {
    title: "Activity book",
    body: "Attributed buys and claims in a ledger you can audit after every fill.",
    panel: "book" as const,
  },
];

function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 28 });
  const reduce = useReducedMotion();
  if (reduce) return null;
  return <motion.div className="landing-progress" style={{ scaleX }} />;
}

function CursorGlow() {
  const reduce = useReducedMotion();
  const x = useMotionValue(-999);
  const y = useMotionValue(-999);

  useEffect(() => {
    if (reduce) return;
    const onMove = (e: PointerEvent) => {
      x.set(e.clientX);
      y.set(e.clientY);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [reduce, x, y]);

  if (reduce) return null;
  return <motion.div className="landing-cursor-glow" style={{ left: x, top: y }} />;
}

function ParticleField() {
  const reduce = useReducedMotion();
  if (reduce) return null;
  const dots = Array.from({ length: 28 }, (_, i) => i);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {dots.map((i) => {
        const left = ((i * 37) % 100);
        const top = ((i * 53) % 100);
        const delay = (i % 7) * 0.4;
        const dur = 6 + (i % 5);
        const color =
          i % 3 === 0 ? "bg-emerald-400/30" : i % 3 === 1 ? "bg-cyan-400/30" : "bg-rose-400/25";
        return (
          <motion.span
            key={i}
            className={`landing-particle absolute h-1 w-1 rounded-full ${color}`}
            style={{ left: `${left}%`, top: `${top}%` }}
            animate={{ y: [0, -18, 0], opacity: [0.2, 0.7, 0.2] }}
            transition={{ duration: dur, delay, repeat: Infinity, ease: "easeInOut" }}
          />
        );
      })}
    </div>
  );
}

function MagneticCta({
  href,
  children,
  primary,
  external,
}: {
  href: string;
  children: ReactNode;
  primary?: boolean;
  external?: boolean;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLAnchorElement>(null);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 280, damping: 18 });
  const sy = useSpring(my, { stiffness: 280, damping: 18 });

  const onMove = (e: React.PointerEvent) => {
    if (reduce || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    mx.set(dx * 0.22);
    my.set(dy * 0.22);
  };
  const onLeave = () => {
    mx.set(0);
    my.set(0);
  };

  const className = primary
    ? "landing-haptic inline-flex items-center rounded-md bg-cyan-400 px-6 py-3 text-sm font-semibold text-[#0a0a0b] shadow-lg shadow-cyan-400/25"
    : "landing-haptic inline-flex items-center rounded-md border border-[#1f1f23] bg-[#111113] px-6 py-3 text-sm font-medium text-zinc-300";

  const shared = {
    ref,
    className,
    onPointerMove: onMove,
    onPointerLeave: onLeave,
  } as const;

  return (
    <motion.div style={{ x: sx, y: sy }}>
      {external ? (
        <a href={href} target="_blank" rel="noreferrer" {...shared}>
          {children}
        </a>
      ) : (
        <Link href={href} {...shared}>
          {children}
        </Link>
      )}
    </motion.div>
  );
}

function FloatingDualBars() {
  const reduce = useReducedMotion();
  return (
    <div className="relative mx-auto mt-10 w-full max-w-lg">
      <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-zinc-600">
        <span>Illustrative probability</span>
        <span className="font-num">YES · NO</span>
      </div>
      <div className="relative flex h-14 overflow-hidden rounded-2xl border border-[#1f1f23] bg-[#0e0e10]">
        <motion.div
          className="flex items-center justify-center bg-emerald-500/90 font-num text-lg font-bold text-[#0a0a0b]"
          initial={reduce ? false : { width: "40%" }}
          animate={{ width: ["42%", "64%", "55%", "61%", "48%"] }}
          transition={
            reduce
              ? { duration: 0 }
              : { duration: 8, repeat: Infinity, ease: "easeInOut" }
          }
          style={reduce ? { width: "58%" } : undefined}
        >
          YES
        </motion.div>
        <motion.div
          className="flex flex-1 items-center justify-center bg-rose-500/90 font-num text-lg font-bold text-[#0a0a0b]"
          layout={!reduce}
        >
          NO
        </motion.div>
      </div>
      <div className="mt-3 flex justify-center gap-2">
        <YesNoBtn side="yes" pct={58} />
        <YesNoBtn side="no" pct={42} />
      </div>
    </div>
  );
}

function Hero() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });
  const yGrid = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : 120]);
  const opacity = useTransform(scrollYProgress, [0, 0.85], [1, reduce ? 1 : 0.15]);

  return (
    <motion.section
      ref={ref}
      style={{ opacity }}
      className="relative min-h-[100svh] overflow-hidden border-b border-[#1f1f23] px-4 pb-20 pt-16 md:pt-24"
    >
      <motion.div
        className="landing-grid pointer-events-none absolute inset-0"
        style={{ y: yGrid }}
      />
      <ParticleField />
      <div className="pointer-events-none absolute -left-32 top-24 h-72 w-72 rounded-full bg-emerald-500/8 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-10 h-64 w-64 rounded-full bg-rose-500/8 blur-3xl" />
      <div className="pointer-events-none absolute left-1/2 top-1/3 h-48 w-48 -translate-x-1/2 rounded-full bg-cyan-400/6 blur-3xl" />

      <div className="relative mx-auto max-w-5xl text-center">
        <motion.div
          className="mb-6 inline-flex items-center gap-3"
          initial={reduce ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55 }}
        >
          <BrandMark className="h-9 w-9" />
          <a
            href="https://panta.market"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-full border border-[#1f1f23] bg-[#111113]/90 px-3 py-1 text-[10px] text-zinc-400 transition hover:border-cyan-400/30 hover:text-zinc-200"
          >
            Powered by <span className="ml-1 text-zinc-100">Panta</span>
          </a>
        </motion.div>

        <motion.h1
          className="text-[clamp(2.8rem,9vw,6.5rem)] font-semibold leading-[0.92] tracking-tight text-zinc-50"
          initial={reduce ? false : { opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.08 }}
        >
          Brief
          <br />
          <span className="bg-gradient-to-r from-emerald-300 via-cyan-300 to-rose-300 bg-clip-text text-transparent">
            Command
          </span>
        </motion.h1>

        <motion.p
          className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-zinc-400 md:text-lg"
          initial={reduce ? false : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.18 }}
        >
          The operator desk for Solana prediction markets — intel, AI briefs,
          primary executes, and book claims. Product story here. Live markets on{" "}
          <Link href="/desk" className="text-cyan-400 hover:underline">
            /desk
          </Link>
          .
        </motion.p>

        <motion.div
          className="mt-8 flex flex-wrap items-center justify-center gap-3"
          initial={reduce ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.28 }}
        >
          <MagneticCta href="/desk" primary>
            Open desk →
          </MagneticCta>
          <MagneticCta href="https://docs.panta.market/" external>API docs</MagneticCta>
        </motion.div>

        <motion.div
          initial={reduce ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.38 }}
        >
          <FloatingDualBars />
        </motion.div>

        <motion.p
          className="mt-10 font-num text-[11px] uppercase tracking-[0.22em] text-zinc-600"
          animate={reduce ? undefined : { opacity: [0.35, 0.85, 0.35] }}
          transition={{ duration: 2.4, repeat: Infinity }}
        >
          Scroll the path
        </motion.p>
      </div>
    </motion.section>
  );
}

function PathMock({ kind }: { kind: (typeof PATH)[number]["mock"] }) {
  switch (kind) {
    case "catalog":
      return <MockCatalogChrome />;
    case "brief":
      return <MockBriefPanel />;
    case "ticket":
      return <MockTicketPanel />;
    case "book":
      return <MockBookPanel />;
  }
}

function PathSection() {
  const reduce = useReducedMotion();
  return (
    <section className="relative border-b border-[#1f1f23] px-4 py-20 md:py-28">
      <div className="mx-auto mb-14 max-w-3xl text-center">
        <p className="font-num text-[11px] uppercase tracking-[0.2em] text-cyan-400/80">
          How it works
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-50 md:text-5xl">
          Intel → Brief → Execute → Book
        </h2>
        <p className="mt-3 text-sm text-zinc-400 md:text-base">
          Four beats. One continuous operator path — Wager Predict energy, Brief
          Command DNA.
        </p>
      </div>

      <div className="mx-auto max-w-5xl space-y-24 md:space-y-32">
        {PATH.map((beat, i) => (
          <PathBeat key={beat.id} beat={beat} index={i} reduce={!!reduce} />
        ))}
      </div>
    </section>
  );
}

function PathBeat({
  beat,
  index,
  reduce,
}: {
  beat: (typeof PATH)[number];
  index: number;
  reduce: boolean;
}) {
  const flip = index % 2 === 1;
  return (
    <motion.div
      className={`grid items-center gap-8 md:grid-cols-2 md:gap-12 ${flip ? "md:[&>*:first-child]:order-2" : ""}`}
      initial={reduce ? false : { opacity: 0, y: 48 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.35 }}
      transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
    >
      <div>
        <div className="flex items-center gap-3">
          <span className="font-num text-sm text-cyan-400">{beat.step}</span>
          <h3 className="text-2xl font-semibold tracking-tight text-zinc-50 md:text-3xl">
            {beat.title}
          </h3>
        </div>
        <p className="mt-4 max-w-md text-[15px] leading-relaxed text-zinc-400">
          {beat.body}
        </p>
        <Link
          href={beat.href}
          className="landing-haptic mt-5 inline-flex text-[13px] font-medium text-cyan-400 hover:text-cyan-300"
        >
          Open {beat.title.toLowerCase()} →
        </Link>
      </div>
      <div className="relative">
        <div className="pointer-events-none absolute -inset-6 rounded-3xl bg-cyan-400/5 blur-2xl" />
        <div className="relative">
          <PathMock kind={beat.mock} />
        </div>
      </div>
    </motion.div>
  );
}

function ImmersionPanel({ kind }: { kind: (typeof IMMERSION)[number]["panel"] }) {
  switch (kind) {
    case "card":
      return <MockMarketCard />;
    case "brief":
      return <MockBriefPanel />;
    case "ticket":
      return <MockTicketPanel />;
    case "book":
      return <MockBookPanel />;
  }
}

function ImmersionSection() {
  const reduce = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"],
  });
  const active = useTransform(scrollYProgress, [0, 0.25, 0.5, 0.75, 1], [0, 1, 2, 3, 3]);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const unsub = active.on("change", (v) => {
      setIdx(Math.min(3, Math.max(0, Math.round(v))));
    });
    return () => unsub();
  }, [active, reduce]);

  if (reduce) {
    return (
      <section className="border-b border-[#1f1f23] px-4 py-20">
        <div className="mx-auto mb-10 max-w-3xl text-center">
          <h2 className="text-3xl font-semibold text-zinc-50">Feature immersion</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Desk chrome morphs — static mocks only.
          </p>
        </div>
        <div className="mx-auto grid max-w-5xl gap-6 sm:grid-cols-2">
          {IMMERSION.map((item) => (
            <div key={item.title}>
              <h3 className="mb-2 text-sm font-semibold text-zinc-100">{item.title}</h3>
              <p className="mb-3 text-[12px] text-zinc-400">{item.body}</p>
              <ImmersionPanel kind={item.panel} />
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section ref={containerRef} className="relative border-b border-[#1f1f23]">
      <div className="sticky top-12 flex min-h-[calc(100svh-3rem)] items-center px-4 py-12">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-10 md:grid-cols-2">
          <div>
            <p className="font-num text-[11px] uppercase tracking-[0.2em] text-cyan-400/80">
              Feature immersion
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-50 md:text-4xl">
              Scroll. The terminal morphs.
            </h2>
            <ul className="mt-8 space-y-4">
              {IMMERSION.map((item, i) => (
                <li key={item.title}>
                  <button
                    type="button"
                    onClick={() => setIdx(i)}
                    className={`w-full rounded-lg border px-4 py-3 text-left transition ${
                      idx === i
                        ? "border-cyan-400/35 bg-cyan-400/8"
                        : "border-transparent bg-transparent hover:border-[#1f1f23] hover:bg-[#111113]"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-num text-[10px] text-zinc-600">
                        0{i + 1}
                      </span>
                      <span
                        className={`text-[14px] font-semibold ${
                          idx === i ? "text-cyan-200" : "text-zinc-300"
                        }`}
                      >
                        {item.title}
                      </span>
                    </div>
                    <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
                      {item.body}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="relative min-h-[340px]">
            {IMMERSION.map((item, i) => (
              <motion.div
                key={item.title}
                className="absolute inset-0 flex items-center"
                initial={false}
                animate={{
                  opacity: idx === i ? 1 : 0,
                  y: idx === i ? 0 : 24,
                  scale: idx === i ? 1 : 0.96,
                  pointerEvents: idx === i ? "auto" : "none",
                }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="w-full">
                  <ImmersionPanel kind={item.panel} />
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
      {/* scroll runway */}
      <div className="h-[220vh]" aria-hidden />
    </section>
  );
}

function FinalCta() {
  const reduce = useReducedMotion();
  return (
    <section className="relative overflow-hidden px-4 py-28 md:py-36">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(34,211,238,0.12),_transparent_55%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent" />
      <div className="relative mx-auto max-w-3xl text-center">
        <motion.h2
          className="text-[clamp(2.2rem,7vw,4.5rem)] font-semibold leading-[1.02] tracking-tight text-zinc-50"
          initial={reduce ? false : { opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.65 }}
        >
          Enter the desk.
        </motion.h2>
        <motion.p
          className="mx-auto mt-4 max-w-md text-sm text-zinc-400 md:text-base"
          initial={reduce ? false : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.55, delay: 0.08 }}
        >
          Live markets, briefs, executes, and book — Brief Command, powered by
          Panta.
        </motion.p>
        <motion.div
          className="mt-8 flex flex-wrap items-center justify-center gap-3"
          initial={reduce ? false : { opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.15 }}
        >
          <MagneticCta href="/desk" primary>
            Open live desk →
          </MagneticCta>
          <a
            href="https://docs.panta.market/"
            target="_blank"
            rel="noreferrer"
            className="landing-haptic inline-flex items-center rounded-md border border-[#1f1f23] bg-[#111113] px-6 py-3 text-sm font-medium text-zinc-300"
          >
            Docs
          </a>
        </motion.div>
        <p className="mt-8 text-[11px] text-zinc-600">
          Brief Command ·{" "}
          <a
            href="https://panta.market"
            target="_blank"
            rel="noreferrer"
            className="text-zinc-400 hover:text-cyan-400"
          >
            Powered by Panta
          </a>
        </p>
      </div>
    </section>
  );
}

export function LandingExperience() {
  return (
    <div className="relative bg-[#0a0a0b]">
      <ScrollProgress />
      <CursorGlow />
      <Hero />
      <PathSection />
      <ImmersionSection />
      <FinalCta />
    </div>
  );
}
