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
  MockComposedDesk,
  MockTicketPanel,
} from "./mocks";

const PATH = [
  {
    id: "intel",
    step: "01",
    title: "Intel",
    href: "/desk",
    body: "Scan the catalog, open a market, read odds and tape. Density over demos.",
    mock: "catalog" as const,
  },
  {
    id: "brief",
    step: "02",
    title: "Brief",
    href: "/desk",
    body: "Deterministic signals from live price and tape: flow split, price vs flow, risk flags, data quality. An LLM or template interprets them in Desk read, Flow, Risk, or Catalysts mode, with no buy/sell calls.",
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

function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 28 });
  const reduce = useReducedMotion();
  if (reduce) return null;
  return <motion.div className="landing-progress" style={{ scaleX }} />;
}

function MagneticCta({
  href,
  children,
  primary,
  external,
  onClick,
}: {
  href: string;
  children: ReactNode;
  primary?: boolean;
  external?: boolean;
  onClick?: (e: React.MouseEvent) => void;
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
    onClick,
  } as const;

  return (
    <motion.div style={{ x: sx, y: sy }}>
      {external ? (
        <a href={href} target="_blank" rel="noreferrer" {...shared}>
          {children}
        </a>
      ) : href.startsWith("#") ? (
        <a href={href} {...shared}>
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

function Hero() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });
  const yGrid = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : 80]);
  const opacity = useTransform(scrollYProgress, [0, 0.85], [1, reduce ? 1 : 0.2]);

  return (
    <motion.section
      ref={ref}
      style={{ opacity }}
      className="relative min-h-[100svh] overflow-hidden border-b border-[#1f1f23] px-4 pb-16 pt-14 md:pt-20"
    >
      <motion.div
        className="landing-grid pointer-events-none absolute inset-0"
        style={{ y: yGrid }}
      />
      {/* Cyan-only atmospheric — no emerald/rose brand glow */}
      <div className="pointer-events-none absolute left-1/2 top-1/4 h-72 w-72 -translate-x-1/2 rounded-full bg-cyan-400/7 blur-3xl" />

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
          <span className="text-cyan-300">Command</span>
        </motion.h1>

        <motion.p
          className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-zinc-400 md:text-lg"
          initial={reduce ? false : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.18 }}
        >
          The operator desk that turns Solana prediction markets into briefed,
          executable decisions.
        </motion.p>

        <motion.div
          className="mt-8 flex flex-wrap items-center justify-center gap-3"
          initial={reduce ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.28 }}
        >
          <MagneticCta href="/desk" primary>
            Enter the desk →
          </MagneticCta>
          <MagneticCta href="#path">See how it works</MagneticCta>
        </motion.div>

        <motion.div
          className="mx-auto mt-10 max-w-3xl"
          initial={reduce ? false : { opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.75, delay: 0.38 }}
        >
          <MockComposedDesk />
        </motion.div>

        <motion.p
          className="mt-10 font-num text-[11px] uppercase tracking-[0.22em] text-zinc-600"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.55 }}
        >
          Scroll the path
        </motion.p>
      </div>
    </motion.section>
  );
}

function ProofStrip() {
  const chips = [
    { k: "⌘K", v: "command" },
    { k: "j · k", v: "scan" },
    { k: "Enter", v: "open" },
    { k: "Primary", v: "Quote→Attribute" },
  ];
  const anatomy = ["Question", "Odds / tape", "Brief", "Execute", "Book"];

  return (
    <section className="border-b border-[#1f1f23] px-4 py-10 md:py-12">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-center justify-center gap-2">
          {chips.map((c) => (
            <span
              key={c.k}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#1f1f23] bg-[#111113] px-2.5 py-1.5"
            >
              <kbd className="font-num text-[11px] font-semibold text-cyan-300">
                {c.k}
              </kbd>
              <span className="text-[10px] text-zinc-500">{c.v}</span>
            </span>
          ))}
          <span className="inline-flex items-center rounded-md border border-[#1f1f23] px-2.5 py-1.5 font-num text-[10px] text-zinc-600">
            Illustrative on / · Live on /desk
          </span>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
          {anatomy.map((node, i) => (
            <span key={node} className="inline-flex items-center gap-1.5 sm:gap-2">
              <span
                className={`rounded-full border px-2.5 py-1 text-[11px] ${
                  i === 2
                    ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-200"
                    : "border-[#1f1f23] bg-[#0e0e10] text-zinc-400"
                }`}
              >
                {node}
              </span>
              {i < anatomy.length - 1 && (
                <span
                  className="hidden h-px w-4 bg-[#2a2a2e] sm:block"
                  aria-hidden
                />
              )}
            </span>
          ))}
        </div>

        <p className="mx-auto mt-5 max-w-xl text-center text-[12px] leading-relaxed text-zinc-500">
          Wallet signs once. Server proxy keeps the Panta API key dark.
          Attribution posts when the fill lands.
        </p>
      </div>
    </section>
  );
}

function PathMock({
  kind,
  active,
}: {
  kind: (typeof PATH)[number]["mock"];
  active: boolean;
}) {
  switch (kind) {
    case "catalog":
      return <MockCatalogChrome stagger={active} />;
    case "brief":
      return <MockBriefPanel reveal={active} />;
    case "ticket":
      return <MockTicketPanel activeStep={3} />;
    case "book":
      return <MockBookPanel slide={active} />;
  }
}

/** Single sticky scroll-scrubbed morph: Intel → Brief → Execute → Book */
function MorphJourney() {
  const reduce = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"],
  });
  const active = useTransform(
    scrollYProgress,
    [0, 0.22, 0.48, 0.74, 1],
    [0, 1, 2, 3, 3],
  );
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const unsub = active.on("change", (v) => {
      setIdx(Math.min(3, Math.max(0, Math.round(v))));
    });
    return () => unsub();
  }, [active, reduce]);

  const scrollToBeat = (i: number) => {
    const el = containerRef.current;
    if (!el) {
      setIdx(i);
      return;
    }
    const rect = el.getBoundingClientRect();
    const top = window.scrollY + rect.top;
    const runway = el.offsetHeight - window.innerHeight;
    const t = i / Math.max(1, PATH.length - 1);
    window.scrollTo({ top: top + runway * t, behavior: "smooth" });
    setIdx(i);
  };

  if (reduce) {
    return (
      <section
        id="path"
        className="scroll-mt-16 border-b border-[#1f1f23] px-4 py-20"
      >
        <div className="mx-auto mb-10 max-w-3xl text-center">
          <p className="font-num text-[11px] uppercase tracking-[0.2em] text-cyan-400/80">
            How it works
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-50 md:text-4xl">
            Intel → Brief → Execute → Book
          </h2>
          <p className="mt-3 text-sm text-zinc-400">
            Four beats. One operator path on Panta.
          </p>
        </div>
        <div className="mx-auto grid max-w-5xl gap-6 sm:grid-cols-2">
          {PATH.map((beat) => (
            <div key={beat.id}>
              <div className="mb-2 flex items-center gap-2">
                <span className="font-num text-[10px] text-cyan-400">
                  {beat.step}
                </span>
                <h3 className="text-sm font-semibold text-zinc-100">
                  {beat.title}
                </h3>
              </div>
              <p className="mb-3 text-[12px] text-zinc-400">{beat.body}</p>
              <PathMock kind={beat.mock} active={false} />
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section
      id="path"
      ref={containerRef}
      className="relative scroll-mt-12 border-b border-[#1f1f23]"
    >
      <div className="sticky top-12 flex min-h-[calc(100svh-3rem)] items-center px-4 py-10">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-10 md:grid-cols-2">
          <div>
            <p className="font-num text-[11px] uppercase tracking-[0.2em] text-cyan-400/80">
              How it works
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-50 md:text-4xl">
              Intel → Brief → Execute → Book
            </h2>
            <p className="mt-3 max-w-md text-sm text-zinc-400">
              Four beats. One continuous operator path — scroll to morph the
              desk.
            </p>
            <ul className="mt-8 space-y-3">
              {PATH.map((beat, i) => (
                <li key={beat.id}>
                  <button
                    type="button"
                    onClick={() => scrollToBeat(i)}
                    className={`w-full rounded-lg border px-4 py-3 text-left transition ${
                      idx === i
                        ? "border-cyan-400/35 bg-cyan-400/8"
                        : "border-transparent bg-transparent hover:border-[#1f1f23] hover:bg-[#111113]"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-num text-[10px] text-zinc-600">
                        {beat.step}
                      </span>
                      <span
                        className={`text-[14px] font-semibold ${
                          idx === i ? "text-cyan-200" : "text-zinc-300"
                        }`}
                      >
                        {beat.title}
                      </span>
                    </div>
                    <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
                      {beat.body}
                    </p>
                    <Link
                      href={beat.href}
                      onClick={(e) => e.stopPropagation()}
                      className="landing-haptic mt-2 inline-flex text-[12px] font-medium text-cyan-400 hover:text-cyan-300"
                    >
                      Open {beat.title.toLowerCase()} →
                    </Link>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="relative min-h-[360px]">
            {PATH.map((beat, i) => (
              <motion.div
                key={beat.id}
                className="absolute inset-0 flex items-center"
                initial={false}
                animate={{
                  opacity: idx === i ? 1 : 0,
                  y: idx === i ? 0 : 20,
                  scale: idx === i ? 1 : 0.97,
                  pointerEvents: idx === i ? "auto" : "none",
                }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="w-full">
                  <PathMock kind={beat.mock} active={idx === i} />
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
      {/* Single scroll runway */}
      <div className="h-[200vh]" aria-hidden />
    </section>
  );
}

function DestinationFrame() {
  const reduce = useReducedMotion();
  return (
    <section className="border-b border-[#1f1f23] px-4 py-16 md:py-20">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 text-center">
          <p className="font-num text-[11px] uppercase tracking-[0.2em] text-cyan-400/80">
            Destination
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-50 md:text-3xl">
            The desk, staged dense.
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-zinc-400">
            Brief beside tape. Ticket sticky. Book one glance away — Illustrative
            chrome of the live workstation.
          </p>
        </div>
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <MockComposedDesk dense />
        </motion.div>
      </div>
    </section>
  );
}

function FinalCta() {
  const reduce = useReducedMotion();
  return (
    <section className="relative overflow-hidden px-4 py-28 md:py-36">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(34,211,238,0.1),_transparent_55%)]" />
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
            Enter the desk →
          </MagneticCta>
          <a
            href="https://docs.panta.market/"
            target="_blank"
            rel="noreferrer"
            className="landing-haptic inline-flex items-center rounded-md border border-[#1f1f23] bg-[#111113] px-6 py-3 text-sm font-medium text-zinc-400"
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
      <Hero />
      <ProofStrip />
      <MorphJourney />
      <DestinationFrame />
      <FinalCta />
    </div>
  );
}
