export default function DeskLoading() {
  return (
    <div className="space-y-3 animate-fade-in" aria-busy="true" aria-label="Loading desk">
      <div className="flex items-end justify-between gap-3">
        <div className="space-y-2">
          <div className="skeleton h-6 w-28" />
          <div className="skeleton h-3 w-48" />
        </div>
        <div className="skeleton h-8 w-32" />
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="overflow-hidden rounded-lg border border-[#1f1f23] bg-[#111113]">
          <div className="border-b border-[#1f1f23] p-3.5">
            <div className="skeleton h-9 w-full" />
            <div className="mt-3 flex flex-wrap gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="skeleton h-7 w-16 rounded-full" />
              ))}
            </div>
          </div>
          <div className="divide-y divide-[#1f1f23]">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                <div className="skeleton h-10 w-10 shrink-0 rounded" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="skeleton h-3.5 w-3/4 max-w-md" />
                  <div className="skeleton h-2.5 w-28" />
                </div>
                <div className="skeleton h-5 w-20" />
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <div className="skeleton h-40 w-full rounded-lg" />
          <div className="skeleton h-48 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
