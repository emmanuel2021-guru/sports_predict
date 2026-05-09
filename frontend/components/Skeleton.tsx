import clsx from 'clsx';

export function MatchCardSkeleton() {
  return (
    <div className="glass p-5 flex items-center gap-4">
      <div className="w-14 h-14 rounded-xl shimmer shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3 w-32 shimmer rounded" />
        <div className="h-5 w-3/4 shimmer rounded" />
      </div>
      <div className="w-5 h-5 shimmer rounded" />
    </div>
  );
}

export function MatchCardListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ animationDelay: `${i * 60}ms` }} className="animate-fade-in">
          <MatchCardSkeleton />
        </div>
      ))}
    </div>
  );
}

export function Pill({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border',
        className ?? 'bg-white/[0.04] border-white/10 text-white/70',
      )}
    >
      {children}
    </span>
  );
}
