'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Target, Database, RefreshCw, Calendar } from 'lucide-react';
import clsx from 'clsx';

// Sport theme tokens (kept in sync with tailwind.config.ts)
const SPORTS = [
  { key: 'football', label: 'Football', icon: '⚽', accent: '#10b981' },
  { key: 'basketball', label: 'Basketball', icon: '🏀', accent: '#f59e0b' },
  { key: 'tennis', label: 'Tennis', icon: '🎾', accent: '#a855f7' },
];

interface Props {
  date: string;
  onDateChange: (date: string) => void;
  adjacent: boolean;
  onAdjacentChange: (v: boolean) => void;
  onRefresh: () => void;
}

export function Sidebar({ date, onDateChange, adjacent, onAdjacentChange, onRefresh }: Props) {
  const pathname = usePathname();
  const activeSport = SPORTS.find((s) => pathname.startsWith(`/${s.key}`))?.key ?? null;

  return (
    <aside className="w-[260px] shrink-0 border-r border-white/[0.06] bg-ink-base p-5 flex flex-col gap-6 min-h-screen">
      {/* Brand */}
      <Link href="/" className="flex items-center gap-2.5 group">
        <div className="w-8 h-8 rounded-lg bg-white/[0.06] border border-white/10 flex items-center justify-center group-hover:bg-white/10 transition-colors">
          <Target className="w-4 h-4 text-white/85" />
        </div>
        <div>
          <div className="font-bold text-[15px] tracking-tight">Markets Pro</div>
          <div className="text-[11px] text-white/45 -mt-0.5">AI sports analyst</div>
        </div>
      </Link>

      {/* Sport navigation — primary nav */}
      <nav className="space-y-1">
        <div className="text-[10px] uppercase tracking-[0.12em] text-white/35 font-semibold mb-2 px-2">
          Sports
        </div>
        {SPORTS.map((s) => {
          const active = activeSport === s.key;
          return (
            <Link
              key={s.key}
              href={`/${s.key}`}
              className={clsx(
                'group relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all',
                active
                  ? 'bg-white/[0.05] text-white'
                  : 'text-white/65 hover:bg-white/[0.03] hover:text-white',
              )}
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full"
                  style={{ background: s.accent, boxShadow: `0 0 12px ${s.accent}66` }}
                />
              )}
              <span className="text-xl leading-none">{s.icon}</span>
              <span className={clsx('font-medium', active && 'text-white')}>{s.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Date */}
      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-[0.12em] text-white/35 font-semibold px-2">
          Date
        </div>
        <div className="relative">
          <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/35 pointer-events-none" />
          <input
            type="date"
            value={date}
            onChange={(e) => onDateChange(e.target.value)}
            className="w-full bg-white/[0.03] border border-white/[0.08] rounded-lg pl-9 pr-3 py-2 text-sm text-white outline-none focus:border-white/20 transition-colors"
          />
        </div>
        <label className="flex items-center gap-2 text-[12px] text-white/55 px-2 cursor-pointer">
          <input
            type="checkbox"
            checked={adjacent}
            onChange={(e) => onAdjacentChange(e.target.checked)}
            className="rounded accent-white"
          />
          Include adjacent days
        </label>
      </div>

      <button onClick={onRefresh} className="btn w-full">
        <RefreshCw className="w-3.5 h-3.5" />
        Refresh data
      </button>

      <div className="border-t border-white/[0.05]" />

      {/* Secondary nav */}
      <nav className="space-y-1">
        <Link
          href="/picks"
          className={clsx(
            'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
            pathname === '/picks'
              ? 'bg-white/[0.05] text-white'
              : 'text-white/55 hover:bg-white/[0.03] hover:text-white',
          )}
        >
          <Database className="w-4 h-4" />
          Saved picks
        </Link>
      </nav>

      <div className="mt-auto pt-3 border-t border-white/[0.05] text-[10px] text-white/30 text-center font-mono">
        SOFASCORE · CLAUDE SONNET 4.6
      </div>
    </aside>
  );
}
