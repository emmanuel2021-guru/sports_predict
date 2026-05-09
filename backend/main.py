"""
Markets Pro — FastAPI backend.

Exposes:
  GET  /api/sports                   → sport configs for the frontend
  GET  /api/schedule                 → list of matches for date+sport
  GET  /api/match/{match_id}         → algo analysis + stats (also caches the brief)
  GET  /api/match/{match_id}/claude  → SSE stream of Claude's analysis
  GET  /api/picks                    → saved picks from backtesting DB

Run:
    cd backend
    pip install -r requirements.txt
    uvicorn main:app --reload --port 8000
"""

import os
import json
import re
import time
import random
import sqlite3
from pathlib import Path
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor
from typing import Optional, AsyncIterator, Any

from fastapi import FastAPI, HTTPException, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from curl_cffi import requests
import anthropic

from sport_logic import SPORTS

# ============================================================
# CONFIG
# ============================================================
# DB path: defaults to <repo_root>/match_picks.db so it's shared with the Streamlit
# apps locally. In production, set PICKS_DB_PATH to a persistent volume location
# (e.g. /data/match_picks.db on Render).
PICKS_DB_PATH = Path(
    os.environ.get(
        "PICKS_DB_PATH",
        str(Path(__file__).resolve().parent.parent.parent / "match_picks.db"),
    )
)
BRIEFS_CACHE: dict[str, tuple[str, str, float]] = {}  # match_id -> (brief, sport, expires_at)
CACHE_TTL_SECONDS = 600  # 10 min

# --- Claude model + thinking config (override via env vars without code changes) ---
# Default: cheapest reasonable config. Bump to Sonnet 4.6 + adaptive for higher quality.
#   CLAUDE_MODEL    = claude-haiku-4-5 | claude-sonnet-4-6 | claude-opus-4-7
#   CLAUDE_THINKING = disabled | adaptive
# --- Path A defaults: Sonnet 4.6 + medium-effort adaptive thinking + compact brief ---
# Realistic cost: $0.015-0.025 per match. Thinking is at "good" depth (medium effort
# uses ~1000-2000 thinking tokens — enough to weigh form, H2H, and value markets).
CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-6")
CLAUDE_THINKING = os.environ.get("CLAUDE_THINKING", "enabled")
# medium = balanced thinking depth. Set "high" for deepest reasoning at ~2× the cost.
CLAUDE_EFFORT = os.environ.get("CLAUDE_EFFORT", "medium")
# Hard cap on output tokens (thinking + visible). 2048 ≈ $0.031 max on Sonnet —
# safety ceiling, typical use is well below this.
CLAUDE_MAX_TOKENS = int(os.environ.get("CLAUDE_MAX_TOKENS", "2048"))
# Trims the brief: fewer recent matches + fewer H2H entries → smaller input cost.
CLAUDE_COMPACT_BRIEF = os.environ.get("CLAUDE_COMPACT_BRIEF", "true").lower() in ("true", "1", "yes")

THINKING_ON = CLAUDE_THINKING.lower() in ("adaptive", "enabled", "on", "true")

# Models that support adaptive thinking (Claude 4.6+).
ADAPTIVE_THINKING_MODELS = {
    "claude-opus-4-7",
    "claude-opus-4-6",
    "claude-sonnet-4-6",
}
# Models that support the `effort` parameter.
EFFORT_SUPPORTING_MODELS = {
    "claude-opus-4-7",
    "claude-opus-4-6",
    "claude-opus-4-5",
    "claude-sonnet-4-6",
}

# Legacy enabled-mode budget (only used when model doesn't support adaptive).
CLAUDE_THINKING_BUDGET = int(os.environ.get("CLAUDE_THINKING_BUDGET", "1024"))


def thinking_config(model: str, on: bool):
    """Returns the right thinking dict for the SDK based on model capability.
    None if thinking is off."""
    if not on:
        return None
    if model in ADAPTIVE_THINKING_MODELS:
        return {"type": "adaptive"}
    return {"type": "enabled", "budget_tokens": CLAUDE_THINKING_BUDGET}

# Pricing (USD per 1M tokens) — input, output. Cache read = 10% of input. Cache write 5min = 125% of input.
MODEL_PRICING: dict[str, tuple[float, float]] = {
    "claude-opus-4-7": (5.0, 25.0),
    "claude-opus-4-6": (5.0, 25.0),
    "claude-sonnet-4-6": (3.0, 15.0),
    "claude-haiku-4-5": (1.0, 5.0),
}

def get_model_rates(model: str) -> dict[str, float]:
    base_in, base_out = MODEL_PRICING.get(model, (3.0, 15.0))
    return {
        "input": base_in,
        "output": base_out,
        "cacheRead": base_in * 0.10,
        "cacheWrite": base_in * 1.25,
    }

app = FastAPI(title="Markets Pro API", version="1.0.0")

# CORS — set CORS_ORIGINS env var in production (comma-separated list).
# Defaults cover local dev.
_default_origins = "http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000"
_origins_env = os.environ.get("CORS_ORIGINS", _default_origins)
CORS_ORIGINS = [o.strip() for o in _origins_env.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# DB INIT + HELPERS
# ============================================================
def _picks_db_init():
    conn = sqlite3.connect(PICKS_DB_PATH, timeout=10.0)
    try:
        cur = conn.cursor()
        cur.execute('''
            CREATE TABLE IF NOT EXISTS match_picks (
                match_id TEXT PRIMARY KEY,
                sport TEXT NOT NULL,
                league TEXT,
                home_team TEXT,
                away_team TEXT,
                kickoff_ts INTEGER,
                algo_recommendation TEXT,
                algo_reason TEXT,
                algo_confidence REAL,
                algo_stats_json TEXT,
                claude_full_analysis TEXT,
                claude_pick TEXT,
                claude_confidence INTEGER,
                claude_verdict TEXT,
                actual_home_score INTEGER,
                actual_away_score INTEGER,
                match_finished INTEGER DEFAULT 0,
                opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        ''')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_sport_kickoff ON match_picks(sport, kickoff_ts);')
        conn.commit()
    finally:
        conn.close()

_picks_db_init()


def save_match_open(sport: str, details: dict, stats: dict, rec: str, rec_reason: str):
    try:
        match_id = str(details.get('id'))
        home = details.get('homeTeam', {}).get('name')
        away = details.get('awayTeam', {}).get('name')
        league = f"{details.get('tournament', {}).get('category', {}).get('name', '')} - {details.get('tournament', {}).get('name', '')}"
        kickoff_ts = details.get('startTimestamp')

        def _safe(v):
            if isinstance(v, (int, float, str, bool)) or v is None:
                return v
            return str(v)
        stats_json = json.dumps({k: _safe(v) for k, v in stats.items() if k not in ('Predictions', 'Reasons')})

        conn = sqlite3.connect(PICKS_DB_PATH, timeout=10.0)
        try:
            cur = conn.cursor()
            cur.execute('''
                INSERT INTO match_picks
                (match_id, sport, league, home_team, away_team, kickoff_ts,
                 algo_recommendation, algo_reason, algo_confidence, algo_stats_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(match_id) DO UPDATE SET
                    sport=excluded.sport, league=excluded.league,
                    home_team=excluded.home_team, away_team=excluded.away_team,
                    kickoff_ts=excluded.kickoff_ts,
                    algo_recommendation=excluded.algo_recommendation,
                    algo_reason=excluded.algo_reason,
                    algo_confidence=excluded.algo_confidence,
                    algo_stats_json=excluded.algo_stats_json,
                    updated_at=CURRENT_TIMESTAMP;
            ''', (match_id, sport, league, home, away, kickoff_ts,
                  rec, rec_reason, stats.get('Confidence'), stats_json))
            conn.commit()
        finally:
            conn.close()
    except Exception:
        pass  # never break the API on a save failure


def save_claude_analysis(match_id: str, full_text: str):
    try:
        pick = confidence = verdict = None
        m = re.search(r'Best Pick.*?\*\*([^*\n]+)\*\*.*?[Cc]onfidence:\s*\*?\*?(\d+)\s*/\s*100', full_text, re.DOTALL)
        if m:
            pick = m.group(1).strip(' —–-')
            confidence = int(m.group(2))
        v = re.search(r'Verdict\s*\n+([^\n]+)', full_text)
        if v:
            verdict = v.group(1).strip(' *')

        conn = sqlite3.connect(PICKS_DB_PATH, timeout=10.0)
        try:
            cur = conn.cursor()
            cur.execute('''
                UPDATE match_picks SET
                    claude_full_analysis = ?,
                    claude_pick = ?,
                    claude_confidence = ?,
                    claude_verdict = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE match_id = ?;
            ''', (full_text, pick, confidence, verdict, str(match_id)))
            conn.commit()
        finally:
            conn.close()
    except Exception:
        pass


def get_saved_picks(sport: Optional[str] = None, limit: int = 200) -> list[dict]:
    try:
        conn = sqlite3.connect(PICKS_DB_PATH, timeout=10.0)
        conn.row_factory = sqlite3.Row
        try:
            cur = conn.cursor()
            base = '''SELECT match_id, sport, league, home_team, away_team, kickoff_ts,
                             algo_recommendation, algo_confidence, claude_pick,
                             claude_confidence, claude_verdict, opened_at,
                             actual_home_score, actual_away_score, match_finished
                      FROM match_picks'''
            if sport:
                cur.execute(f'{base} WHERE sport = ? ORDER BY opened_at DESC LIMIT ?;', (sport, limit))
            else:
                cur.execute(f'{base} ORDER BY opened_at DESC LIMIT ?;', (limit,))
            return [dict(r) for r in cur.fetchall()]
        finally:
            conn.close()
    except Exception:
        return []


# ============================================================
# STEALTH FETCHER
# ============================================================
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
]

def _headers():
    return {
        "User-Agent": random.choice(USER_AGENTS),
        "Referer": "https://www.sofascore.com/",
        "Origin": "https://www.sofascore.com",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
    }

def fetch_with_retry(url: str, retries: int = 3):
    """Fetch with backoff. No pre-sleep on first attempt — sleep only between retries."""
    for attempt in range(retries):
        try:
            if attempt > 0:
                time.sleep(random.uniform(0.5, 1.5))
            resp = requests.get(url, headers=_headers(), impersonate="chrome120", timeout=15)
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code == 404:
                return None
            if resp.status_code == 403:
                time.sleep(2)
                continue
        except Exception:
            time.sleep(0.5)
    return None


# --- Schedule cache (in-memory, TTL-based) ---
SCHEDULE_CACHE: dict[tuple, tuple[list, float]] = {}
SCHEDULE_TTL = 180  # 3 min


def fetch_schedule(sport_path: str, target_date, include_adjacent: bool, doubles_filter: bool):
    """Fetch the slate. Cached for 3 minutes. Parallelizes the 2 (or 6 with adjacent)
    SofaScore endpoint calls so wall time is ~1 request, not N."""
    cache_key = (sport_path, target_date.isoformat(), include_adjacent, doubles_filter)
    now = time.time()
    cached = SCHEDULE_CACHE.get(cache_key)
    if cached:
        data, ts = cached
        if now - ts < SCHEDULE_TTL:
            return data

    dates = [target_date]
    if include_adjacent:
        dates.append(target_date - timedelta(days=1))
        dates.append(target_date + timedelta(days=1))

    urls = []
    for d in dates:
        d_str = d.strftime("%Y-%m-%d")
        urls.append(f"https://api.sofascore.com/api/v1/sport/{sport_path}/scheduled-events/{d_str}")
        urls.append(f"https://api.sofascore.com/api/v1/sport/{sport_path}/scheduled-events/{d_str}/inverse")

    # Parallel fan-out — wall time is ~1 request instead of N.
    with ThreadPoolExecutor(max_workers=min(len(urls), 6)) as ex:
        results = list(ex.map(fetch_with_retry, urls))

    all_events, seen = [], set()
    for data in results:
        if not data:
            continue
        for e in data.get('events', []):
            if e['id'] in seen:
                continue
            if doubles_filter and 'doubles' in (e.get('tournament', {}).get('name', '').lower()):
                continue
            seen.add(e['id'])
            all_events.append(e)
    sorted_events = sorted(all_events, key=lambda x: x['startTimestamp'])
    SCHEDULE_CACHE[cache_key] = (sorted_events, now)
    return sorted_events


def fetch_event_details(event_id: str):
    data = fetch_with_retry(f"https://api.sofascore.com/api/v1/event/{event_id}")
    return data.get('event', {}) if data else {}


def fetch_h2h_custom(custom_id, doubles_filter: bool):
    if not custom_id:
        return []
    data = fetch_with_retry(f"https://api.sofascore.com/api/v1/event/{custom_id}/h2h/events")
    if not data:
        return []
    events = data.get('events', [])
    events = [e for e in events if 'friendly' not in e.get('tournament', {}).get('name', '').lower()]
    if doubles_filter:
        events = [e for e in events if 'doubles' not in e.get('tournament', {}).get('name', '').lower()]
    return events


def fetch_team_history_deep(team_id, doubles_filter: bool):
    all_events = []
    def fetch_page(p):
        data = fetch_with_retry(f"https://api.sofascore.com/api/v1/team/{team_id}/events/last/{p}", retries=2)
        return data.get('events', []) if data else []
    with ThreadPoolExecutor(max_workers=3) as ex:
        results = list(ex.map(fetch_page, range(5)))
    for res in results:
        all_events.extend(res)
    seen, unique = set(), []
    for e in all_events:
        if e['id'] in seen:
            continue
        if 'friendly' in e.get('tournament', {}).get('name', '').lower():
            continue
        if doubles_filter and 'doubles' in e.get('tournament', {}).get('name', '').lower():
            continue
        seen.add(e['id'])
        unique.append(e)
    return sorted(unique, key=lambda x: x['startTimestamp'], reverse=True)


# ============================================================
# ENDPOINTS
# ============================================================
@app.get("/api/sports")
def list_sports():
    """Return all sport configs for the frontend."""
    return [{
        'key': k,
        'icon': v['icon'],
        'label': v['label'],
        'accent': v['accent'],
        'gradient': v['gradient'],
        'p1Label': v['p1_label'],
        'p2Label': v['p2_label'],
        'metrics': [
            {'key': key, 'label': label, 'fmt': fmt}
            for key, label, fmt in v['metrics']
        ],
    } for k, v in SPORTS.items()]


def _league_string(e: dict) -> str:
    """Single source of truth for the league display string — used for both
    /api/leagues (display) and /api/schedule (filtering)."""
    cat = (e.get('tournament', {}).get('category', {}) or {}).get('name', '')
    tour = e.get('tournament', {}).get('name', '')
    return f"{cat} - {tour}".strip(' -')


@app.get("/api/leagues")
def get_leagues(sport: str = Query(...), date: str = Query(...), adjacent: bool = False):
    """Returns just league names + match counts. Much smaller payload than /api/schedule
    — used by the slate's first-paint league picker."""
    if sport not in SPORTS:
        raise HTTPException(400, f"Unknown sport: {sport}")
    try:
        target_date = datetime.strptime(date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(400, "date must be YYYY-MM-DD")

    cfg = SPORTS[sport]
    events = fetch_schedule(cfg['fetch_path'], target_date, adjacent, cfg['doubles_filter'])
    counts: dict[str, int] = {}
    for e in events:
        name = _league_string(e)
        counts[name] = counts.get(name, 0) + 1
    return [{"name": k, "count": v} for k, v in sorted(counts.items(), key=lambda x: x[0].lower())]


@app.get("/api/schedule")
def get_schedule(
    sport: str = Query(...),
    date: str = Query(...),
    adjacent: bool = False,
    leagues: Optional[str] = None,  # comma-separated league names to filter to
):
    if sport not in SPORTS:
        raise HTTPException(400, f"Unknown sport: {sport}")
    try:
        target_date = datetime.strptime(date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(400, "date must be YYYY-MM-DD")

    cfg = SPORTS[sport]
    events = fetch_schedule(cfg['fetch_path'], target_date, adjacent, cfg['doubles_filter'])

    # Optional league filter — keeps only events whose computed league string is in the set.
    if leagues:
        wanted = {x.strip() for x in leagues.split(",") if x.strip()}
        if wanted:
            events = [e for e in events if _league_string(e) in wanted]

    return [{
        'matchId': str(e['id']),
        'date': datetime.fromtimestamp(e['startTimestamp']).strftime('%Y-%m-%d'),
        'time': datetime.fromtimestamp(e['startTimestamp']).strftime('%H:%M'),
        'startTimestamp': e['startTimestamp'],
        'league': _league_string(e),
        'tournament': e.get('tournament', {}).get('name', ''),
        'category': (e.get('tournament', {}).get('category', {}) or {}).get('name', ''),
        'home': e.get('homeTeam', {}).get('name'),
        'homeId': e.get('homeTeam', {}).get('id'),
        'away': e.get('awayTeam', {}).get('name'),
        'awayId': e.get('awayTeam', {}).get('id'),
        'status': (e.get('status') or {}).get('type'),
    } for e in events]


@app.get("/api/match/{match_id}")
def get_match(match_id: str, sport: str = Query(...)):
    if sport not in SPORTS:
        raise HTTPException(400, f"Unknown sport: {sport}")
    cfg = SPORTS[sport]

    details = fetch_event_details(match_id)
    if not details:
        raise HTTPException(404, "Match not found")

    cid = details.get('customId')
    with ThreadPoolExecutor(max_workers=3) as ex:
        f_h2h = ex.submit(fetch_h2h_custom, cid, cfg['doubles_filter'])
        f_p1 = ex.submit(fetch_team_history_deep, details['homeTeam']['id'], cfg['doubles_filter'])
        f_p2 = ex.submit(fetch_team_history_deep, details['awayTeam']['id'], cfg['doubles_filter'])
        h2h, p1_history, p2_history = f_h2h.result(), f_p1.result(), f_p2.result()

    # 🚨 Strip the current match from history. SofaScore's /events/last and
    # /h2h/events endpoints include the match itself if kickoff has passed —
    # for a LIVE match they return the live score (e.g. 1-0), which would leak
    # into the brief and corrupt Claude's prediction.
    target_id = details.get('id')
    h2h = [e for e in h2h if e.get('id') != target_id]
    p1_history = [e for e in p1_history if e.get('id') != target_id]
    p2_history = [e for e in p2_history if e.get('id') != target_id]

    if not (p1_history and p2_history):
        raise HTTPException(404, "Insufficient history data for this match")

    # Run analysis on the full history (more data = better stats).
    stats, rec, rec_reason = cfg['analyze'](details, h2h, p1_history, p2_history)
    # But the brief Claude sees can be trimmed to save input tokens. Compact mode
    # cuts H2H from ~10 → 5 and team form from ~15 → 7.
    if CLAUDE_COMPACT_BRIEF:
        brief = cfg['brief'](details, h2h[:5], p1_history[:7], p2_history[:7], stats)
    else:
        brief = cfg['brief'](details, h2h, p1_history, p2_history, stats)

    BRIEFS_CACHE[match_id] = (brief, sport, time.time() + CACHE_TTL_SECONDS)
    save_match_open(sport, details, stats, rec, rec_reason)

    # Pretty-format known float fields for the JSON response
    safe_stats = {}
    for k, v in stats.items():
        if isinstance(v, list):
            continue  # Predictions/Reasons lists drop here
        if isinstance(v, float):
            safe_stats[k] = round(v, 2)
        else:
            safe_stats[k] = v

    return {
        'matchId': match_id,
        'sport': sport,
        'home': details.get('homeTeam', {}).get('name'),
        'away': details.get('awayTeam', {}).get('name'),
        'league': f"{(details.get('tournament', {}).get('category', {}) or {}).get('name', '')} - {details.get('tournament', {}).get('name', '')}".strip(' -'),
        'kickoffTimestamp': details.get('startTimestamp'),
        'recommendation': rec,
        'reason': rec_reason,
        'stats': safe_stats,
    }


@app.get("/api/match/{match_id}/claude")
async def stream_claude(match_id: str):
    if match_id not in BRIEFS_CACHE:
        raise HTTPException(404, "Brief not cached. Hit /api/match/{id} first.")

    brief, sport, expires = BRIEFS_CACHE[match_id]
    if time.time() > expires:
        del BRIEFS_CACHE[match_id]
        raise HTTPException(410, "Brief expired. Re-fetch /api/match/{id}.")

    cfg = SPORTS[sport]
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(500, "ANTHROPIC_API_KEY environment variable not set")

    # AsyncAnthropic is async-native — avoids threadpool buffering on streaming.
    # max_retries=4: SDK auto-handles 429s with exponential backoff, reading the
    # retry-after header from Anthropic. Default is 2.
    client = anthropic.AsyncAnthropic(api_key=api_key, max_retries=4)

    rates = get_model_rates(CLAUDE_MODEL)

    def compute_cost(input_tokens: int, output_tokens: int, cache_read: int, cache_write: int) -> float:
        return (
            input_tokens * rates["input"]
            + output_tokens * rates["output"]
            + cache_read * rates["cacheRead"]
            + cache_write * rates["cacheWrite"]
        ) / 1_000_000

    async def event_stream():
        # Initial heartbeat — flushes any intermediate buffer and confirms the
        # connection is open while Claude's adaptive thinking warms up.
        yield ": connected\n\n"
        yield f"data: {json.dumps({'type': 'open', 'model': CLAUDE_MODEL, 'thinking': CLAUDE_THINKING, 'rates': rates})}\n\n"

        full_text = ""
        thinking_chars = 0
        last_thinking_emit = 0.0
        meta_sent = False
        try:
            t_cfg = thinking_config(CLAUDE_MODEL, THINKING_ON)
            # max_tokens caps total output (thinking + visible). For Sonnet at $15/1M,
            # 1024 = $0.015 hard ceiling on output tokens.
            max_tokens = CLAUDE_MAX_TOKENS

            stream_kwargs = {
                "model": CLAUDE_MODEL,
                "max_tokens": max_tokens,
                "system": [{
                    "type": "text",
                    "text": cfg['prompt'],
                    "cache_control": {"type": "ephemeral"},
                }],
                "messages": [{"role": "user", "content": brief}],
            }
            if t_cfg:
                stream_kwargs["thinking"] = t_cfg
            # Effort: "low" / "medium" / "high". Lower = less thinking spend.
            # Only attached for models that support it — sending to Sonnet 4.5
            # or Haiku 4.5 returns 400.
            if CLAUDE_EFFORT and CLAUDE_MODEL in EFFORT_SUPPORTING_MODELS:
                stream_kwargs["output_config"] = {"effort": CLAUDE_EFFORT}

            async with client.messages.stream(**stream_kwargs) as stream:
                async for event in stream:
                    # Send input token usage as soon as we know it (from message_start)
                    if not meta_sent and event.type == "message_start":
                        u = event.message.usage
                        yield f"data: {json.dumps({'type': 'meta', 'inputTokens': u.input_tokens or 0, 'cacheReadTokens': u.cache_read_input_tokens or 0, 'cacheCreationTokens': u.cache_creation_input_tokens or 0})}\n\n"
                        meta_sent = True
                        continue

                    if event.type == "content_block_delta":
                        delta = event.delta
                        delta_type = getattr(delta, "type", None)
                        if delta_type == "text_delta":
                            text = delta.text
                            full_text += text
                            yield f"data: {json.dumps({'type': 'chunk', 'text': text})}\n\n"
                        elif delta_type == "thinking_delta":
                            thinking_chars += len(getattr(delta, "thinking", "") or "")
                            now = time.time()
                            if now - last_thinking_emit > 1.0:
                                yield f"data: {json.dumps({'type': 'thinking', 'chars': thinking_chars})}\n\n"
                                last_thinking_emit = now

                final = await stream.get_final_message()
                stop_reason = getattr(final, "stop_reason", None)
                u = final.usage
                input_tokens = u.input_tokens or 0
                output_tokens = u.output_tokens or 0
                cache_read = u.cache_read_input_tokens or 0
                cache_write = u.cache_creation_input_tokens or 0
                cost_usd = compute_cost(input_tokens, output_tokens, cache_read, cache_write)

                if full_text.strip():
                    save_claude_analysis(match_id, full_text)

                yield f"data: {json.dumps({'type': 'done', 'stopReason': stop_reason, 'fullText': full_text, 'usage': {'inputTokens': input_tokens, 'outputTokens': output_tokens, 'cacheReadTokens': cache_read, 'cacheCreationTokens': cache_write}, 'costUsd': round(cost_usd, 5)})}\n\n"
        except anthropic.APIError as e:
            err_msg = getattr(e, 'message', None) or str(e)
            yield f"data: {json.dumps({'type': 'error', 'message': f'Anthropic API: {err_msg}'})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': f'Backend: {type(e).__name__}: {e}'})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # disable nginx buffering if any
        },
    )


@app.get("/api/diag/claude-stream")
async def diag_claude_stream():
    """Streaming diagnostic — tiny prompt, but goes through the same SSE path
    as the real endpoint. Tests whether messages.stream() + StreamingResponse
    actually flushes chunks to the browser."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(500, "ANTHROPIC_API_KEY not set")

    client = anthropic.AsyncAnthropic(api_key=api_key)

    async def gen():
        yield ": connected\n\n"
        yield f"data: {json.dumps({'type': 'open', 'ts': time.time()})}\n\n"
        try:
            async with client.messages.stream(
                model="claude-sonnet-4-6",
                max_tokens=64,
                messages=[{"role": "user", "content": "Count from 1 to 10, one number per line, nothing else."}],
            ) as stream:
                async for text in stream.text_stream:
                    yield f"data: {json.dumps({'type': 'chunk', 'text': text, 'ts': time.time()})}\n\n"
                yield f"data: {json.dumps({'type': 'done', 'ts': time.time()})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': f'{type(e).__name__}: {e}'})}\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/diag/claude")
async def diag_claude():
    """Tiny diagnostic — calls Anthropic with a short prompt and reports timing.
    Use this to rule out 'is the API key valid and reachable?' issues."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return {"ok": False, "error": "ANTHROPIC_API_KEY not set"}
    try:
        client = anthropic.AsyncAnthropic(api_key=api_key)
        t0 = time.time()
        resp = await client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=20,
            messages=[{"role": "user", "content": "Reply with just the word: pong"}],
        )
        elapsed = time.time() - t0
        text = next((b.text for b in resp.content if b.type == "text"), "")
        return {
            "ok": True,
            "elapsed_seconds": round(elapsed, 2),
            "response_text": text.strip(),
            "model": resp.model,
            "configured_model": CLAUDE_MODEL,
            "configured_thinking": CLAUDE_THINKING,
        }
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}


@app.get("/api/picks")
def picks(sport: Optional[str] = None, limit: int = 200):
    if sport and sport not in SPORTS:
        raise HTTPException(400, f"Unknown sport: {sport}")
    return get_saved_picks(sport, limit)


@app.get("/api/health")
def health():
    t_cfg = thinking_config(CLAUDE_MODEL, THINKING_ON)
    rates = get_model_rates(CLAUDE_MODEL)
    # Worst-case estimate: max_tokens entirely as output. Realistic is much lower.
    est_max_output_cost = (CLAUDE_MAX_TOKENS * rates["output"]) / 1_000_000
    return {
        "status": "ok",
        "claude_configured": bool(os.environ.get("ANTHROPIC_API_KEY")),
        "model": CLAUDE_MODEL,
        "thinking_actual": t_cfg or "disabled",
        "effort": CLAUDE_EFFORT if CLAUDE_MODEL in EFFORT_SUPPORTING_MODELS else "(unsupported on this model)",
        "max_tokens": CLAUDE_MAX_TOKENS,
        "compact_brief": CLAUDE_COMPACT_BRIEF,
        "rates_per_1m": rates,
        "estimated_max_output_cost_usd": round(est_max_output_cost, 4),
    }
