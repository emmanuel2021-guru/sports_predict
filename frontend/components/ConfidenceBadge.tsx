import clsx from 'clsx';

export function ConfidenceBadge({ value }: { value: number }) {
  const tier = value >= 75 ? 'high' : value >= 60 ? 'mid' : 'low';
  const label = tier === 'high' ? 'VIP' : tier === 'mid' ? 'Moderate' : 'Low';
  const colors = {
    high: 'bg-green-500/15 text-green-400 border-green-500/30',
    mid: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    low: 'bg-red-500/15 text-red-400 border-red-500/30',
  };
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-2 px-3 py-1 rounded-full font-semibold text-xs border',
        colors[tier],
      )}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {label} · {value}/100
    </span>
  );
}

export function ConfidenceMeter({ value, accent }: { value: number; accent: string }) {
  return (
    <div className="w-full">
      <div className="h-2 bg-white/[0.06] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{
            width: `${Math.max(0, Math.min(100, value))}%`,
            background: `linear-gradient(90deg, ${accent} 0%, ${accent}aa 100%)`,
            boxShadow: `0 0 20px ${accent}66`,
          }}
        />
      </div>
    </div>
  );
}
