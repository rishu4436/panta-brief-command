"use client";

import { formatOddsPct } from "@/lib/format";

function toPct(price: string | number | null | undefined): number | null {
  if (price === undefined || price === null || price === "") return null;
  const n = typeof price === "string" ? Number(price) : price;
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n)) * 100;
}

export function ProbBar({
  yes,
  no,
  size = "md",
  showLabels = true,
}: {
  yes: string | number | null | undefined;
  no: string | number | null | undefined;
  size?: "sm" | "md" | "lg";
  showLabels?: boolean;
}) {
  const y = toPct(yes);
  const n = toPct(no);
  const has = y !== null || n !== null;
  const yW = y ?? (n !== null ? 100 - n : 50);
  const nW = n ?? (y !== null ? 100 - y : 50);

  const hero =
    size === "lg"
      ? "text-4xl md:text-5xl"
      : size === "md"
        ? "text-xl"
        : "text-sm";

  if (!has) {
    return (
      <div
        className={`font-num text-zinc-600 ${size === "sm" ? "text-[11px]" : hero}`}
        title="No spot price from API yet"
      >
        {size === "sm" ? (
          <span className="font-sans text-[10px] tracking-normal text-zinc-600">
            No price yet
          </span>
        ) : (
          <>
            <span className="tracking-widest">···</span>
            <div className="mt-0.5 text-[10px] font-sans tracking-normal text-zinc-600">
              No price yet
            </div>
          </>
        )}
      </div>
    );
  }

  const primary = y ?? 100 - (n as number);

  if (size === "sm") {
    return (
      <div className="ml-auto flex w-[110px] min-w-0 flex-col items-end gap-1">
        <div className="font-num text-[13px] font-semibold tabular-nums tracking-tight text-zinc-50">
          {formatOddsPct(primary / 100)}
        </div>
        {showLabels && (
          <div className="flex h-1 w-full overflow-hidden rounded-full bg-[#1f1f23]">
            <div
              className="h-full bg-emerald-500 transition-all duration-300"
              style={{ width: `${yW}%` }}
            />
            <div
              className="h-full bg-rose-500 transition-all duration-300"
              style={{ width: `${nW}%` }}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div className={`font-num font-semibold tracking-tight text-zinc-50 ${hero}`}>
        {formatOddsPct(primary / 100)}
      </div>
      {showLabels && (
        <div className="mt-1.5 flex h-1.5 w-full overflow-hidden rounded-full bg-[#1f1f23]">
          <div
            className="h-full bg-emerald-500 transition-all duration-300"
            style={{ width: `${yW}%` }}
          />
          <div
            className="h-full bg-rose-500 transition-all duration-300"
            style={{ width: `${nW}%` }}
          />
        </div>
      )}
      {showLabels && (
        <div className="mt-1 flex justify-between font-num text-[10px]">
          <span className="text-emerald-400">YES {y !== null ? `${y.toFixed(0)}¢` : "—"}</span>
          <span className="text-rose-400">NO {n !== null ? `${n.toFixed(0)}¢` : "—"}</span>
        </div>
      )}
    </div>
  );
}

export function DualSideHero({
  yes,
  no,
}: {
  yes: string | number | null | undefined;
  no: string | number | null | undefined;
}) {
  const y = toPct(yes);
  const n = toPct(no);
  const yW = y ?? (n !== null ? 100 - n : 50);
  const nW = n ?? (y !== null ? 100 - y : 50);

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.07] p-4 transition-all duration-300">
          <div className="type-section text-emerald-400/80">
            Yes
          </div>
          <div
            key={`y-${y}`}
            className="mt-1 font-num text-3xl font-semibold tracking-tight text-emerald-300 transition-all duration-300"
          >
            {y !== null ? `${y.toFixed(1)}%` : "···"}
          </div>
          <div className="mt-0.5 font-num text-[11px] text-emerald-400/50">
            {yes != null && yes !== "" ? Number(yes).toFixed(4) : "No price yet"}
          </div>
        </div>
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/[0.07] p-4 transition-all duration-300">
          <div className="type-section text-rose-400/80">
            No
          </div>
          <div
            key={`n-${n}`}
            className="mt-1 font-num text-3xl font-semibold tracking-tight text-rose-300 transition-all duration-300"
          >
            {n !== null ? `${n.toFixed(1)}%` : "···"}
          </div>
          <div className="mt-0.5 font-num text-[11px] text-rose-400/50">
            {no != null && no !== "" ? Number(no).toFixed(4) : "No price yet"}
          </div>
        </div>
      </div>
      <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-[#1f1f23]">
        <div
          className="h-full bg-emerald-500 transition-all duration-500"
          style={{ width: `${yW}%` }}
        />
        <div
          className="h-full bg-rose-500 transition-all duration-500"
          style={{ width: `${nW}%` }}
        />
      </div>
    </div>
  );
}
