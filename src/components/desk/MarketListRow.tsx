import Link from "next/link";
import { StatusBadge, phaseTone } from "../ui/StatusBadge";

/** One row of the market sidebar (market workspace and hero preview). */
export function MarketListRow({
  title,
  untitled = false,
  yesLabel,
  noLabel,
  phase,
  active = false,
  href,
}: {
  title: string;
  untitled?: boolean;
  yesLabel: string;
  noLabel: string;
  phase?: string | null;
  active?: boolean;
  href?: string;
}) {
  const ph = phaseTone(phase);
  const cls = `block rounded-lg border px-2.5 py-2 transition-colors ${
    active ? "border-cyan-400/45 bg-cyan-400/[0.07]" : "border-transparent hover:border-line hover:bg-elevated/60"
  }`;
  const body = (
    <>
      <span className={`line-clamp-2 text-[12px] font-medium leading-snug ${untitled ? "italic text-ink-3" : "text-ink"}`}>{title}</span>
      <span className="mt-1 flex items-center justify-between gap-2">
        <span className="font-num text-[11px]">
          <span className="text-emerald-300">{yesLabel}</span>
          <span className="text-ink-3"> / </span>
          <span className="text-rose-300">{noLabel}</span>
        </span>
        <StatusBadge tone={ph.tone} size="xs">
          {ph.label}
        </StatusBadge>
      </span>
    </>
  );
  return href ? (
    <Link href={href} aria-current={active ? "page" : undefined} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
