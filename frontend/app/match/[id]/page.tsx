'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { format } from 'date-fns';
import { ArrowLeft, Sparkles, Trophy } from 'lucide-react';
import clsx from 'clsx';
import { Sidebar } from '@/components/Sidebar';
import { ConfidenceBadge, ConfidenceMeter } from '@/components/ConfidenceBadge';
import { ClaudeAnalysis } from '@/components/ClaudeAnalysis';
import { TeamLogo } from '@/components/TeamLogo';
import { api } from '@/lib/api';
import type { SportConfig, MatchAnalysis, SportKey } from '@/lib/types';

const SPORT_META: Record<SportKey, { label: string; icon: string; accent: string; bgClass: string }> = {
  football:   { label: 'Football',   icon: '⚽', accent: '#10b981', bgClass: 'sport-bg-football' },
  basketball: { label: 'Basketball', icon: '🏀', accent: '#f59e0b', bgClass: 'sport-bg-basketball' },
  tennis:     { label: 'Tennis',     icon: '🎾', accent: '#a855f7', bgClass: 'sport-bg-tennis' },
};

function formatMetric(value: any, fmt: string): string {
  if (value === undefined || value === null || value === '—') return '—';
  try {
    if (fmt === '{}' || typeof value === 'string') return String(value);
    if (fmt === '{:.2f}') return Number(value).toFixed(2);
    if (fmt === '{:.1f}') return Number(value).toFixed(1);
    if (fmt === '{:+.1f}') {
      const n = Number(value);
      return (n >= 0 ? '+' : '') + n.toFixed(1);
    }
    if (fmt === '{:.1%}') return `${(Number(value) * 100).toFixed(1)}%`;
  } catch {}
  return String(value);
}

export default function MatchPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const sportParam = (searchParams.get('sport') ?? 'football') as SportKey;
  const meta = SPORT_META[sportParam] ?? SPORT_META.football;

  const [sportConfigs, setSportConfigs] = useState<SportConfig[]>([]);
  const [data, setData] = useState<MatchAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [adjacent, setAdjacent] = useState(false);

  useEffect(() => {
    api.sports().then(setSportConfigs).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .match(id, sportParam)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setRefreshKey((k) => k + 1);
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id, sportParam]);

  const sportCfg = useMemo(
    () => sportConfigs.find((s) => s.key === sportParam),
    [sportConfigs, sportParam],
  );

  const recColor = useMemo(() => {
    if (!data) return meta.accent;
    const r = data.recommendation || '';
    if (/💎|✅|🥅|🛡️/.test(r)) return meta.accent;
    if (/⚠️/.test(r)) return '#f59e0b';
    return '#ef4444';
  }, [data, meta.accent]);

  return (
    <div className="flex min-h-screen bg-ink-base">
      <Sidebar
        date={date}
        onDateChange={setDate}
        adjacent={adjacent}
        onAdjacentChange={setAdjacent}
        onRefresh={() => router.push(`/${sportParam}`)}
      />

      <main className={clsx('flex-1 px-8 py-7 max-w-[1400px]', meta.bgClass)}>
        <div className="relative z-10">
          <Link
            href={`/${sportParam}`}
            className="inline-flex items-center gap-2 text-[13px] text-white/55 hover:text-white mb-5 transition-colors group"
          >
            <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
            Back to {meta.label.toLowerCase()} slate
          </Link>

          {loading && (
            <div className="card p-12 text-center">
              <div className="inline-block w-5 h-5 border-2 border-white/25 border-t-white rounded-full animate-spin" />
              <div className="mt-3 text-[13px] text-white/55">Pulling match data…</div>
            </div>
          )}

          {error && !loading && (
            <div className="card p-5 border-red-500/30">
              <div className="text-[13px] text-red-300">{error}</div>
            </div>
          )}

          {data && sportCfg && (
            <>
              {/* Match header — typography-driven, no heavy gradient */}
              <header className="mb-6 animate-fade-in">
                <div className="flex items-center gap-2 mb-3 text-[11px] font-medium text-white/45 uppercase tracking-wider">
                  <Trophy className="w-3 h-3" />
                  <span>{data.league}</span>
                  <span className="text-white/25">·</span>
                  <span className="mono">
                    {format(new Date(data.kickoffTimestamp * 1000), 'EEE, MMM d · HH:mm')}
                  </span>
                </div>
                <div className="flex items-center gap-5 flex-wrap">
                  <div className="flex items-center gap-3">
                    <TeamLogo teamId={(data as any).homeId ?? 0} name={data.home} size="lg" />
                    <span className="text-[26px] font-extrabold tracking-tight">{data.home}</span>
                  </div>
                  <span className="text-white/20 text-[14px] font-mono tracking-wider">VS</span>
                  <div className="flex items-center gap-3">
                    <TeamLogo teamId={(data as any).awayId ?? 0} name={data.away} size="lg" />
                    <span className="text-[26px] font-extrabold tracking-tight">{data.away}</span>
                  </div>
                  <span
                    className="ml-auto inline-block w-1.5 h-1.5 rounded-full self-center"
                    style={{ background: meta.accent, boxShadow: `0 0 12px ${meta.accent}` }}
                  />
                </div>
              </header>

              {/* Quant card + confidence panel */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">
                <div
                  className="card lg:col-span-2 p-5 animate-slide-up"
                  style={{ borderLeftColor: recColor, borderLeftWidth: '3px' }}
                >
                  <div className="flex items-center gap-2 text-[10px] text-white/40 uppercase tracking-[0.12em] font-semibold mb-2">
                    <Trophy className="w-3 h-3" />
                    Quant Engine
                  </div>
                  <h2 className="text-[22px] font-bold text-white mb-1.5 tracking-tight">
                    {data.recommendation}
                  </h2>
                  <p className="text-[13px] text-white/60 italic">{data.reason}</p>
                </div>

                <div className="card p-5 text-center animate-slide-up">
                  <div className="text-[10px] text-white/40 uppercase tracking-[0.12em] font-semibold mb-1">
                    Confidence
                  </div>
                  <div className="my-2.5 mono">
                    <span className="text-[44px] font-extrabold text-white tabular leading-none">
                      {Number(data.stats.Confidence ?? 0).toFixed(0)}
                    </span>
                    <span className="text-[18px] text-white/30 font-bold">/100</span>
                  </div>
                  <ConfidenceBadge value={Number(data.stats.Confidence ?? 0)} />
                  <div className="mt-3.5">
                    <ConfidenceMeter value={Number(data.stats.Confidence ?? 0)} accent={meta.accent} />
                  </div>
                </div>
              </div>

              {/* Claude AI Analysis (streams) */}
              <div className="mb-4">
                <ClaudeAnalysis matchId={id} refreshKey={refreshKey} />
              </div>

              {/* Key Metrics */}
              <div className="card p-5">
                <div className="flex items-center gap-2 text-[10px] text-white/40 uppercase tracking-[0.12em] font-semibold mb-4">
                  <Sparkles className="w-3 h-3" />
                  Key Metrics
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                  {sportCfg.metrics.map((m) => (
                    <div
                      key={m.key}
                      className="bg-white/[0.02] border border-white/[0.05] rounded-lg p-3 hover:border-white/12 transition-colors"
                    >
                      <div className="text-[10px] text-white/40 font-medium mb-1 uppercase tracking-wider">
                        {m.label}
                      </div>
                      <div className="text-[16px] font-bold text-white mono tabular">
                        {formatMetric(data.stats[m.key], m.fmt)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
