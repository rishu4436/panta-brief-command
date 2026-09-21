import type { ReactNode } from "react";

export function Panel({
  children,
  className = "",
  title,
  action,
  padded = true,
  flush = false,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  action?: ReactNode;
  padded?: boolean;
  flush?: boolean;
}) {
  return (
    <section
      className={`rounded-lg border border-[#1f1f23] bg-[#111113] ${className}`}
    >
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 border-b border-[#1f1f23] px-3.5 py-2.5">
          {title ? (
            <h2 className="text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-400">
              {title}
            </h2>
          ) : (
            <span />
          )}
          {action}
        </div>
      )}
      <div className={flush ? "" : padded ? "p-3.5" : ""}>{children}</div>
    </section>
  );
}

/** @deprecated use Panel — kept so any stray imports keep compiling */
export const GlassCard = Panel;
