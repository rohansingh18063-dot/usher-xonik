export function PageSkeleton() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-label="Loading">
      <div className="space-y-3">
        <div className="h-7 w-64 rounded-md bg-slate-200" />
        <div className="h-4 w-96 max-w-full rounded-md bg-slate-200" />
      </div>
      <div className="h-72 rounded-2xl border border-slate-200 bg-white" />
    </div>
  );
}
