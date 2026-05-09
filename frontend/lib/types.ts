export type SportKey = 'football' | 'basketball' | 'tennis';

export interface MetricSpec {
  key: string;
  label: string;
  fmt: string;
}

export interface SportConfig {
  key: SportKey;
  icon: string;
  label: string;
  accent: string;
  gradient: string;
  p1Label: string;
  p2Label: string;
  metrics: MetricSpec[];
}

export interface ScheduledMatch {
  matchId: string;
  date: string;
  time: string;
  startTimestamp: number;
  league: string;
  tournament: string;
  category: string;
  home: string;
  homeId: number;
  away: string;
  awayId: number;
  status: 'notstarted' | 'inprogress' | 'finished' | 'postponed' | string | null;
}

export interface MatchAnalysis {
  matchId: string;
  sport: SportKey;
  home: string;
  away: string;
  league: string;
  kickoffTimestamp: number;
  recommendation: string;
  reason: string;
  stats: Record<string, number | string>;
}

export interface SavedPick {
  match_id: string;
  sport: string;
  league: string | null;
  home_team: string | null;
  away_team: string | null;
  kickoff_ts: number | null;
  algo_recommendation: string | null;
  algo_confidence: number | null;
  claude_pick: string | null;
  claude_confidence: number | null;
  claude_verdict: string | null;
  opened_at: string;
  actual_home_score: number | null;
  actual_away_score: number | null;
  match_finished: number;
}
