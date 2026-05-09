'use client';

import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Search, Trophy } from 'lucide-react';
import clsx from 'clsx';
import { Sidebar } from './Sidebar';
import { MatchCard } from './MatchCard';
import { SortControls, type SortMode, type GroupMode } from './SortControls';
import { MatchCardListSkeleton } from './Skeleton';
import { api } from '@/lib/api';
import { scheduleCache } from '@/lib/cache';
import type { ScheduledMatch, SportKey } from '@/lib/types';

const SPORT_META: Record<SportKey, { label: string; icon: string; accent: string; bgClass: string; p1Label: string; p2Label: string }> = {
  football: {
    label: 'Football',
    icon: '⚽',
    accent: '#10b981',
    bgClass: 'sport-bg-football',
    p1Label: 'Home',
    p2Label: 'Away',
  },
  basketball: {
    label: 'Basketball',
    icon: '🏀',
    accent: '#f59e0b',
    bgClass: 'sport-bg-basketball',
    p1Label: 'Home',
    p2Label: 'Away',
  },
  tennis: {
    label: 'Tennis',
    icon: '🎾',
    accent: '#a855f7',
    bgClass: 'sport-bg-tennis',
    p1Label: 'Player A',
    p2Label: 'Player B',
  },
};

export function SlateView({ sport }: { sport: SportKey }) {
  const meta = SPORT_META[sport];
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [adjacent, setAdjacent] = useState(false);
  const [matches, setMatches] = useState<ScheduledMatch[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [leagueFilter, setLeagueFilter] = useState<string[]>([]);
  const [sort, setSort] = useState<SortMode>('time');
  const [group, setGroup] = useState<GroupMode>('flat');

  // Fetch slate
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLeagueFilter([]);
    setSearchQuery('');

    const cached = scheduleCache.get(sport, date, adjacent);
    if (cached) {
      setMatches(cached);
      setLoading(false);
      return;
    }
    setMatches(null);
    setLoading(true);

    api
      .schedule(sport, date, adjacent)
      .then((data) => {
        if (cancelled) return;
        setMatches(data);
        scheduleCache.set(sport, date, adjacent, data);
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [sport, date, adjacent]);

  const leagues = useMemo(() => {
    if (!matches) return [];
    const counts = new Map<string, number>();
    for (const m of matches) counts.set(m.league, (counts.get(m.league) ?? 0) + 1);
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([league, count]) => ({ league, count }));
  }, [matches]);

  // Apply filters
  const filteredMatches = useMemo(() => {
    if (!matches) return [];
    let m = matches;
    if (leagueFilter.length > 0) m = m.filter((x) => leagueFilter.includes(x.league));
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      m = m.filter((x) => x.home.toLowerCase().includes(q) || x.away.toLowerCase().includes(q));
    }
    return m;
  }, [matches, leagueFilter, searchQuery]);

  // Sort + group
  const sortedMatches = useMemo(() => {
    const arr = [...filteredMatches];
    if (sort === 'league') {
      arr.sort((a, b) => a.league.localeCompare(b.league) || a.startTimestamp - b.startTimestamp);
    } else {
      arr.sort((a, b) => a.startTimestamp - b.startTimestamp);
    }
    return arr;
  }, [filteredMatches, sort]);

  const grouped = useMemo(() => {
    if (group !== 'by-league') return null;
    const map = new Map<string, ScheduledMatch[]>();
    for (const m of sortedMatches) {
      if (!map.has(m.league)) map.set(m.league, []);
      map.get(m.league)!.push(m);
    }
    return Array.from(map.entries());
  }, [sortedMatches, group]);

  const handleRefresh = () => {
    scheduleCache.invalidate(sport);
    setMatches(null);
    setLoading(true);
    api
      .schedule(sport, date, adjacent)
      .then((data) => {
        setMatches(data);
        scheduleCache.set(sport, date, adjacent, data);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  return (
    <div className="flex min-h-screen bg-ink-base">
      <Sidebar
        date={date}
        onDateChange={setDate}
        adjacent={adjacent}
        onAdjacentChange={setAdjacent}
        onRefresh={handleRefresh}
      />

      <main className={clsx('flex-1 px-8 py-7 max-w-[1400px]', meta.bgClass)}>
        <div className="relative z-10">
          {/* Header */}
          <header className="mb-7 animate-fade-in">
            <div className="flex items-end justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-3 mb-1.5">
                  <span className="text-3xl leading-none">{meta.icon}</span>
                  <h1 className="text-3xl font-extrabold tracking-tight">{meta.label}</h1>
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full mb-1"
                    style={{ background: meta.accent, boxShadow: `0 0 12px ${meta.accent}` }}
                  />
                </div>
                <div className="text-[13px] text-white/45 font-medium">
                  {format(new Date(date + 'T00:00:00'), 'EEEE, MMMM d, yyyy')}
                </div>
              </div>
              <div className="flex items-center gap-3 mono text-[12px]">
                <span className="text-white/55">
                  {matches ? matches.length : '—'}
                  <span className="text-white/35 ml-1">matches</span>
                </span>
                <span className="text-white/15">·</span>
                <span className="text-white/55">
                  {leagues.length}
                  <span className="text-white/35 ml-1">leagues</span>
                </span>
              </div>
            </div>
          </header>

          {error && (
            <div className="card p-4 mb-5 border-red-500/30">
              <div className="text-[13px] text-red-300">{error}</div>
            </div>
          )}

          {/* Filter bar */}
          <div className="mb-4 space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[280px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                <input
                  type="text"
                  placeholder={`Search ${meta.p1Label.toLowerCase()} or ${meta.p2Label.toLowerCase()}…`}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-white/[0.03] border border-white/[0.08] rounded-lg pl-10 pr-3 py-2 text-[13px] text-white placeholder-white/35 outline-none focus:border-white/25 transition-colors"
                />
              </div>
              <SortControls sort={sort} onSortChange={setSort} group={group} onGroupChange={setGroup} />
              {leagueFilter.length > 0 && (
                <button
                  onClick={() => setLeagueFilter([])}
                  className="text-[11px] text-white/55 hover:text-white px-2.5 py-1 rounded-md border border-white/10 hover:border-white/25 transition-colors mono"
                >
                  CLEAR ({leagueFilter.length})
                </button>
              )}
            </div>

            {leagues.length > 0 && (
              <div className="flex flex-wrap gap-1.5 max-h-[68px] overflow-y-auto pr-2">
                {leagues.slice(0, 60).map(({ league, count }) => {
                  const active = leagueFilter.includes(league);
                  const display = league.length > 44 ? `${league.slice(0, 44)}…` : league;
                  return (
                    <button
                      key={league}
                      onClick={() =>
                        setLeagueFilter((curr) =>
                          active ? curr.filter((x) => x !== league) : [...curr, league],
                        )
                      }
                      className={clsx(
                        'px-2.5 py-1 rounded-md text-[10.5px] font-medium transition-all border inline-flex items-center gap-1.5',
                        active
                          ? 'border-white/25 text-white'
                          : 'border-white/[0.06] text-white/50 hover:bg-white/[0.04] hover:text-white/80',
                      )}
                      style={
                        active
                          ? { background: `${meta.accent}22`, borderColor: `${meta.accent}66` }
                          : undefined
                      }
                    >
                      <span>{display}</span>
                      <span className={clsx('text-[10px] mono', active ? 'text-white/65' : 'text-white/30')}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Matches */}
          {loading && matches === null && <MatchCardListSkeleton count={6} />}

          {matches !== null && filteredMatches.length === 0 && !loading && (
            <div className="card p-12 text-center">
              <Trophy className="w-9 h-9 text-white/12 mx-auto mb-3" />
              <div className="text-white/55 text-[14px]">
                {matches.length === 0
                  ? `No ${meta.label.toLowerCase()} events found for this date.`
                  : 'No matches match your filters.'}
              </div>
            </div>
          )}

          {/* Flat view */}
          {group === 'flat' && (
            <div className="grid gap-2.5">
              {sortedMatches.map((m, i) => (
                <MatchCard key={m.matchId} match={m} sport={sport} index={i} showLeague={true} />
              ))}
            </div>
          )}

          {/* Grouped by league view */}
          {group === 'by-league' && grouped && (
            <div className="space-y-7">
              {grouped.map(([league, ms]) => (
                <section key={league}>
                  <header className="sticky top-0 bg-ink-base/85 backdrop-blur z-[5] py-2.5 mb-2 -mx-2 px-2 flex items-center justify-between border-b border-white/[0.05]">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className="w-1 h-4 rounded-full shrink-0"
                        style={{ background: meta.accent }}
                      />
                      <h2 className="text-[13px] font-semibold tracking-tight text-white truncate">
                        {league}
                      </h2>
                    </div>
                    <span className="text-[11px] text-white/45 mono shrink-0">
                      {ms.length} {ms.length === 1 ? 'match' : 'matches'}
                    </span>
                  </header>
                  <div className="grid gap-2.5">
                    {ms.map((m, i) => (
                      <MatchCard key={m.matchId} match={m} sport={sport} index={i} showLeague={false} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
