import type { SportConfig, ScheduledMatch, MatchAnalysis, SavedPick, SportKey } from './types';

// Regular GETs go through the Next.js rewrite proxy (relative URLs).
// SSE bypasses it because Next.js rewrites buffer streaming responses in dev,
// which makes Claude analysis appear stuck. EventSource connects directly to FastAPI.
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

  schedule: (sport: SportKey, date: string, adjacent = false) =>
    request<ScheduledMatch[]>(`/api/schedule?sport=${sport}&date=${date}&adjacent=${adjacent}`),

  match: (matchId: string, sport: SportKey) =>
    request<MatchAnalysis>(`/api/match/${matchId}?sport=${sport}`),

  picks: (sport?: SportKey, limit = 200) => {
    const qs = new URLSearchParams();
    if (sport) qs.set('sport', sport);
    qs.set('limit', String(limit));
    return request<SavedPick[]>(`/api/picks?${qs}`);
  },

  // SSE — direct to backend (bypasses Next.js rewrite buffering)
  claudeStreamUrl: (matchId: string) => `${SSE_BASE}/api/match/${matchId}/claude`,
};
