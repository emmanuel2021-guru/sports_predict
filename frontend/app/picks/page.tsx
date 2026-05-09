'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { Database, Download, ExternalLink, Trophy, Check } from 'lucide-react';
import clsx from 'clsx';
import { Sidebar } from '@/components/Sidebar';
import { ConfidenceBadge } from '@/components/ConfidenceBadge';
import { api } from '@/lib/api';
import type { SavedPick, SportKey } from '@/lib/types';

const SPORT_META: Record<string, { label: string; icon: string; accent: string }> = {
  football:   { label: 'Football',   icon: '⚽', accent: '#10b981' },
  basketball: { label: 'Basketball', icon: '🏀', accent: '#f59e0b' },
  tennis:     { label: 'Tennis',     icon: '🎾', accent: '#a855f7' },
};

const SPORT_KEYS: SportKey[] = ['football', 'basketball', 'tennis'];

export default function PicksPage() {
  const [scope, setScope] = useState<'all' | SportKey>('all');
  const [picks, setPicks] = useState<SavedPick[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [adjacent, setAdjacent] = useState(false);

  useEffect(() => {
    setLoading(true);
    api
      .picks(scope === 'all' ? undefined : scope, 300)
      .then(setPicks)
      .finally(() => setLoading(false));
  }, [scope]);

  const stats = useMemo(() => {
    const finished = picks.filter((p) => p.match_finished).length;
    const withClaude = picks.filter((p) => p.claude_pick).length;
    return { total: picks.length, finished, withClaude };
  }, [picks]);

  const downloadCSV = () => {
    if (picks.length === 0) return;
    const cols = Object.keys(picks[0]);
    const csv = [
      cols.join(','),
      ...picks.map((p) =>
        cols
          .map((c) => {
            const v = (p as any)[c];
            if (v === null || v === undefined) return '';
            const s = String(v).replace(/"/g, '""');
            return /[",\n]/.test(s) ? `"${s}"` : s;
          })
          .join(','),
      ),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `saved_picks_${scope}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex min-h-screen bg-ink-base">
      <Sidebar
        date={date}
        onDateChange={setDate}
        adjacent={adjacent}
        onAdjacentChange={setAdjacent}
        onRefresh={() => {}}
      />

      <main className="flex-1 px-8 py-7 max-w-[1400px]">
        {/* Header */}
        <header className="mb-6 animate-fade-in">
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-1.5 text-[10px] font-medium text-white/40 uppercase tracking-[0.12em]">
                <Database className="w-3 h-3" />
                Backtesting database
              </div>
              <h1 className="text-3xl font-extrabold tracking-tight">Saved Picks</h1>
            </div>
            <button onClick={downloadCSV} disabled={picks.length === 0} className="btn">
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
          </div>
        </header>

        {/* Stat strip + scope */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
          {/* Scope selector spans 2 cols */}
          <div className="card md:col-span-2 p-4">
            <div className="text-[10px] uppercase tracking-[0.12em] text-white/40 font-semibold mb-2.5">
              Scope
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setScope('all')}
                className={clsx(
                  'px-3 py-1.5 rounded-md text-[12px] font-medium border transition-colors',
                  scope === 'all'
                    ? 'bg-white/10 border-white/25 text-white'
                    : 'border-white/[0.08] text-white/55 hover:bg-white/[0.03]',
                )}
              >
                All sports
              </button>
              {SPORT_KEYS.map((key) => {
                const m = SPORT_META[key];
                const active = scope === key;
                return (
                  <button
                    key={key}
                    onClick={() => setScope(key)}
                    className={clsx(
                      'px-3 py-1.5 rounded-md text-[12px] font-medium border transition-colors inline-flex items-center gap-1.5',
                      active
                        ? 'text-white'
                        : 'border-white/[0.08] text-white/55 hover:bg-white/[0.03]',
                    )}
                    style={
                      active
                        ? { background: `${m.accent}22`, borderColor: `${m.accent}66` }
                        : undefined
                    }
                  >
                    <span>{m.icon}</span>
                    <span>{m.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="card p-4 text-center">
            <div className="text-[10px] uppercase tracking-[0.12em] text-white/40 font-semibold">
              Total Picks
            </div>
            <div className="text-3xl font-extrabold text-white mono tabular mt-1">{stats.total}</div>
          </div>
          <div className="card p-4 text-center">
            <div className="text-[10px] uppercase tracking-[0.12em] text-white/40 font-semibold">
              Graded
            </div>
            <div className="text-3xl font-extrabold text-white mono tabular mt-1">
              {stats.finished}
              <span className="text-[16px] text-white/30 ml-1">/ {stats.total}</span>
            </div>
          </div>
        </div>

        {/* Picks list */}
        {loading && (
          <div className="text-center py-16 text-white/45 text-[13px]">Loading picks…</div>
        )}

        {!loading && picks.length === 0 && (
          <div className="card p-12 text-center">
            <Database className="w-9 h-9 text-white/15 mx-auto mb-3" />
            <div className="text-white/55 text-[14px]">
              No picks saved yet. Open a match to start saving.
            </div>
          </div>
        )}

        <div className="grid gap-2.5">
          {picks.map((p) => {
            const m = SPORT_META[p.sport] ?? { label: p.sport, icon: '🎯', accent: '#666' };
            return (
              <div key={p.match_id} className="card card-hover p-4 animate-fade-in">
                <div className="flex items-start gap-3">
                  <div className="text-xl shrink-0">{m.icon}</div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-[10.5px] text-white/40 mb-1 uppercase tracking-wider font-medium">
                      <Trophy className="w-2.5 h-2.5" />
                      <span className="truncate">{p.league ?? 'Unknown'}</span>
                      {p.match_finished ? (
                        <span className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-white/[0.05] text-[9.5px] text-white/55 mono">
                          <Check className="w-2 h-2" /> GRADED
                        </span>
                      ) : (
                        <span className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500/10 text-[9.5px] text-amber-300 mono">
                          ● PENDING
                        </span>
                      )}
                    </div>

                    <div className="text-[15px] font-semibold text-white mb-2.5">
                      {p.home_team} <span className="text-white/30 mx-1.5">vs</span> {p.away_team}
                      {p.match_finished && p.actual_home_score != null && (
                        <span className="ml-3 px-2 py-0.5 rounded bg-white/[0.06] text-[12px] mono tabular">
                          {p.actual_home_score}–{p.actual_away_score}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-x-5 gap-y-2 text-[12.5px]">
                      <div>
                        <span className="text-white/40 text-[10.5px] uppercase tracking-wider mr-1.5">Algo</span>
                        <span className="text-white">{p.algo_recommendation ?? '—'}</span>
                        {p.algo_confidence != null && (
                          <span className="ml-2">
                            <ConfidenceBadge value={Math.round(p.algo_confidence)} />
                          </span>
                        )}
                      </div>
                      {p.claude_pick && (
                        <div>
                          <span className="text-white/40 text-[10.5px] uppercase tracking-wider mr-1.5">Claude</span>
                          <span className="text-white">{p.claude_pick}</span>
                          {p.claude_confidence != null && (
                            <span className="ml-2">
                              <ConfidenceBadge value={p.claude_confidence} />
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <Link
                    href={`/match/${p.match_id}?sport=${p.sport}`}
                    className="self-center text-white/35 hover:text-white p-1.5 rounded-md hover:bg-white/[0.04] transition-colors"
                    title="Open match"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
