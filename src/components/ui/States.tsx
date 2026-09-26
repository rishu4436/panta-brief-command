import type { ReactNode } from "react";

/** Shimmer block. Pass sizing classes. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

/** Stack of skeleton rows for lists/tables. */
export function SkeletonLoader({ rows = 5, className = "", label = "Loading" }: { rows?: number; className?: string; label?: string }) {
  return (
    <div className={`space-y-2 ${className}`} role="status" aria-label={label}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl border border-line/60 bg-inset/60 p-3">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-2.5 w-1/3" />
          </div>
          <Skeleton className="h-6 w-14" />
        </div>
      ))}
      <span className="sr-only">{label}…</span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  className = "",
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center justify-center px-6 py-10 text-center ${className}`}>
      {icon ? (
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-elevated text-ink-2">{icon}</div>
      ) : null}
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      {description ? <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-ink-3">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description,
  onRetry,
  retryLabel = "Try again",
  className = "",
}: {
  title?: string;
  description?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  return (
    <div role="alert" className={`rounded-xl border border-rose-400/30 bg-rose-400/[0.06] p-4 ${className}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-rose-400/50 text-[11px] font-bold text-rose-300" aria-hidden="true">
          !
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-rose-100">{title}</p>
          {description ? <p className="mt-1 text-[13px] leading-relaxed text-rose-200/80">{description}</p> : null}
          {onRetry ? (
            <button type="button" onClick={onRetry} className="btn btn-secondary btn-sm mt-3">
              {retryLabel}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
