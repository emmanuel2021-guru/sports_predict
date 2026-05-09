'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { format } from 'date-fns';
import { Search, Trophy, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { Sidebar } from './Sidebar';
import { MatchCard } from './MatchCard';
import { SortControls, type SortMode, type GroupMode } from './SortControls';
import { MatchCardListSkeleton } from './Skeleton';
import { api } from '@/lib/api';
import { scheduleCache } from '@/lib/cache';
import type { ScheduledMatch, SportKey } from '@/lib/types';

const SPORT_META: Record<SportKey, { label: string; icon: string; accent: string; bgClass: string; p1Label: string; p2Label: string }> = {
  football: { label: 'Football', icon: '⚽', accent: '#10b981', bgClass: 'sport-bg-football', p1Label: 'Home', p2Label: 'Away' },
  basketball: { label: 'Basketball', icon: '🏀', accent: '#f59e0b', bgClass: 'sport-bg-basketball', p1Label: 'Home', p2Label: 'Away' },
  tennis: { label: 'Tennis', icon: '🎾', accent: '#a855f7', bgClass: 'sport-bg-tennis', p1Label: 'Player A', p2Label: 'Player B' },
};

type Step = 'pick-leagues' | 'show-matches';

export function SlateView({ sport }: { sport: SportKey }) {
  const meta = SPORT_META[sport];
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [adjacent, setAdjacent] = useState(false);

  // Step 1 — leagues
  const [step, setStep] = useState<Step>('pick-leagues');
  const [leagues, setLeagues] = useState<{ name: string; count: number }[]>([]);
  const [leaguesLoading, setLeaguesLoading] = useState(false);
  const [leaguesError, setLeaguesError] = useState<string | null>(null);
  const [selectedLeagues, setSelectedLeagues] = useState<string[]>([]);

  // Step 2 — matches
  const [matches, setMatches] = useState<ScheduledMatch[] | null>(null);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [matchesError, setMatchesError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('time');
  const [group, setGroup] = useState<GroupMode>('flat');

  // ── Step 1: load leagues whenever date / sport / adjacent changes ──
  const loadLeagues = useCallback(() => {
    setStep('pick-leagues');
    setMatches(null);
    setSelectedLeagues([]);
    setSearchQuery('');
    setLeaguesError(null);
    setLeaguesLoading(true);

    api
      .leagues(sport, date, adjacent)
      .then((data) => setLeagues(data))
      .catch((e) => setLeaguesError(e.message))
      .finally(() => setLeaguesLoading(false));
  }, [sport, date, adjacent]);

  useEffect(() => {
    loadLeagues();
  }, [loadLeagues]);

  // ── Step 2: load matches for chosen leagues ──
  const loadMatches = useCallback(() => {
    setMatchesError(null);
    setMatchesLoading(true);
    setStep('show-matches');

    api
      .schedule(sport, date, adjacent, selectedLeagues.length > 0 ? selectedLeagues : undefined)
      .then((data) => {
        setMatches(data);
        scheduleCache.set(sport, date, adjacent, data);
      })
      .catch((e) => setMatchesError(e.message))
      .finally(() => setMatchesLoading(false));
  }, [sport, date, adjacent, selectedLeagues]);

  const handleRefresh = () => {
    scheduleCache.invalidate(sport);
    loadLeagues();
  };

  const toggleLeague = (name: string) =>
    setSelectedLeagues((curr) =>
      curr.includes(name) ? curr.filter((x) => x !== name) : [...curr, name],
    );

  const selectAll = () => setSelectedLeagues(leagues.map((l) => l.name));
  const clearAll = () => setSelectedLeagues([]);

  // ── Filtering / sorting (step 2 only) ──
  const filteredMatches = useMemo(() => {
    if (!matches) return [];
    let m = matches;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      m = m.filter((x) => x.home.toLowerCase().includes(q) || x.away.toLowerCase().includes(q));
    }
    return m;
  }, [matches, searchQuery]);

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

  const totalSelected = selectedLeagues.reduce(
    (sum, name) => sum + (leagues.find((l) => l.name === name)?.count ?? 0),
    0,
  );

  return (
    <div className="flex min-h-screen bg-ink-base">
      <Sidebar
        date={date}
        onDateChange={(d) => { setDate(d); }}
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
                {step === 'pick-leagues' ? (
                  <span className="text-white/55">
                    {leaguesLoading ? '…' : leagues.length}
                    <span className="text-white/35 ml-1">leagues available</span>
                  </span>
                ) : (
                  <>
                    <span className="text-white/55">
                      {matches ? matches.length : '—'}
                      <span className="text-white/35 ml-1">matches</span>
                    </span>
                    <span className="text-white/15">·</span>
                    <button
                      onClick={() => setStep('pick-leagues')}
                      className="text-white/55 hover:text-white transition-colors underline underline-offset-2"
                    >
                      change leagues
                    </button>
                  </>
                )}
              </div>
            </div>
          </header>

          {/* ── STEP 1: League picker ── */}
          {step === 'pick-leagues' && (
            <div className="animate-fade-in">
              {leaguesError && (
                <div className="card p-4 mb-5 border-red-500/30">
                  <div className="text-[13px] text-red-300">{leaguesError}</div>
                </div>
              )}

              {leaguesLoading && (
                <div className="card p-10 flex flex-col items-center gap-3 text-white/40">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <span className="text-[13px]">Fetching available leagues…</span>
                </div>
              )}

              {!leaguesLoading && leagues.length > 0 && (
                <div className="card p-5">
                  {/* Picker header */}
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-[14px] font-semibold text-white">
                        Choose leagues to load
                      </h2>
                      <p className="text-[12px] text-white/40 mt-0.5">
                        Select one or more — or load all {leagues.reduce((s, l) => s + l.count, 0)} matches at once
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={selectAll}
                        className="text-[11px] text-white/55 hover:text-white px-2.5 py-1 rounded-md border border-white/10 hover:border-white/25 transition-colors mono"
                      >
                        ALL
                      </button>
                      {selectedLeagues.length > 0 && (
                        <button
                          onClick={clearAll}
                          className="text-[11px] text-white/55 hover:text-white px-2.5 py-1 rounded-md border border-white/10 hover:border-white/25 transition-colors mono"
                        >
                          CLEAR
                        </button>
                      )}
                    </div>
                  </div>

                  {/* League chips */}
                  <div className="flex flex-wrap gap-2 mb-5">
                    {leagues.map(({ name, count }) => {
                      const active = selectedLeagues.includes(name);
                      const display = name.length > 48 ? `${name.slice(0, 48)}…` : name;
                      return (
                        <button
                          key={name}
                          onClick={() => toggleLeague(name)}
                          className={clsx(
                            'px-3 py-1.5 rounded-lg text-[11.5px] font-medium transition-all border inline-flex items-center gap-2',
                            active
                              ? 'border-white/25 text-white'
                              : 'border-white/[0.07] text-white/50 hover:bg-white/[0.04] hover:text-white/80',
                          )}
                          style={
                            active
                              ? { background: `${meta.accent}22`, borderColor: `${meta.accent}66` }
                              : undefined
                          }
                        >
                          {active && (
                            <span
                              className="w-1.5 h-1.5 rounded-full shrink-0"
                              style={{ background: meta.accent }}
                            />
                          )}
                          <span>{display}</span>
                          <span className={clsx('text-[10px] mono', active ? 'text-white/65' : 'text-white/30')}>
                            {count}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Load button */}
                  <div className="flex items-center justify-between border-t border-white/[0.06] pt-4">
                    <span className="text-[12px] text-white/40 mono">
                      {selectedLeagues.length === 0
                        ? `${leagues.reduce((s, l) => s + l.count, 0)} matches will load`
                        : `${totalSelected} match${totalSelected !== 1 ? 'es' : ''} from ${selectedLeagues.length} league${selectedLeagues.length !== 1 ? 's' : ''}`}
                    </span>
                    <button
                      onClick={loadMatches}
                      className="flex items-center gap-2 px-5 py-2 rounded-lg text-[13px] font-semibold transition-all hover:opacity-90 active:scale-95"
                      style={{ background: meta.accent, color: '#000' }}
                    >
                      Load Matches
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {!leaguesLoading && leagues.length === 0 && !leaguesError && (
                <div className="card p-12 text-center">
                  <Trophy className="w-9 h-9 text-white/12 mx-auto mb-3" />
                  <div className="text-white/55 text-[14px]">
                    No {meta.label.toLowerCase()} events found for this date.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 2: Matches ── */}
          {step === 'show-matches' && (
            <div className="animate-fade-in">
              {matchesError && (
                <div className="card p-4 mb-5 border-red-500/30">
                  <div className="text-[13px] text-red-300">{matchesError}</div>
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
                  <button
                    onClick={() => setStep('pick-leagues')}
                    className="flex items-center gap-1.5 text-[11px] text-white/55 hover:text-white px-2.5 py-1 rounded-md border border-white/10 hover:border-white/25 transition-colors mono"
                  >
                    <RefreshCw className="w-3 h-3" />
                    LEAGUES
                  </button>
                </div>

                {/* Selected league pills (read-only reminder) */}
                {selectedLeagues.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedLeagues.map((name) => (
                      <span
                        key={name}
                        className="px-2.5 py-1 rounded-md text-[10.5px] font-medium border inline-flex items-center gap-1.5"
                        style={{ background: `${meta.accent}18`, borderColor: `${meta.accent}44`, color: 'rgba(255,255,255,0.7)' }}
                      >
                        {name.length > 44 ? `${name.slice(0, 44)}…` : name}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {matchesLoading && matches === null && <MatchCardListSkeleton count={6} />}

              {matches !== null && filteredMatches.length === 0 && !matchesLoading && (
                <div className="card p-12 text-center">
                  <Trophy className="w-9 h-9 text-white/12 mx-auto mb-3" />
                  <div className="text-white/55 text-[14px]">
                    {matches.length === 0
                      ? `No ${meta.label.toLowerCase()} events found for the selected leagues.`
                      : 'No matches match your search.'}
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
                          <span className="w-1 h-4 rounded-full shrink-0" style={{ background: meta.accent }} />
                          <h2 className="text-[13px] font-semibold tracking-tight text-white truncate">{league}</h2>
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
          )}

        </div>
      </main>
    </div>
  );
}
