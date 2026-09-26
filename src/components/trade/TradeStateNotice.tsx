import Link from "next/link";
import type { ReactNode } from "react";
import { TRADE_STATES, type TradeIcon, type TradeStateId, type TradeTone } from "@/lib/trade-state";

/** Tone tokens shared by every trade state (desk ticket and landing preview). */
export const TONE_STYLE: Record<TradeTone, { box: string; disc: string; title: string; label: string }> = {
  neutral: { box: "border-line bg-inset", disc: "border-line-strong bg-elevated text-ink-2", title: "text-ink", label: "Status" },
  info: { box: "border-blue-500/35 bg-blue-500/[0.07]", disc: "border-blue-400/40 bg-blue-500/15 text-blue-200", title: "text-ink", label: "Next step" },
  progress: { box: "border-cyan-400/30 bg-cyan-400/[0.05]", disc: "border-cyan-400/40 bg-cyan-400/10 text-cyan-200", title: "text-ink", label: "In progress" },
  success: { box: "border-emerald-400/35 bg-emerald-400/[0.07]", disc: "border-emerald-400/45 bg-emerald-400/15 text-emerald-200", title: "text-emerald-100", label: "Done" },
  warning: { box: "border-amber-400/35 bg-amber-400/[0.07]", disc: "border-amber-400/45 bg-amber-400/15 text-amber-200", title: "text-amber-100", label: "Action needed" },
  danger: { box: "border-rose-400/40 bg-rose-500/[0.08]", disc: "border-rose-400/50 bg-rose-500/15 text-rose-200", title: "text-rose-100", label: "Stopped" },
};

const ACTION_HREF: Partial<Record<string, string>> = {
  view_activity: "/book?tab=activity",
  go_claims: "/book?tab=claims",
};

export function TradeStateIcon({ icon, className = "h-4 w-4" }: { icon: TradeIcon; className?: string }) {
  const p = { className, viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (icon) {
    case "wallet":
      return (
        <svg {...p}>
          <path d="M3.5 6.5h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1v-10a1.5 1.5 0 0 1 1.5-1.5h9.5" />
          <circle cx="13.5" cy="11.5" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "quote":
      return (
        <svg {...p}>
          <path d="M5 3.5h10v13l-2.5-1.5L10 16.5 7.5 15 5 16.5z" />
          <path d="M7.5 7.5h5M7.5 10.5h3" />
        </svg>
      );
    case "spinner":
      return (
        <svg {...p} className={`${className} animate-spin`}>
          <path d="M10 3a7 7 0 1 1-6.6 4.7" />
        </svg>
      );
    case "clock":
      return (
        <svg {...p}>
          <circle cx="10" cy="10" r="7" />
          <path d="M10 6v4.2l2.8 1.8" />
        </svg>
      );
    case "shield":
      return (
        <svg {...p}>
          <path d="M10 2.8 16 5v4.6c0 3.6-2.5 6.3-6 7.6-3.5-1.3-6-4-6-7.6V5z" />
          <path d="m7.4 10 1.9 1.9 3.4-3.6" />
        </svg>
      );
    case "check":
      return (
        <svg {...p}>
          <circle cx="10" cy="10" r="7" />
          <path d="m6.8 10.2 2.2 2.2 4.3-4.6" />
        </svg>
      );
    case "x":
      return (
        <svg {...p}>
          <circle cx="10" cy="10" r="7" />
          <path d="m7.5 7.5 5 5m0-5-5 5" />
        </svg>
      );
    case "pen":
      return (
        <svg {...p}>
          <path d="m12.8 3.8 3.4 3.4L8 15.4l-4 .6.6-4z" />
        </svg>
      );
    case "pause":
      return (
        <svg {...p}>
          <circle cx="10" cy="10" r="7" />
          <path d="M8.3 7.3v5.4M11.7 7.3v5.4" />
        </svg>
      );
    case "lock":
      return (
        <svg {...p}>
          <rect x="4.5" y="9" width="11" height="8" rx="1.5" />
          <path d="M7 9V6.8a3 3 0 0 1 6 0V9" />
        </svg>
      );
  }
}

function ShieldTiny() {
  return (
    <svg viewBox="0 0 12 12" className="mt-[3px] h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <path d="M6 1.2 10 2.6v2.9c0 2.3-1.6 4-4 4.9-2.4-.9-4-2.6-4-4.9V2.6z" />
    </svg>
  );
}

/**
 * One trade state, rendered the same everywhere: icon + tone, a title, one
 * plain sentence on what happened, what is safe, and one clear next action.
 *
 * `preview` renders the action as inert text (landing page illustration).
 */
export function TradeStateNotice({
  state,
  detail,
  meta,
  signature,
  onAction,
  actionLabel,
  actionDisabled = false,
  secondary,
  preview = false,
  className = "",
}: {
  state: TradeStateId;
  /** Extra specifics (e.g. the Panta error text or pre-sign reason). */
  detail?: ReactNode;
  /** Right-aligned meta: countdown, elapsed time. */
  meta?: ReactNode;
  signature?: string | null;
  onAction?: () => void;
  actionLabel?: string;
  actionDisabled?: boolean;
  secondary?: ReactNode;
  preview?: boolean;
  className?: string;
}) {
  const spec = TRADE_STATES[state];
  const tone = TONE_STYLE[spec.tone];
  const label = actionLabel ?? spec.actionLabel;
  const href = ACTION_HREF[spec.action];
  const showTx = spec.txLink && signature;

  let action: ReactNode = null;
  if (spec.action !== "none" && label) {
    const cls = `btn ${spec.tone === "success" || (spec.tone === "neutral" && href) ? "btn-secondary" : "btn-primary"} min-h-11`;
    if (preview) {
      action = (
        <span className={`${cls} pointer-events-none`} aria-hidden="true">
          {label}
        </span>
      );
    } else if (href) {
      action = (
        <Link href={href} className={cls}>
          {label}
        </Link>
      );
    } else if (onAction) {
      action = (
        <button type="button" className={cls} onClick={onAction} disabled={actionDisabled}>
          {label}
        </button>
      );
    }
  }

  return (
    <div
      role={spec.urgent ? "alert" : "status"}
      aria-live={spec.urgent ? "assertive" : "polite"}
      data-trade-state={state}
      className={`rounded-xl border p-3.5 ${tone.box} ${className}`}
    >
      <div className="flex items-start gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${tone.disc}`}>
          <TradeStateIcon icon={spec.icon} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <p className={`text-[14px] font-semibold leading-snug ${tone.title}`}>
              <span className="sr-only">{tone.label}: </span>
              {spec.title}
            </p>
            {meta ? <span className="font-num text-[12px] text-ink-2">{meta}</span> : null}
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{spec.explain}</p>
          {detail ? <div className="mt-1.5 break-words text-[12px] leading-relaxed text-ink-3">{detail}</div> : null}
          {spec.safe ? (
            <p className="mt-2 flex gap-1.5 text-[12px] leading-relaxed text-ink-2">
              <ShieldTiny />
              <span>{spec.safe}</span>
            </p>
          ) : null}
          {(action || showTx || secondary) && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {action}
              {showTx ? (
                preview ? (
                  <span className="inline-flex min-h-11 items-center text-[12px] font-medium text-cyan-300" aria-hidden="true">
                    View on Solscan ↗
                  </span>
                ) : (
                  <a
                    href={`https://solscan.io/tx/${signature}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center px-1 text-[12px] font-medium text-cyan-300 hover:text-cyan-200"
                  >
                    View on Solscan ↗
                  </a>
                )
              ) : null}
              {secondary}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
