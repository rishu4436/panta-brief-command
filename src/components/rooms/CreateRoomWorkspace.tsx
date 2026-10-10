"use client";

/**
 * /rooms/create — four steps, then one save:
 *  1 Verify: connect a wallet and sign a free text challenge (no transaction);
 *  2 Details: title, description, shareable address, visibility;
 *  3 Market: pick one Panta market from the live catalog;
 *  4 Review → Create: the server re-validates everything (market against
 *    Panta, creator from the verified session), persists, and only then we
 *    redirect to the room. One idempotency key per reviewed payload makes a
 *    double click or a retry return the same room instead of a second one.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useCatalog } from "@/lib/data/hooks";
import { formatFriendlyIst, marketLabel, shortAddr, shouldShowCategoryChip, categoryLabel } from "@/lib/format";
import { marketLifecycle } from "@/lib/panta/catalog";
import type { Market } from "@/lib/panta/domain";
import { isPantaIndexed, marketHref, marketState } from "@/lib/panta/lifecycle";
import {
  RoomApiError,
  checkSlug,
  createRoomRequest,
  newIdempotencyKey,
  signOutRooms,
  useInvalidateRooms,
  useRoomSession,
  verifyWalletOwnership,
  type SlugCheck,
} from "@/lib/rooms/client";
import {
  DESCRIPTION_MAX,
  SLUG_PROBLEM_TEXT,
  TITLE_MAX,
  TITLE_MIN,
  cleanLine,
  cleanMultiline,
  slugProblem,
  slugify,
  type RoomVisibility,
} from "@/lib/rooms/domain";
import { DeskPriceCell } from "../desk/DeskPriceCell";
import { Panel } from "../Panel";
import { WalletButton } from "../WalletButton";
import { StatusBadge, type StatusTone } from "../ui/StatusBadge";
import { IconCheck, IconSearch } from "../ui/Icons";
import { Skeleton } from "../ui/States";

const STEPS = ["Verify wallet", "Details", "Market", "Review"] as const;
type Step = 0 | 1 | 2 | 3;

function Stepper({ step, maxReached, onJump }: { step: Step; maxReached: Step; onJump: (s: Step) => void }) {
  return (
    <ol className="flex flex-wrap items-center gap-1.5" aria-label="Create room steps">
      {STEPS.map((label, i) => {
        const state = i < step ? "done" : i === step ? "active" : "todo";
        const reachable = i <= maxReached && i !== step;
        return (
          <li key={label} className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={!reachable}
              onClick={() => onJump(i as Step)}
              aria-current={state === "active" ? "step" : undefined}
              className={`step-chip inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] disabled:cursor-default ${
                state === "active"
                  ? "border-cyan-400/50 bg-cyan-400/10 text-cyan-100"
                  : state === "done"
                    ? "border-emerald-400/35 bg-emerald-400/10 text-emerald-100 hover:border-emerald-300/60"
                    : "border-line bg-inset text-ink-3"
              }`}
            >
              {state === "done" ? <IconCheck className="h-3 w-3" /> : <span className="font-num">{i + 1}</span>} {label}
            </button>
            {i < STEPS.length - 1 ? <span className="h-px w-3 bg-line" aria-hidden="true" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

function Field({ label, htmlFor, hint, error, children }: { label: string; htmlFor: string; hint?: string; error?: string | null; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-[12px] font-medium text-ink-2">
          {label}
        </label>
        {hint ? <span className="font-num text-[11px] text-ink-3">{hint}</span> : null}
      </div>
      {children}
      {error ? (
        <p className="mt-1 text-[12px] text-rose-200" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const charLen = (s: string) => [...s].length;

function isWalletRejection(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /reject|declin|cancel|denied/i.test(msg);
}

// ------------------------------------------------------------------ step 1

function VerifyStep({ onDone }: { onDone: () => void }) {
  const { publicKey, connected, signMessage, wallet } = useWallet();
  const session = useRoomSession();
  const inval = useInvalidateRooms();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connectedAddr = publicKey?.toBase58() ?? null;
  const verifiedAddr = session.data?.wallet ?? null;
  const verified = Boolean(connectedAddr && verifiedAddr === connectedAddr);

  const verify = async () => {
    if (!connectedAddr || !signMessage) return;
    setBusy(true);
    setError(null);
    try {
      await verifyWalletOwnership(connectedAddr, signMessage, verifiedAddr);
      await inval.session();
    } catch (e) {
      setError(
        isWalletRejection(e)
          ? "You declined the signature request. Nothing was signed."
          : e instanceof RoomApiError
            ? e.message
            : "The wallet couldn't sign the message. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="1 · Verify wallet ownership" subtitle="A free signature, not a transaction">
      <div className="space-y-4">
        <p className="text-[13px] leading-relaxed text-ink-3">
          Your wallet becomes the room&apos;s verified creator. You&apos;ll sign a short text message that names this site, your wallet and a one-time code.
          It can&apos;t move funds or approve anything, and it costs nothing.
        </p>
        {!connected || !connectedAddr ? (
          <div className="flex flex-wrap items-center gap-3">
            <WalletButton />
            <span className="text-[12px] text-ink-3">Connect Phantom or Solflare to continue.</span>
          </div>
        ) : verified ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-400/30 bg-emerald-400/[0.06] px-3 py-3">
            <StatusBadge tone="success">Verified</StatusBadge>
            <span className="font-addr text-[13px] text-ink-2">{shortAddr(connectedAddr, 6)}</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm ml-auto"
              onClick={async () => {
                await signOutRooms().catch(() => undefined);
                await inval.session();
              }}
            >
              Sign out
            </button>
          </div>
        ) : !signMessage ? (
          <div role="alert" className="rounded-xl border border-amber-400/35 bg-amber-400/[0.08] px-3 py-3 text-[13px] text-amber-100">
            {wallet?.adapter.name ?? "This wallet"} doesn&apos;t support message signing, which rooms use to prove ownership without a transaction. Connect Phantom
            or Solflare instead.
          </div>
        ) : (
          <div className="space-y-3">
            {verifiedAddr && verifiedAddr !== connectedAddr ? (
              <p className="rounded-xl border border-amber-400/30 bg-amber-400/[0.06] px-3 py-2 text-[12px] text-amber-100/90">
                This browser is verified for {shortAddr(verifiedAddr, 4)}, but {shortAddr(connectedAddr, 4)} is connected. Verify the connected wallet to
                create rooms with it.
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="btn btn-primary" onClick={verify} disabled={busy}>
                {busy ? "Waiting for signature…" : `Verify ${shortAddr(connectedAddr, 4)}`}
              </button>
              <span className="text-[12px] text-ink-3">The request expires after 5 minutes.</span>
            </div>
          </div>
        )}
        {error ? (
          <p role="alert" className="rounded-lg border border-rose-400/40 bg-rose-400/10 px-3 py-2 text-[13px] text-rose-100">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end border-t border-line pt-4">
          <button type="button" className="btn btn-primary" disabled={!verified} onClick={onDone}>
            Continue
          </button>
        </div>
      </div>
    </Panel>
  );
}

// ------------------------------------------------------------------ step 2

type Details = { title: string; description: string; slug: string; slugEdited: boolean; visibility: RoomVisibility };

function useSlugCheck(slug: string) {
  const [result, setResult] = useState<{ slug: string; check: SlugCheck | null; error: string | null } | null>(null);
  useEffect(() => {
    if (slugProblem(slug)) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      checkSlug(slug, ctl.signal).then(
        (check) => setResult({ slug, check, error: null }),
        (e) => {
          if (!ctl.signal.aborted) setResult({ slug, check: null, error: e instanceof Error ? e.message : "Couldn't check" });
        },
      );
    }, 350);
    return () => {
      ctl.abort();
      clearTimeout(t);
    };
  }, [slug]);
  return result && result.slug === slug ? result : null;
}

function detailsErrors(d: Details) {
  const t = cleanLine(d.title);
  const desc = cleanMultiline(d.description);
  const p = slugProblem(d.slug);
  return {
    title: charLen(t) < TITLE_MIN ? `At least ${TITLE_MIN} characters.` : charLen(t) > TITLE_MAX ? `At most ${TITLE_MAX} characters.` : null,
    description: charLen(desc) > DESCRIPTION_MAX ? `At most ${DESCRIPTION_MAX} characters.` : null,
    slug: p ? SLUG_PROBLEM_TEXT[p] : null,
  };
}

function DetailsStep({ d, setD, serverSlugError, onBack, onNext }: { d: Details; setD: (fn: (d: Details) => Details) => void; serverSlugError: string | null; onBack: () => void; onNext: () => void }) {
  const [touched, setTouched] = useState(false);
  const errs = detailsErrors(d);
  const check = useSlugCheck(d.slug);
  const taken = check?.check && !check.check.available;
  const slugError = errs.slug ?? (taken ? "That address is already taken." : null) ?? serverSlugError;
  const valid = !errs.title && !errs.description && !errs.slug && !taken;
  const origin = typeof window !== "undefined" ? window.location.host : "";
  return (
    <Panel title="2 · Name your room" subtitle="Shown on the room page and in the directory">
      <div className="space-y-4">
        <Field label="Title" htmlFor="room-title" hint={`${charLen(cleanLine(d.title))}/${TITLE_MAX}`} error={touched ? errs.title : null}>
          <input
            id="room-title"
            className="field"
            value={d.title}
            maxLength={TITLE_MAX + 20}
            aria-invalid={touched && Boolean(errs.title)}
            placeholder="e.g. France vs Belgium: match-day room"
            onChange={(e) => {
              const title = e.target.value;
              setD((p) => ({ ...p, title, slug: p.slugEdited ? p.slug : slugify(title) }));
            }}
          />
        </Field>
        <Field label="Description (optional)" htmlFor="room-desc" hint={`${charLen(cleanMultiline(d.description))}/${DESCRIPTION_MAX}`} error={errs.description}>
          <textarea
            id="room-desc"
            className="field min-h-[96px]"
            rows={4}
            value={d.description}
            placeholder="What this room is for and how members should use it."
            onChange={(e) => setD((p) => ({ ...p, description: e.target.value }))}
          />
        </Field>
        <Field label="Room address" htmlFor="room-slug" error={touched || d.slugEdited ? slugError : taken ? slugError : null}>
          <div className="flex items-stretch overflow-hidden rounded-[var(--radius-control)] border border-line bg-inset focus-within:border-cyan-400/55">
            <span className="flex items-center whitespace-nowrap border-r border-line px-2.5 font-addr text-[12px] text-ink-3">{origin}/rooms/</span>
            <input
              id="room-slug"
              className="min-w-0 flex-1 bg-transparent px-2.5 py-2 font-addr text-[13px] text-ink outline-none"
              value={d.slug}
              maxLength={60}
              aria-invalid={Boolean(slugError)}
              aria-describedby="room-slug-status"
              onChange={(e) => setD((p) => ({ ...p, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"), slugEdited: true }))}
            />
          </div>
          <p id="room-slug-status" className="mt-1 text-[11px] text-ink-3" aria-live="polite">
            {errs.slug ? null : check?.check?.available ? "✓ Available" : check?.error ? `Couldn't check availability (${check.error}). It's checked again on save.` : check ? null : "Checking…"}
          </p>
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-[12px] font-medium text-ink-2">Visibility</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ["public", "Public", "Listed in the Rooms directory."],
                ["unlisted", "Unlisted", "Not listed; anyone with the link can open it."],
              ] as const
            ).map(([v, label, help]) => (
              <label
                key={v}
                className={`flex cursor-pointer gap-2.5 rounded-xl border p-3 text-[13px] ${d.visibility === v ? "border-cyan-400/50 bg-cyan-400/[0.06]" : "border-line bg-inset/40"}`}
              >
                <input type="radio" name="visibility" value={v} checked={d.visibility === v} onChange={() => setD((p) => ({ ...p, visibility: v }))} className="mt-0.5 accent-cyan-400" />
                <span>
                  <span className="font-medium text-ink">{label}</span>
                  <span className="block text-[12px] text-ink-3">{help}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex justify-between gap-2 border-t border-line pt-4">
          <button type="button" className="btn btn-ghost" onClick={onBack}>
            Back
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setTouched(true);
              if (valid) onNext();
            }}
          >
            Continue
          </button>
        </div>
      </div>
    </Panel>
  );
}

// ------------------------------------------------------------------ step 3

function MarketRow({ m, selected, onSelect }: { m: Market; selected: boolean; onSelect: () => void }) {
  const state = marketState({ marketId: m.marketId, market: m });
  const ends = m.endTime ? formatFriendlyIst(m.endTime * 1000) : null;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition ${selected ? "border-cyan-400/60 bg-cyan-400/[0.07]" : "border-line bg-inset/40 hover:border-line-strong"}`}
      >
        <span
          className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${selected ? "border-cyan-300 bg-cyan-400 text-bg" : "border-line-strong"}`}
          aria-hidden="true"
        >
          {selected ? <IconCheck className="h-2.5 w-2.5" /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-[13px] font-medium text-ink">{marketLabel(m, { max: 140 })}</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-2">
            <StatusBadge tone={state.tone as StatusTone} size="xs">
              {state.label}
            </StatusBadge>
            {m.category && shouldShowCategoryChip(m.category, m.title, m.description) ? (
              <span className="rounded border border-line px-1.5 text-[10px] text-ink-3">{categoryLabel(m.category)}</span>
            ) : null}
            {ends ? <span className="font-num text-[11px] text-ink-3">Ends {ends}</span> : null}
          </span>
        </span>
        <span className="hidden w-28 shrink-0 sm:block">
          <DeskPriceCell market={m} />
        </span>
      </button>
    </li>
  );
}

function MarketStep({ selectedId, onSelect, serverError, onBack, onNext }: { selectedId: string | null; onSelect: (id: string) => void; serverError: string | null; onBack: () => void; onNext: () => void }) {
  const catalog = useCatalog();
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<"live" | "all">("live");
  const eligible = useMemo(
    () => (catalog.data?.items ?? []).filter((m) => isPantaIndexed(m) && marketLifecycle(m) !== "cancelled"),
    [catalog.data],
  );
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return eligible
      .filter((m) => (scope === "all" ? true : ["open", "trading"].includes(marketLifecycle(m))))
      .filter((m) => !needle || `${m.title} ${m.description ?? ""} ${m.category} ${m.marketId}`.toLowerCase().includes(needle))
      .slice(0, 40);
  }, [eligible, q, scope]);
  const selected = eligible.find((m) => m.marketId === selectedId) ?? null;

  return (
    <Panel title="3 · Choose the market" subtitle="One Panta market per room">
      <div className="space-y-3">
        <p className="text-[12px] text-ink-3">
          Markets come from Panta&apos;s live catalog. The server checks your pick with Panta again when you create the room. Primary markets show implied
          probability; secondary markets show last observed USDC prices, not probabilities.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search markets</span>
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
            <input className="field pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by question, category or id" />
          </label>
          <div className="segmented" role="group" aria-label="Market scope">
            {(["live", "all"] as const).map((s) => (
              <button key={s} type="button" aria-pressed={scope === s} onClick={() => setScope(s)}>
                {s === "live" ? "Live" : "All"}
              </button>
            ))}
          </div>
        </div>
        {serverError ? (
          <p role="alert" className="rounded-lg border border-rose-400/40 bg-rose-400/10 px-3 py-2 text-[13px] text-rose-100">
            {serverError}
          </p>
        ) : null}
        {catalog.isPending ? (
          <div className="space-y-2" role="status" aria-label="Loading markets">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : catalog.isError ? (
          <div role="alert" className="rounded-xl border border-rose-400/30 bg-rose-400/[0.06] p-3 text-[13px] text-rose-100">
            Panta&apos;s market list didn&apos;t load. A room needs a real Panta market, so this step can&apos;t continue until it does.
            <button type="button" className="btn btn-secondary btn-sm ml-2" onClick={() => void catalog.refetch()}>
              Retry
            </button>
          </div>
        ) : shown.length === 0 ? (
          <p className="rounded-xl border border-line bg-inset/40 p-4 text-center text-[13px] text-ink-3">
            {q ? "No markets match this search." : scope === "live" ? "No live markets right now. Switch to All to see closed and resolved ones." : "No markets available."}
          </p>
        ) : (
          <ul className="max-h-[460px] space-y-2 overflow-y-auto pr-1">
            {shown.map((m) => (
              <MarketRow key={m.marketId} m={m} selected={m.marketId === selectedId} onSelect={() => onSelect(m.marketId)} />
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
          <button type="button" className="btn btn-ghost" onClick={onBack}>
            Back
          </button>
          <span className="min-w-0 flex-1 truncate text-right text-[12px] text-ink-3">{selected ? `Selected: ${marketLabel(selected, { max: 60 })}` : "Select a market"}</span>
          <button type="button" className="btn btn-primary" disabled={!selected} onClick={onNext}>
            Continue
          </button>
        </div>
      </div>
    </Panel>
  );
}

// ------------------------------------------------------------------ workspace

export function CreateRoomWorkspace() {
  const router = useRouter();
  const { publicKey } = useWallet();
  const session = useRoomSession();
  const inval = useInvalidateRooms();
  const catalog = useCatalog();
  const [rawStep, setStep] = useState<Step>(0);
  const [rawMax, setMaxReached] = useState<Step>(0);
  const [d, setD] = useState<Details>({ title: "", description: "", slug: "", slugEdited: false, visibility: "public" });
  const [marketId, setMarketId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slugServerError, setSlugServerError] = useState<string | null>(null);
  const [marketServerError, setMarketServerError] = useState<string | null>(null);
  const idem = useRef<{ fp: string; key: string } | null>(null);

  const connected = publicKey?.toBase58() ?? null;
  const verifiedWallet = session.data?.wallet ?? null;
  const walletOk = Boolean(connected && verifiedWallet === connected);
  const market = (catalog.data?.items ?? []).find((m) => m.marketId === marketId) ?? null;

  const go = (s: Step) => {
    setStep(s);
    setMaxReached((m) => (s > m ? s : m));
    setError(null);
  };

  // Wallet switched or session expired: back to step 1 before anything else.
  const lockedOut = !session.isPending && !walletOk;
  const step = lockedOut ? 0 : rawStep;
  const maxReached = lockedOut ? 0 : rawMax;

  const payload = {
    title: cleanLine(d.title),
    description: cleanMultiline(d.description),
    slug: d.slug,
    marketId: marketId ?? "",
    visibility: d.visibility,
  };
  const fp = JSON.stringify(payload);

  const submit = async () => {
    if (busy || !marketId || !walletOk) return;
    if (!idem.current || idem.current.fp !== fp) idem.current = { fp, key: newIdempotencyKey() };
    setBusy(true);
    setError(null);
    try {
      const res = await createRoomRequest({ ...payload, idempotencyKey: idem.current.key });
      await inval.list();
      router.push(res.url);
    } catch (e) {
      setBusy(false);
      if (!(e instanceof RoomApiError)) {
        setError("Something went wrong. The room may not have been saved; submitting again is safe and won't create a duplicate.");
        return;
      }
      if (e.code === "SLUG_TAKEN") {
        setSlugServerError(e.message);
        setD((p) => ({ ...p, slugEdited: true }));
        go(1);
        return;
      }
      if (e.code === "WALLET_NOT_VERIFIED") {
        await inval.session();
        go(0);
        return;
      }
      if (e.code === "MARKET_NOT_FOUND" || e.code === "MARKET_CANCELLED") {
        setMarketServerError(e.message);
        go(2);
        return;
      }
      setError(
        e.status === 0 || e.status >= 500
          ? `${e.message} Submitting again is safe: it won't create a duplicate room.`
          : e.message,
      );
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Prediction Rooms</p>
          <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.02em] text-ink">Create a Room</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-ink-3">A community space around one Panta market. Free to create: one wallet signature, no transaction.</p>
        </div>
        <Link href="/rooms" className="btn btn-secondary btn-sm">
          All rooms
        </Link>
      </div>

      <Stepper step={step} maxReached={maxReached} onJump={(s) => (s === 0 || walletOk ? go(s) : undefined)} />

      {step === 0 ? <VerifyStep onDone={() => go(1)} /> : null}
      {step === 1 ? (
        <DetailsStep
          d={d}
          setD={(fn) => {
            setSlugServerError(null);
            setD(fn);
          }}
          serverSlugError={slugServerError}
          onBack={() => go(0)}
          onNext={() => go(2)}
        />
      ) : null}
      {step === 2 ? (
        <MarketStep
          selectedId={marketId}
          onSelect={(id) => {
            setMarketServerError(null);
            setMarketId(id);
          }}
          serverError={marketServerError}
          onBack={() => go(1)}
          onNext={() => go(3)}
        />
      ) : null}
      {step === 3 ? (
        <Panel title="4 · Review and create" subtitle="Checked again by the server before saving">
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <dt className="text-[11px] uppercase tracking-[0.1em] text-ink-3">Title</dt>
              <dd className="mt-1 text-[16px] font-semibold text-ink">{payload.title}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[11px] uppercase tracking-[0.1em] text-ink-3">Description</dt>
              <dd className="mt-1 whitespace-pre-line text-[13px] text-ink-2">{payload.description || <span className="text-ink-3">None</span>}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-[0.1em] text-ink-3">Creator wallet (verified)</dt>
              <dd className="mt-1 font-addr text-[13px] text-ink-2">{verifiedWallet ? shortAddr(verifiedWallet, 6) : "—"}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-[0.1em] text-ink-3">Visibility</dt>
              <dd className="mt-1 text-[13px] capitalize text-ink-2">{payload.visibility}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[11px] uppercase tracking-[0.1em] text-ink-3">Shareable link</dt>
              <dd className="mt-1 break-all font-addr text-[13px] text-cyan-200">
                {typeof window !== "undefined" ? window.location.host : ""}/rooms/{payload.slug}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[11px] uppercase tracking-[0.1em] text-ink-3">Market</dt>
              <dd className="mt-1 rounded-xl border border-line bg-inset/40 p-3">
                {market ? (
                  <>
                    <Link href={marketHref(market.marketId)} className="text-[13px] font-medium text-ink hover:text-cyan-200">
                      {marketLabel(market)}
                    </Link>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      {(() => {
                        const st = marketState({ marketId: market.marketId, market });
                        return (
                          <StatusBadge tone={st.tone as StatusTone} size="xs">
                            {st.label}
                          </StatusBadge>
                        );
                      })()}
                      <span className="font-addr text-[11px] text-ink-3">{shortAddr(market.marketId, 5)}</span>
                    </div>
                  </>
                ) : (
                  <span className="font-addr text-[12px] text-ink-3">{marketId}</span>
                )}
              </dd>
            </div>
          </dl>
          {error ? (
            <p role="alert" className="mt-4 rounded-lg border border-rose-400/40 bg-rose-400/10 px-3 py-2 text-[13px] text-rose-100">
              {error}
            </p>
          ) : null}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
            <button type="button" className="btn btn-ghost" onClick={() => go(2)} disabled={busy}>
              Back
            </button>
            <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || !walletOk}>
              {busy ? "Saving room…" : "Create room"}
            </button>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
