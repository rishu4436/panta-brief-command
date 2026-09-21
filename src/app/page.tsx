import { MarketList } from "@/components/MarketList";
import { GlassCard } from "@/components/GlassCard";

export default function HomePage() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <GlassCard className="lg:col-span-2" title="Command brief">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
            Intel desk
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
            Browse the Panta USDC catalog, open a market for live odds + trade
            tape, generate an AI Brief from real detail fields, then jump to
            Execute for the full primary buy path (quote → build VT → sign →
            broadcast → submit/verify →{" "}
            <code className="text-cyan-300/80">POST /trades/</code>).
          </p>
        </GlassCard>
        <GlassCard title="Demo path">
          <ol className="list-decimal space-y-2 pl-4 text-sm text-zinc-300">
            <li>Set <code className="text-cyan-300/80">PANTA_API_KEY</code></li>
            <li>Open a market from the catalog</li>
            <li>Generate AI Brief</li>
            <li>Connect wallet → Quote → Build → Sign</li>
            <li>Book → positions / claim</li>
          </ol>
        </GlassCard>
      </div>
      <MarketList />
    </div>
  );
}
