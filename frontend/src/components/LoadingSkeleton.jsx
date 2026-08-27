export function CardSkeleton({ className = "" }) {
  return (
    <div className={`animate-pulse rounded-2xl bg-white p-5 shadow-card border border-slate-100 ${className}`}>
      <div className="h-3 w-24 rounded bg-slate-200" />
      <div className="mt-4 h-8 w-32 rounded bg-slate-200" />
      <div className="mt-3 h-3 w-full rounded bg-slate-100" />
    </div>
  );
}

export function GridSkeleton({ count = 8 }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}
