import { Panel } from "../Panel";
import { DualSideHero } from "../ProbBar";

/** Probability + key facts panel (market page centre column and the hero preview). */
export function ProbabilityPanel({
  yes,
  no,
  volume,
  ends,
  resolves,
  prints,
}: {
  yes: string | number | null | undefined;
  no: string | number | null | undefined;
  volume: string;
  ends: string;
  resolves: string;
  prints: string | number;
}) {
  return (
    <Panel title="Probability" subtitle="Live spot · blank means not priced yet">
      <DualSideHero yes={yes} no={no} />
      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 text-[12px] sm:grid-cols-4">
        <div>
          <dt className="text-ink-3">Volume</dt>
          <dd className="font-num mt-0.5 text-[14px] font-medium text-ink">{volume}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Ends</dt>
          <dd className="font-num mt-0.5 text-[14px] font-medium text-ink">{ends}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Resolves</dt>
          <dd className="font-num mt-0.5 text-[14px] font-medium text-ink">{resolves}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Prints in window</dt>
          <dd className="font-num mt-0.5 text-[14px] font-medium text-ink">{prints}</dd>
        </div>
      </dl>
    </Panel>
  );
}
