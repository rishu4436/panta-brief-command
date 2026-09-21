export default function BookLoading() {
  return (
    <div className="space-y-3 animate-fade-in" aria-busy="true" aria-label="Loading book">
      <div className="space-y-2">
        <div className="skeleton h-6 w-16" />
        <div className="skeleton h-3 w-64" />
      </div>
      <div className="grid gap-3 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <div className="skeleton h-72 w-full rounded-lg" />
        </div>
        <div className="lg:col-span-2">
          <div className="skeleton h-64 w-full rounded-lg" />
        </div>
      </div>
      <div className="skeleton h-56 w-full rounded-lg" />
    </div>
  );
}
