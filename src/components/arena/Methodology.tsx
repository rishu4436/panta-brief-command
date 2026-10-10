import { Panel } from "../Panel";

/** How arena scores work. Plain statements only: no claims the system can't back. */
export function ArenaMethodology({ minRanked, priorScore, priorWeight, compact = false }: { minRanked: number; priorScore: string; priorWeight: number; compact?: boolean }) {
  return (
    <Panel title="Methodology" subtitle="How scores are computed" id="methodology">
      <div className={`space-y-3 text-[13px] leading-relaxed text-ink-2 ${compact ? "" : "sm:columns-2 sm:gap-8 [&>*]:break-inside-avoid"}`}>
        <p>
          <span className="font-semibold text-ink">Brier score.</span> For a forecast of <span className="font-num">p</span> (YES probability) and the
          verified outcome <span className="font-num">o</span> (1 = YES, 0 = NO), loss = (p − o)². Lower is better. The displayed score is{" "}
          <span className="font-num">100 × (1 − loss)</span>: 100 is a perfect call, 75 is what always saying 50% earns, 0 is maximally wrong.
          Example: 80% YES scores <span className="font-num">96.00</span> if YES wins and <span className="font-num">36.00</span> if NO wins.
        </p>
        <p>
          <span className="font-semibold text-ink">What counts.</span> Your final revision made before the market&apos;s forecasting cutoff (the end of
          its primary trading phase). No forecast, no score. Later edits are impossible and earlier revisions never count.
        </p>
        <p>
          <span className="font-semibold text-ink">Verified resolution only.</span> A market is scored only after both Panta&apos;s market record and the
          market&apos;s on-chain account report the same final outcome. If they disagree it is shown as blocked and nobody is scored. Outcomes are never
          inferred from prices, expiry or AI, and finalized scores are never edited.
        </p>
        <p>
          <span className="font-semibold text-ink">One score per market.</span> If you forecast the same market in several rooms, your global record uses the
          room you joined first (each room&apos;s own leaderboard still shows its score).
        </p>
        <p>
          <span className="font-semibold text-ink">Ranking.</span> Forecasters with at least {minRanked} scored markets are ranked by an adjusted score:
          their average is blended with {priorWeight} imaginary markets at {priorScore}, so a short lucky streak can&apos;t top the table. Fewer than{" "}
          {minRanked} scored markets is shown as Provisional. Ties: more scored markets, then lower mean Brier, then earliest first score, then wallet.
        </p>
        <p>
          <span className="font-semibold text-ink">Limits.</span> Accuracy only: no trading PnL, no win rate, no rewards. Wallets are pseudonymous and one
          person can use several; the arena doesn&apos;t claim to prevent that.
        </p>
      </div>
    </Panel>
  );
}
