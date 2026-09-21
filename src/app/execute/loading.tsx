export default function ExecuteLoading() {
  return (
    <div className="space-y-3 animate-fade-in" aria-busy="true" aria-label="Loading execute">
      <div className="space-y-2">
        <div className="skeleton h-6 w-24" />
        <div className="skeleton h-3 w-56" />
      </div>
      <div className="skeleton h-[420px] w-full rounded-lg" />
      <div className="skeleton h-48 w-full rounded-lg" />
    </div>
  );
}
