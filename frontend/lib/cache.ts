/**
 * In-memory schedule cache. Gives instant navigation when the user re-visits a
 * sport+date they recently loaded (e.g. switching back and forth).
 *
 * TTL matches the backend cache (3 min) — on miss we still hit the backend,
 * which has its own 3-min cache, so worst case is one slow fetch every 3 min
 * per (sport, date) combination.
 */
import type { ScheduledMatch } from './types';

const TTL_MS = 3 * 60 * 1000;

type Entry = { data: ScheduledMatch[]; at: number };
const store = new Map<string, Entry>();

const keyFor = (sport: string, date: string, adjacent: boolean) =>
  `${sport}::${date}::${adjacent}`;

export const scheduleCache = {
  get(sport: string, date: string, adjacent: boolean): ScheduledMatch[] | null {
    const entry = store.get(keyFor(sport, date, adjacent));
    if (!entry) return null;
    if (Date.now() - entry.at > TTL_MS) {
      store.delete(keyFor(sport, date, adjacent));
      return null;
    }
    return entry.data;
  },
  set(sport: string, date: string, adjacent: boolean, data: ScheduledMatch[]) {
    store.set(keyFor(sport, date, adjacent), { data, at: Date.now() });
  },
  invalidate(sport?: string) {
    if (!sport) {
      store.clear();
      return;
    }
    for (const k of Array.from(store.keys())) {
      if (k.startsWith(`${sport}::`)) store.delete(k);
    }
  },
};
