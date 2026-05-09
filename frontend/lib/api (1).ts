import type { SportConfig, ScheduledMatch, MatchAnalysis, SavedPick, SportKey } from './types';

const SSE_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {}
    throw new Error(`${res.status}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  sports: () => request<SportConfig[]>('/api/sports'),

  // Step 1: fetch only league names + counts (fast, small payload)
  leagues: (sport: SportKey, date: string, adjacent = false) =>
    request<{ name: string; count: number }[]>(
      `/api/leagues?sport=${sport}&date=${date}&adjacent=${adjacent}`,
    ),

  // Step 2: fetch matches, optionally filtered to selected leagues
  schedule: (sport: SportKey, date: string, adjacent = false, leagues?: string[]) => {
    const qs = new URLSearchParams({ sport, date, adjacent: String(adjacent) });
    if (leagues && leagues.length > 0) qs.set('leagues', leagues.join(','));
    return request<ScheduledMatch[]>(`/api/schedule?${qs}`);
  },

  match: (matchId: string, sport: SportKey) =>
    request<MatchAnalysis>(`/api/match/${matchId}?sport=${sport}`),

  picks: (sport?: SportKey, limit = 200) => {
    const qs = new URLSearchParams();
    if (sport) qs.set('sport', sport);
    qs.set('limit', String(limit));
    return request<SavedPick[]>(`/api/picks?${qs}`);
  },

  claudeStreamUrl: (matchId: string) => `${SSE_BASE}/api/match/${matchId}/claude`,
};
