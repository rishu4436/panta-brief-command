import type { ReactNode } from "react";

/** Standard card surface (radius 14, thin border). */
export function Panel({
  children,
  className = "",
  title,
  action,
  padded = true,
  flush = false,
  id,
  icon,
  subtitle,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  action?: ReactNode;
  padded?: boolean;
  flush?: boolean;
  id?: string;
  icon?: ReactNode;
  subtitle?: ReactNode;
}) {
  return (
    <section id={id} className={`card scroll-mt-20 ${className}`}>
      {(title || action) && (
        <div className="flex min-h-[48px] items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            {icon ? <span className="text-ink-2">{icon}</span> : null}
            {title ? <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-ink">{title}</h2> : <span />}
            {subtitle ? <span className="truncate text-[12px] text-ink-3">{subtitle}</span> : null}
          </div>
          {action}
        </div>
      )}
      <div className={flush ? "" : padded ? "p-4" : ""}>{children}</div>
    </section>
  );
}
