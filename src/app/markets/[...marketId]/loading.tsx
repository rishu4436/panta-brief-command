export default function MarketLoading() {
  return (
    <div className="space-y-4 animate-fade-in" aria-busy="true" aria-label="Loading market">
      <div className="skeleton h-3 w-20" />
      <div className="skeleton h-7 w-2/3 max-w-xl" />
      <div className="flex flex-wrap gap-2">
        <div className="skeleton h-6 w-16" />
        <div className="skeleton h-6 w-40" />
        <div className="skeleton h-6 w-20" />
      </div>
      <div className="grid gap-3 lg:grid-cols-12">
        <div className="space-y-3 lg:col-span-3">
          <div className="skeleton h-40 w-full rounded-lg" />
          <div className="skeleton h-56 w-full rounded-lg" />
        </div>
        <div className="space-y-3 lg:col-span-5">
          <div className="skeleton h-36 w-full rounded-lg" />
          <div className="skeleton h-24 w-full rounded-lg" />
          <div className="skeleton h-72 w-full rounded-lg" />
        </div>
        <div className="lg:col-span-4">
          <div className="skeleton h-[420px] w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
