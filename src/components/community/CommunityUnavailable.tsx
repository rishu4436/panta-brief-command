import Link from "next/link";
import { IconArrowRight, IconLayers } from "../ui/Icons";

export type CommunityFeature = "rooms" | "create-room" | "room" | "arena" | "studio" | "profile";

const COPY: Record<CommunityFeature, { title: string; body: string }> = {
  rooms: {
    title: "Prediction Rooms aren't available on this deployment",
    body: "Rooms, forecasts and leaderboards need durable community storage, and this deployment doesn't have it configured. Rooms can't be listed, created or joined here.",
  },
  "create-room": {
    title: "Rooms can't be created on this deployment",
    body: "Creating a room needs durable community storage, and this deployment doesn't have it configured. Nothing was saved and nothing was signed.",
  },
  room: {
    title: "This room isn't available on this deployment",
    body: "Room pages need durable community storage, and this deployment doesn't have it configured, so this room can't be loaded here.",
  },
  arena: {
    title: "The Forecasting Arena isn't available on this deployment",
    body: "Scores and rankings are read from community storage, and this deployment doesn't have it configured. No rankings are shown rather than empty or invented ones.",
  },
  studio: {
    title: "Creator Studio isn't available on this deployment",
    body: "Studio reads your rooms and their activity from community storage, and this deployment doesn't have it configured. There's no need to connect or sign with a wallet here.",
  },
  profile: {
    title: "Forecaster profiles aren't available on this deployment",
    body: "Profiles are read from community storage, and this deployment doesn't have it configured.",
  },
};

/**
 * Honest, calm unavailable state for community features when the room store
 * isn't configured (e.g. a read-only preview without Redis). Informational,
 * not an error: no retry button, because retrying can't help, and links to
 * what does work on this deployment.
 */
export function CommunityUnavailable({ feature, readOnly = false, compact = false }: { feature: CommunityFeature; readOnly?: boolean; compact?: boolean }) {
  const c = COPY[feature];
  return (
    <section
      role="status"
      aria-labelledby={`community-unavailable-${feature}`}
      className={`relative overflow-hidden rounded-2xl border border-line bg-[linear-gradient(180deg,rgba(16,27,45,0.75),rgba(8,16,29,0.75))] ${compact ? "p-5" : "p-6 sm:p-8"}`}
      data-testid="community-unavailable"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-300/40 to-transparent" aria-hidden="true" />
      <div className={`flex flex-col gap-5 ${compact ? "" : "sm:flex-row sm:items-start sm:gap-6"}`}>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber-400/30 bg-amber-400/[0.07] text-amber-200" aria-hidden="true">
          <IconLayers className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-200/90">{readOnly ? "Read-only preview" : "Not configured here"}</p>
          <h2 id={`community-unavailable-${feature}`} className={`mt-2 font-semibold tracking-[-0.015em] text-ink ${compact ? "text-[16px]" : "text-[19px] sm:text-[21px]"}`}>
            {c.title}
          </h2>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-ink-2">{c.body}</p>
          {!compact && (
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-ink-3">
              {readOnly
                ? "This preview deployment is read-only by design. Live markets and research still work; community features run on the production deployment."
                : "Live markets and research still work on this deployment."}
            </p>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link href="/desk" className={`btn btn-primary ${compact ? "btn-sm" : ""}`}>
              Explore live markets <IconArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/" className={`btn btn-ghost ${compact ? "btn-sm" : ""}`}>
              Back to home
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Full page for a gated route: the page's usual heading, then the state. */
export function CommunityUnavailablePage({
  feature,
  eyebrow,
  title,
  description,
  readOnly,
}: {
  feature: CommunityFeature;
  eyebrow: string;
  title: string;
  description: string;
  readOnly: boolean;
}) {
  return (
    <div className="mx-auto max-w-4xl space-y-6 py-2 animate-fade-in">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.02em] text-ink">{title}</h1>
        <p className="mt-1 max-w-2xl text-[13px] text-ink-3">{description}</p>
      </div>
      <CommunityUnavailable feature={feature} readOnly={readOnly} />
    </div>
  );
}
