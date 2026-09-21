import { BookPanel } from "@/components/BookPanel";
import { GlassCard } from "@/components/GlassCard";

export default function BookPage() {
  return (
    <div className="space-y-4">
      <GlassCard title="Book">
        <h1 className="text-2xl font-semibold text-zinc-50">Positions & claims</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Wallet holdings from <code className="text-cyan-300/80">GET /positions/</code>{" "}
          plus win / creator-fee claim builds.
        </p>
      </GlassCard>
      <BookPanel />
    </div>
  );
}
