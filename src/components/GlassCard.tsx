import type { ReactNode } from "react";

export function GlassCard({
  children,
  className = "",
  title,
  action,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  action?: ReactNode;
}) {
  return (
    <section
      className={`rounded-2xl border border-white/10 bg-slate-900/50 shadow-xl shadow-black/20 backdrop-blur-xl ${className}`}
    >
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 border-b border-white/5 px-4 py-3">
          {title ? (
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
              {title}
            </h2>
          ) : (
            <span />
          )}
          {action}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}
