'use client';

import Link from 'next/link';
import { ArrowRight, Trophy } from 'lucide-react';
import { TeamLogo } from './TeamLogo';
import type { ScheduledMatch, SportKey } from '@/lib/types';

const SPORT_ACCENTS: Record<SportKey, string> = {
  football: '#10b981',
  basketball: '#f59e0b',
  tennis: '#a855f7',
};

interface Props {
  match: ScheduledMatch;
  sport: SportKey;
  index?: number;
  showLeague?: boolean;
}

export function MatchCard({ match: m, sport, index = 0, showLeague = true }: Props) {
  const live = m.status === 'inprogress';
  const finished = m.status === 'finished';
  const accent = SPORT_ACCENTS[sport];

  return (
    <Link
      href={`/match/${m.matchId}?sport=${sport}`}
      style={{ animationDelay: `${Math.min(index * 24, 360)}ms` }}
      className="card card-hover group p-3.5 flex items-center gap-3.5 cursor-pointer animate-fade-in"
    >
      {/* Time block */}
      <div className="flex flex-col items-center justify-center min-w-[58px] py-1.5 px-2 rounded-md bg-white/[0.025] border border-white/[0.05]">
        {live ? (
          <>
            <span className="live-dot mb-1" />
            <div className="text-[9px] font-bold text-red-400 tracking-wider mono">LIVE</div>
          </>
        ) : finished ? (
          <>
            <div className="text-[9px] font-bold text-white/45 tracking-wider mono">FT</div>
            <div className="text-[11px] font-semibold text-white/60 tabular mt-0.5">{m.time}</div>
          </>
        ) : (
          <>
            <div className="text-[15px] font-bold text-white tabular mono">{m.time}</div>
            <div className="text-[10px] text-white/35 tabular mono mt-0.5">{m.date.slice(5)}</div>
          </>
        )}
      </div>

      {/* Teams + league */}
      <div className="flex-1 min-w-0">
        {showLeague && (
          <div className="flex items-center gap-1.5 text-[10.5px] text-white/40 mb-1.5 truncate uppercase tracking-wider font-medium">
            <Trophy className="w-2.5 h-2.5 shrink-0" />
            <span className="truncate">{m.league}</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <TeamLogo teamId={m.homeId} name={m.home} size="sm" />
          <span className="text-[14px] font-semibold text-white truncate">{m.home}</span>
          <span className="text-white/20 text-[10px] px-1 font-mono tracking-wider shrink-0">VS</span>
          <TeamLogo teamId={m.awayId} name={m.away} size="sm" />
          <span className="text-[14px] font-semibold text-white truncate">{m.away}</span>
        </div>
      </div>

      <ArrowRight
        className="w-4 h-4 text-white/20 group-hover:text-white/85 group-hover:translate-x-0.5 transition-all shrink-0"
        style={{ transition: 'all 0.18s ease' }}
      />
      {/* Sport accent on hover */}
      <span
        aria-hidden
        className="w-[3px] absolute right-0 top-2 bottom-2 rounded-l opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ background: accent }}
      />
    </Link>
  );
}
