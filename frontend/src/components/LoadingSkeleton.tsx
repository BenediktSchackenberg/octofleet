export function PageSkeleton({ title }: { title?: string }) {
  return (
    <div className="p-6 space-y-6 animate-pulse">
      {title && <div className="h-8 w-48 bg-zinc-800 rounded" />}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-zinc-800/50 rounded-lg" />)}
      </div>
      <div className="h-96 bg-zinc-800/30 rounded-lg" />
    </div>
  );
}

export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="p-6 space-y-4 animate-pulse">
      <div className="h-8 w-48 bg-zinc-800 rounded" />
      <div className="h-10 bg-zinc-800/30 rounded" />
      {[...Array(rows)].map((_, i) => <div key={i} className="h-12 bg-zinc-800/20 rounded" />)}
    </div>
  );
}
