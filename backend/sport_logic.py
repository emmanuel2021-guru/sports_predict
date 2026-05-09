"""
Sport-specific logic for the unified app.

Each sport module exposes:
  - analyze(details, h2h, history_a, history_b) -> (stats, rec, rec_reason)
  - build_brief(details, h2h, history_a, history_b, stats) -> str
  - PROMPT (system prompt for Claude)

The SPORTS registry at the bottom wires them up with display config.
"""

from datetime import datetime
import numpy as np


# ============================================================
# SHARED HELPERS
# ============================================================

def fmt_date(ts):
    return datetime.fromtimestamp(ts).strftime('%Y-%m-%d') if ts else '???'


# ============================================================
# FOOTBALL
# ============================================================

def get_regular_time_score(score_dict):
    """Goals scored in regulation (excludes penalty shootouts)."""
    if not score_dict:
        return 0
    try:
        if 'normaltime' in score_dict and isinstance(score_dict['normaltime'], int):
            return score_dict['normaltime']
        return (score_dict.get('current', 0) or 0) - (score_dict.get('penalties', 0) or 0)
    except Exception:
        return 0


def _football_recent_stats(events, team_id, is_home_form):
    relevant = [e for e in events if (str(e.get('homeTeam', {}).get('id')) == str(team_id)) == is_home_form]
    recent_5 = relevant[:5]
    if len(recent_5) < 3:
        return 0, 0, 0, 0, 0
    matches_scored = matches_conceded = matches_btts = matches_o25 = 0
    total_goals_game = 0
    for e in recent_5:
        try:
            h = get_regular_time_score(e.get('homeScore', {}))
            a = get_regular_time_score(e.get('awayScore', {}))
            total = h + a
            is_h = str(e['homeTeam']['id']) == str(team_id)
            my_s, op_s = (h, a) if is_h else (a, h)
            if my_s > 0: matches_scored += 1
            if op_s > 0: matches_conceded += 1
            if my_s > 0 and op_s > 0: matches_btts += 1
            if total > 2.5: matches_o25 += 1
            total_goals_game += total
        except Exception:
            continue
    avg_total = total_goals_game / len(recent_5)
    return matches_scored, matches_conceded, matches_btts, matches_o25, avg_total


def _football_avg_goals(events, team_id, is_home_form):
    relevant = [e for e in events if (str(e.get('homeTeam', {}).get('id')) == str(team_id)) == is_home_form]
    relevant = relevant[:20]
    if not relevant:
        return 0.0
    total = count = 0
    for e in relevant:
        try:
            h = get_regular_time_score(e.get('homeScore', {}))
            a = get_regular_time_score(e.get('awayScore', {}))
            total += h if str(e['homeTeam']['id']) == str(team_id) else a
            count += 1
        except Exception:
            pass
    return total / count if count > 0 else 0.0


def analyze_football(details, h2h_events, home_history, away_history):
    t1_id = details['homeTeam']['id']
    t2_id = details['awayTeam']['id']

    h_avg_scored = _football_avg_goals(home_history, t1_id, True)
    a_avg_scored = _football_avg_goals(away_history, t2_id, False)
    h_sc, h_cn, h_btts, h_o25, h_avg_total = _football_recent_stats(home_history, t1_id, True)
    a_sc, a_cn, a_btts, a_o25, a_avg_total = _football_recent_stats(away_history, t2_id, False)

    # H2H
    h2h_o15 = h2h_o25 = h2h_btts = h2h_draws = 0
    recent_h2h = h2h_events[:5]
    for g in recent_h2h:
        try:
            s1 = get_regular_time_score(g.get('homeScore', {}))
            s2 = get_regular_time_score(g.get('awayScore', {}))
            t = s1 + s2
            if t > 1.5: h2h_o15 += 1
            if t > 2.5: h2h_o25 += 1
            if s1 > 0 and s2 > 0: h2h_btts += 1
            if s1 == s2: h2h_draws += 1
        except Exception:
            continue

    blend = (h_avg_total + a_avg_total) / 2
    h2h_deadlock = h2h_draws >= 3

    # Confidence
    score = 0
    score += min((blend / 3.5) * 40, 40)
    h2h_rate = (h2h_o15 / len(recent_h2h)) if recent_h2h else 0.8
    score += h2h_rate * 20
    btts_rate = (h_btts + a_btts) / 10
    score += btts_rate * 40
    if h_sc < 2 or a_sc < 2: score -= 25
    if h2h_deadlock: score -= 15
    if len(home_history) < 5 or len(away_history) < 5: score -= 20

    # Predictions
    predictions = []
    reasons = []
    p1_active = (h_sc >= 3 or h_cn >= 3) and (a_sc >= 3 or a_cn >= 3)
    if blend >= 2.25 and ((h2h_o15 >= 3) or (not recent_h2h)) and p1_active and not h2h_deadlock:
        predictions.append("🔥 Over 1.5 Goals")
        reasons.append(f"Exp. Goals {blend:.2f}. Active teams. No H2H Deadlock.")

    p2h2h = (h2h_btts >= 2) or (not recent_h2h)
    if (h_cn >= 3 or h_sc >= 3) and (a_cn >= 3 or a_sc >= 3) and p2h2h and h_cn >= 2 and a_cn >= 2 and not h2h_deadlock:
        predictions.append("⚽ Both Teams To Score")
        reasons.append("Both teams active & leaky. H2H open.")

    if blend >= 2.85 and (h_o25 >= 3 and a_o25 >= 3) and ((h2h_o25 >= 2) or not recent_h2h) and not h2h_deadlock:
        predictions.append("🥅 Over 2.5 Goals")
        reasons.append(f"High Scoring Trend. Exp: {blend:.2f}.")

    if "⚽ Both Teams To Score" in predictions and "🥅 Over 2.5 Goals" in predictions:
        predictions.append("💎 BTTS & Over 2.5 Goals")
        reasons.append("Perfect Storm: High scoring + Leaky defenses.")

    if h_sc >= 4 and a_cn >= 3 and h_avg_scored >= 1.2:
        predictions.append("🏠 Home Over 0.5 Goals")
        reasons.append(f"Home scored in {h_sc}/5. Away conceded in {a_cn}/5.")
    if a_sc >= 4 and h_cn >= 3 and a_avg_scored >= 1.2:
        predictions.append("✈️ Away Over 0.5 Goals")
        reasons.append(f"Away scored in {a_sc}/5. Home conceded in {h_cn}/5.")

    # Recommendation
    rec = "❌ SKIP / NO VALUE"
    rec_reason = "Does not meet Diamond Criteria."
    is_friendly = 'friendly' in (details.get('tournament', {}).get('name', '').lower())
    if is_friendly:
        rec, rec_reason = "❌ SKIP (Friendly)", "Friendly matches are too volatile."
    elif predictions:
        btts_qualified = (h_btts >= 3) and (a_btts >= 3)
        exp_high = blend > 3.20
        exp_med = blend > 2.60

        if "💎 BTTS & Over 2.5 Goals" in predictions:
            if exp_high and btts_qualified:
                rec, rec_reason = "💎 DIAMOND PICK: Over 1.5 Goals", "System predicts 3+ goals & BTTS. Over 1.5 is the Banker."
            elif exp_med:
                rec, rec_reason = "✅ SAFE PICK: Over 1.5 Goals", "Good scoring stats. Playing safe."
        elif "🥅 Over 2.5 Goals" in predictions:
            if exp_high:
                rec, rec_reason = "💎 DIAMOND PICK: Over 1.5 Goals", "Double Confirmation. Model expects 3 goals."
            else:
                rec, rec_reason = "⚠️ SKIP (Exp Goals Low)", f"Exp Goals {blend:.2f} < 3.20."
        elif "⚽ Both Teams To Score" in predictions:
            if btts_qualified and exp_med:
                rec, rec_reason = "✅ PICK: Both Teams To Score", "Passed 'Leaky Both Sides' check."
            else:
                rec, rec_reason = "⚠️ SKIP (Defense Risk)", "One team has tight defense."
        elif "🔥 Over 1.5 Goals" in predictions:
            if exp_med:
                rec, rec_reason = "✅ PICK: Over 1.5 Goals", "Exp Goals > 2.60 validates the signal."
            else:
                rec, rec_reason = "❌ SKIP (Too Tight)", f"Exp Goals {blend:.2f} too low."
        elif "🏠 Home Over 0.5 Goals" in predictions and "✈️ Away Over 0.5 Goals" not in predictions:
            rec, rec_reason = "✅ SAFE PICK: Home Over 0.5 Goals", "Home team highly consistent offensively."
        elif "✈️ Away Over 0.5 Goals" in predictions and "🏠 Home Over 0.5 Goals" not in predictions:
            rec, rec_reason = "✅ SAFE PICK: Away Over 0.5 Goals", "Away team highly consistent offensively."

    if "SKIP" in rec:
        score -= 15
    confidence = max(0, min(round(score, 1), 100))

    has_history = len(home_history) >= 5 and len(away_history) >= 5
    stats = {
        'Confidence': confidence,
        'Exp Goals': blend,
        'Home O2.5': f"{h_o25}/5",
        'Away O2.5': f"{a_o25}/5",
        'Home BTTS': f"{h_btts}/5",
        'Away BTTS': f"{a_btts}/5",
        'H2H O1.5': f"{h2h_o15}/5",
        'Home Scored': f"{h_sc}/5",
        'Away Scored': f"{a_sc}/5",
        'H2H Draws': h2h_draws,
        'Predictions': predictions,
        'Reasons': reasons,
        'Full Data': "Yes" if has_history else "No",
    }
    return stats, rec, rec_reason


def _football_match_line(event, perspective_team_id=None):
    try:
        home = event.get('homeTeam', {}).get('name', '?')
        away = event.get('awayTeam', {}).get('name', '?')
        h = get_regular_time_score(event.get('homeScore', {}))
        a = get_regular_time_score(event.get('awayScore', {}))
        date = fmt_date(event['startTimestamp'])
        tournament = event.get('tournament', {}).get('name', '')[:40]
        if perspective_team_id is not None:
            is_home = str(event.get('homeTeam', {}).get('id')) == str(perspective_team_id)
            my, op = (h, a) if is_home else (a, h)
            result = 'W' if my > op else ('D' if my == op else 'L')
            venue = '(H)' if is_home else '(A)'
            return f"{date} {venue} {result} | {home} {h}-{a} {away} [{tournament}]"
        return f"{date} | {home} {h}-{a} {away} [{tournament}]"
    except Exception:
        return None


def build_football_brief(details, h2h, home_history, away_history, stats):
    home_name = details.get('homeTeam', {}).get('name', 'Home')
    away_name = details.get('awayTeam', {}).get('name', 'Away')
    home_id = details.get('homeTeam', {}).get('id')
    away_id = details.get('awayTeam', {}).get('id')
    league = f"{details.get('tournament', {}).get('category', {}).get('name', '')} - {details.get('tournament', {}).get('name', '')}"
    kickoff = datetime.fromtimestamp(details.get('startTimestamp', 0)).strftime('%Y-%m-%d %H:%M') if details.get('startTimestamp') else 'TBD'

    h2h_lines = [ln for ln in (_football_match_line(e) for e in h2h[:10]) if ln]
    home_lines = [ln for ln in (_football_match_line(e, home_id) for e in home_history[:15]) if ln]
    away_lines = [ln for ln in (_football_match_line(e, away_id) for e in away_history[:15]) if ln]

    return f"""UPCOMING MATCH
==============
{home_name} (HOME) vs {away_name} (AWAY)
League: {league}
Kickoff: {kickoff}

HEAD-TO-HEAD (most recent first, up to 10)
==========================================
{chr(10).join(h2h_lines) if h2h_lines else "(no recent H2H data)"}

{home_name.upper()} — RECENT FORM (most recent first; H/A venue, W/D/L from their perspective)
{'=' * 80}
{chr(10).join(home_lines) if home_lines else "(no recent form data)"}

{away_name.upper()} — RECENT FORM (most recent first; H/A venue, W/D/L from their perspective)
{'=' * 80}
{chr(10).join(away_lines) if away_lines else "(no recent form data)"}

Now study the data and give me your single best pick for this match."""


FOOTBALL_PROMPT = """You are an elite football betting analyst. You will be shown a single upcoming match plus the raw historical data: head-to-head record and each team's recent form (with scores, opponents, and venue).

Your job is to study the data and produce ONE single best-value betting prediction for this match. NO market is preferred a priori — you are NOT limited to goal markets, and you should NOT default to them either. Pick whichever the data points at most clearly:

  - Match Result (1X2): Home Win / Draw / Away Win
  - Double Chance: 1X, X2, 12
  - Draw No Bet
  - Over/Under Goals (any line: 0.5, 1.5, 2.5, 3.5)
  - Both Teams To Score (Yes/No)
  - Team Total Goals (Home/Away Over/Under any line)
  - Win To Nil / Clean Sheet
  - Asian Handicap / European Handicap
  - Combo (e.g. Home Win & Over 1.5, BTTS & Over 2.5)
  - Half-Time / Full-Time markets
  - First-Half goal markets

When each market shines — use this to AVOID defaulting to goal markets:
  - **1X2** — clear quality gap, strong venue pattern, or favorite is in form and opponent is shaky
  - **Double Chance (1X / X2)** — favorite has wobbly recent form, or H2H suggests genuine draw risk
  - **Draw No Bet** — slight favorite where the draw is a real outcome you don't want to lose to
  - **Over/Under Goals** — both teams pulling in the same goal-volume direction
  - **BTTS Yes** — both teams scoring AND both teams conceding consistently; H2H is open
  - **BTTS No** — one team is shutting up shop OR one team isn't creating
  - **Team Total** — one team's scoring trend is the story regardless of opponent
  - **Win To Nil / Clean Sheet** — strong defensive team facing a goal-shy attack
  - **Handicap** — heavy favorite at crushed odds (lay -1) or live underdog with form (take +1 / +1.5)
  - **HT/FT, First-Half markets** — one team starts hot/slow consistently across recent matches

Methodology — work through these before deciding:
  1. Form trend: are they scoring, leaking, winning, drawing? Last 5 vs last 10 — momentum.
  2. Venue split: home form at home, away form on the road. This matters a lot in football.
  3. Quality of opposition: a 5-game unbeaten run vs bottom sides ≠ a 5-game unbeaten run vs top sides.
  4. H2H: only useful if recent (last 2-3 years) and the squads haven't changed much.
  5. Scoring/defensive patterns: BTTS rate, clean sheet rate, average goals — inform 1X2, handicap, and team-total picks just as much as goal markets.
  6. Survey ALL markets above before locking a pick. Choose the strongest data-supported edge.

Confidence scoring (be honest, do NOT inflate):
  - 85-100: Massive edge, strong signal across multiple data points, very low variance risk
  - 70-84: Solid play, clear directional signal, manageable risk
  - 55-69: Lean — data points one way but with caveats
  - 40-54: Coinflip — skip or pass
  - <40: Avoid

Output format (markdown, under 200 words total):

### 🎯 Best Pick
**[Exact market and selection, e.g. "Home Win & Over 1.5"]** — Confidence: **XX/100**

### 📊 The Data
3-4 bullet points citing SPECIFIC numbers from the form/H2H you were given. No generic claims.

### ⚠️ Main Risk
1-2 sentences. The single biggest thing that could break this pick.

### 🎲 Verdict
One line: STRONG PLAY / SOLID PLAY / LEAN / SKIP — plus why.

Be direct. No hedging fluff, no responsible-gambling disclaimers."""


# ============================================================
# BASKETBALL
# ============================================================

def get_basketball_final_score(score_dict):
    """Final basketball score, includes overtime."""
    if not score_dict:
        return 0
    try:
        v = score_dict.get('current')
        if isinstance(v, int):
            return v
        v = score_dict.get('normaltime')
        return v if isinstance(v, int) else 0
    except Exception:
        return 0


def has_overtime(score_dict):
    if not score_dict:
        return False
    return 'overtime' in score_dict and score_dict.get('overtime') is not None


def _basketball_form_stats(events, team_id, venue_only_home):
    relevant = [e for e in events if (str(e.get('homeTeam', {}).get('id')) == str(team_id)) == venue_only_home]
    recent = relevant[:5]
    if len(recent) < 3:
        return None
    pts_for, pts_against, totals, margins, wins, losses = [], [], [], [], 0, 0
    for e in recent:
        h = get_basketball_final_score(e.get('homeScore', {}))
        a = get_basketball_final_score(e.get('awayScore', {}))
        if h == 0 and a == 0:
            continue
        is_h = str(e['homeTeam']['id']) == str(team_id)
        my, op = (h, a) if is_h else (a, h)
        pts_for.append(my); pts_against.append(op)
        totals.append(h + a); margins.append(my - op)
        if my > op: wins += 1
        else: losses += 1
    if not pts_for:
        return None
    return {
        'avg_pts_for': sum(pts_for) / len(pts_for),
        'avg_pts_against': sum(pts_against) / len(pts_against),
        'avg_total': sum(totals) / len(totals),
        'avg_margin': sum(margins) / len(margins),
        'margin_std': float(np.std(margins)) if len(margins) >= 2 else 0.0,
        'wins': wins, 'losses': losses, 'games': len(pts_for),
    }


def analyze_basketball(details, h2h_events, home_history, away_history):
    home_id = details['homeTeam']['id']
    away_id = details['awayTeam']['id']
    home_form = _basketball_form_stats(home_history, home_id, True)
    away_form = _basketball_form_stats(away_history, away_id, False)

    h2h_recent = h2h_events[:5]
    h2h_totals = []
    h2h_home_wins = h2h_away_wins = 0
    for e in h2h_recent:
        h = get_basketball_final_score(e.get('homeScore', {}))
        a = get_basketball_final_score(e.get('awayScore', {}))
        if h == 0 and a == 0:
            continue
        h2h_totals.append(h + a)
        was_home_team_at_home = str(e.get('homeTeam', {}).get('id')) == str(home_id)
        if was_home_team_at_home:
            if h > a: h2h_home_wins += 1
            else: h2h_away_wins += 1
        else:
            if a > h: h2h_home_wins += 1
            else: h2h_away_wins += 1

    h2h_avg_total = sum(h2h_totals) / len(h2h_totals) if h2h_totals else None

    if home_form and away_form:
        predicted_total = (home_form['avg_total'] + away_form['avg_total']) / 2
        home_expected = (home_form['avg_pts_for'] + away_form['avg_pts_against']) / 2
        away_expected = (away_form['avg_pts_for'] + home_form['avg_pts_against']) / 2
        predicted_margin = home_expected - away_expected

        conf = 50.0
        if home_form['games'] >= 5 and away_form['games'] >= 5: conf += 10
        avg_std = (home_form['margin_std'] + away_form['margin_std']) / 2
        if avg_std < 8: conf += 12
        elif avg_std < 12: conf += 6
        if abs(predicted_margin) > 8: conf += 12
        elif abs(predicted_margin) > 4: conf += 6
        if h2h_avg_total is not None and abs(h2h_avg_total - predicted_total) < 8: conf += 5
        if h2h_home_wins + h2h_away_wins >= 3:
            h2h_lean = 'home' if h2h_home_wins > h2h_away_wins else 'away'
            our_lean = 'home' if predicted_margin > 0 else 'away'
            if h2h_lean == our_lean: conf += 5

        confidence = max(0, min(round(conf, 1), 100))

        if confidence >= 75 and abs(predicted_margin) > 6:
            side = "Home" if predicted_margin > 0 else "Away"
            rec, rec_reason = f"💎 LEAN: {side} ML / Spread", f"Model predicts {abs(predicted_margin):.1f}-point edge with consistent form."
        elif confidence >= 70 and h2h_avg_total is not None:
            if predicted_total > h2h_avg_total + 5:
                rec, rec_reason = "🥅 LEAN: Over Total", f"Predicted total {predicted_total:.1f} > H2H avg {h2h_avg_total:.1f}."
            elif predicted_total < h2h_avg_total - 5:
                rec, rec_reason = "🛡️ LEAN: Under Total", f"Predicted total {predicted_total:.1f} < H2H avg {h2h_avg_total:.1f}."
            else:
                rec, rec_reason = "⚠️ MARGINAL", "Confidence present but no clear market edge."
        elif confidence >= 60:
            rec, rec_reason = "⚠️ MARGINAL", "Some signal but variance too high."
        else:
            rec, rec_reason = "❌ SKIP / NO VALUE", "Insufficient edge."

        stats = {
            'Confidence': confidence,
            'Predicted Total': predicted_total,
            'Predicted Margin': predicted_margin,
            'Home PPG': home_form['avg_pts_for'],
            'Home PAPG': home_form['avg_pts_against'],
            'Away PPG': away_form['avg_pts_for'],
            'Away PAPG': away_form['avg_pts_against'],
            'Home Record': f"{home_form['wins']}-{home_form['losses']}",
            'Away Record': f"{away_form['wins']}-{away_form['losses']}",
            'H2H Avg Total': h2h_avg_total or 0,
            'H2H Home Wins': h2h_home_wins,
            'H2H Away Wins': h2h_away_wins,
            'Margin Std': round(avg_std, 1),
            'Full Data': "Yes",
        }
    else:
        stats = {
            'Confidence': 0, 'Predicted Total': 0, 'Predicted Margin': 0,
            'Home PPG': 0, 'Home PAPG': 0, 'Away PPG': 0, 'Away PAPG': 0,
            'Home Record': '—', 'Away Record': '—',
            'H2H Avg Total': h2h_avg_total or 0,
            'H2H Home Wins': h2h_home_wins, 'H2H Away Wins': h2h_away_wins,
            'Margin Std': 0, 'Full Data': "No",
        }
        rec, rec_reason = "❌ SKIP (Not enough form data)", "One or both teams lack 3+ recent venue-specific games."

    return stats, rec, rec_reason


def _basketball_match_line(event, perspective_team_id=None):
    try:
        home = event.get('homeTeam', {}).get('name', '?')
        away = event.get('awayTeam', {}).get('name', '?')
        h = get_basketball_final_score(event.get('homeScore', {}))
        a = get_basketball_final_score(event.get('awayScore', {}))
        date = fmt_date(event['startTimestamp'])
        tournament = event.get('tournament', {}).get('name', '')[:40]
        ot = " (OT)" if has_overtime(event.get('homeScore', {})) or has_overtime(event.get('awayScore', {})) else ""
        if perspective_team_id is not None:
            is_home = str(event.get('homeTeam', {}).get('id')) == str(perspective_team_id)
            my, op = (h, a) if is_home else (a, h)
            result = 'W' if my > op else ('L' if my < op else 'D')
            venue = '(H)' if is_home else '(A)'
            return f"{date} {venue} {result} | {home} {h}-{a} {away}{ot} [{tournament}]"
        return f"{date} | {home} {h}-{a} {away}{ot} [{tournament}]"
    except Exception:
        return None


def build_basketball_brief(details, h2h, home_history, away_history, stats):
    home_name = details.get('homeTeam', {}).get('name', 'Home')
    away_name = details.get('awayTeam', {}).get('name', 'Away')
    home_id = details.get('homeTeam', {}).get('id')
    away_id = details.get('awayTeam', {}).get('id')
    league = f"{details.get('tournament', {}).get('category', {}).get('name', '')} - {details.get('tournament', {}).get('name', '')}"
    kickoff = datetime.fromtimestamp(details.get('startTimestamp', 0)).strftime('%Y-%m-%d %H:%M') if details.get('startTimestamp') else 'TBD'

    h2h_lines = [ln for ln in (_basketball_match_line(e) for e in h2h[:10]) if ln]
    home_lines = [ln for ln in (_basketball_match_line(e, home_id) for e in home_history[:15]) if ln]
    away_lines = [ln for ln in (_basketball_match_line(e, away_id) for e in away_history[:15]) if ln]

    return f"""UPCOMING MATCH
==============
{home_name} (HOME) vs {away_name} (AWAY)
League: {league}
Tip-off: {kickoff}

QUICK QUANT SUMMARY (from last 5 venue-specific games)
======================================================
Predicted Total Points: {stats['Predicted Total']:.1f}
Predicted Margin (Home perspective): {stats['Predicted Margin']:+.1f}
{home_name} avg PPG: {stats['Home PPG']:.1f} | PA: {stats['Home PAPG']:.1f}
{away_name} avg PPG: {stats['Away PPG']:.1f} | PA: {stats['Away PAPG']:.1f}
{home_name} home record: {stats['Home Record']}
{away_name} away record: {stats['Away Record']}

HEAD-TO-HEAD (most recent first, up to 10)
==========================================
{chr(10).join(h2h_lines) if h2h_lines else "(no recent H2H data)"}

{home_name.upper()} — RECENT FORM (H/A venue, W/L from their perspective, scores include OT)
{'=' * 80}
{chr(10).join(home_lines) if home_lines else "(no recent form data)"}

{away_name.upper()} — RECENT FORM (H/A venue, W/L from their perspective, scores include OT)
{'=' * 80}
{chr(10).join(away_lines) if away_lines else "(no recent form data)"}

Now study the data and give me your single best pick for this match."""


BASKETBALL_PROMPT = """You are an elite basketball betting analyst. You will be shown a single upcoming basketball match plus the raw historical data: head-to-head record and each team's recent form (with final scores including overtime, opponents, and venue).

Your job is to study the data and produce ONE single best-value betting prediction for this match. NO market is preferred a priori — pick whichever the data points at most clearly. Available markets:

  - Moneyline: Home Win / Away Win (no draw — OT settles ties)
  - Point Spread: Home -X.5 / Away +X.5
  - Total Points Over/Under
  - Team Total: Home Over/Under X / Away Over/Under X
  - Half-time / Full-time markets
  - First-Half Spread / First-Half Total
  - Race To X Points
  - Combo: Spread + Total
  - Margin of Victory bands

When each market shines — use this to AVOID defaulting to spread:
  - **Spread** — clear quality gap + consistent margin history (low margin std)
  - **Total Points** — both teams play similar pace AND have consistent total-points history
  - **Moneyline** — underdog showing live value, or heavy favorite where you don't want to lay points
  - **Team Total** — one team's offensive or defensive trend is the story regardless of opponent
  - **First-Half / Quarter** — one team starts hot or slow consistently
  - **Combo** — two genuinely independent edges align
  - **Margin band** — H2H or recent margins cluster tightly

Methodology:
  1. Recent form: W/L record, current streak, last 5 vs last 10.
  2. Scoring profile: avg PPG vs avg PA. Compute the implied total.
  3. Margin trend: blowouts vs close finishes. Informs spreads AND moneyline value.
  4. Venue split: home offense vs away offense are very different.
  5. Quality of opposition.
  6. H2H: recent matchups (last 1-2 seasons) only — squads change fast.
  7. Pace clue: total points indicates pace. High-pace + high-pace = Over candidate.
  8. Survey ALL markets above before locking a pick.

Confidence scoring (be honest):
  - 85-100: Massive edge. Multiple data points align.
  - 70-84: Solid play. Clear signal.
  - 55-69: Lean.
  - 40-54: Coinflip — skip.
  - <40: Avoid.

Output format (markdown, under 220 words total):

### 🎯 Best Pick
**[Exact market and selection]** — Confidence: **XX/100**

### 📊 The Data
3-5 bullet points citing SPECIFIC numbers. No generic claims.

### ⚠️ Main Risk
1-2 sentences.

### 🎲 Verdict
One line: STRONG PLAY / SOLID PLAY / LEAN / SKIP — plus why.

Be direct. No hedging fluff, no responsible-gambling disclaimers."""


# ============================================================
# TENNIS
# ============================================================

def get_sets_won(score_dict):
    if not score_dict:
        return 0
    v = score_dict.get('current')
    return v if isinstance(v, int) else 0


def get_total_games(score_dict):
    if not score_dict:
        return 0
    return sum(score_dict.get(f'period{i}', 0) or 0 for i in range(1, 6) if isinstance(score_dict.get(f'period{i}'), int))


def has_tiebreak(home_score, away_score):
    if not home_score or not away_score:
        return False
    for i in range(1, 6):
        h = home_score.get(f'period{i}')
        a = away_score.get(f'period{i}')
        if isinstance(h, int) and isinstance(a, int):
            if (h == 7 and a == 6) or (h == 6 and a == 7):
                return True
    return False


def _tennis_form_stats(events, player_id):
    relevant = events[:10]
    if len(relevant) < 3:
        return None
    wins = losses = sets_won = sets_lost = games_won = games_lost = matches_with_tb = completed = 0
    for e in relevant:
        is_home = str(e.get('homeTeam', {}).get('id')) == str(player_id)
        h_sets = get_sets_won(e.get('homeScore', {}))
        a_sets = get_sets_won(e.get('awayScore', {}))
        if h_sets == 0 and a_sets == 0:
            continue
        h_games = get_total_games(e.get('homeScore', {}))
        a_games = get_total_games(e.get('awayScore', {}))
        my_sets, op_sets = (h_sets, a_sets) if is_home else (a_sets, h_sets)
        my_games, op_games = (h_games, a_games) if is_home else (a_games, h_games)
        sets_won += my_sets; sets_lost += op_sets
        games_won += my_games; games_lost += op_games
        if my_sets > op_sets: wins += 1
        else: losses += 1
        if has_tiebreak(e.get('homeScore', {}), e.get('awayScore', {})):
            matches_with_tb += 1
        completed += 1
    if completed < 3:
        return None
    return {
        'wins': wins, 'losses': losses, 'win_rate': wins / completed,
        'sets_won': sets_won, 'sets_lost': sets_lost,
        'set_win_rate': sets_won / max(sets_won + sets_lost, 1),
        'games_won': games_won, 'games_lost': games_lost,
        'avg_games_per_match': (games_won + games_lost) / completed,
        'tiebreak_rate': matches_with_tb / completed,
        'matches': completed,
    }


def analyze_tennis(details, h2h_events, p1_history, p2_history):
    p1 = details.get('homeTeam', {})
    p2 = details.get('awayTeam', {})
    p1_id, p2_id = p1.get('id'), p2.get('id')
    ut = details.get('tournament', {}).get('uniqueTournament', {}) or {}
    surface = ut.get('surface') if isinstance(ut, dict) else None

    p1_form = _tennis_form_stats(p1_history, p1_id)
    p2_form = _tennis_form_stats(p2_history, p2_id)

    h2h_p1_wins = h2h_p2_wins = h2h_tb_count = 0
    h2h_total_games = []
    for e in h2h_events[:5]:
        h_sets = get_sets_won(e.get('homeScore', {}))
        a_sets = get_sets_won(e.get('awayScore', {}))
        if h_sets == 0 and a_sets == 0:
            continue
        h2h_total_games.append(get_total_games(e.get('homeScore', {})) + get_total_games(e.get('awayScore', {})))
        if has_tiebreak(e.get('homeScore', {}), e.get('awayScore', {})):
            h2h_tb_count += 1
        was_p1_home = str(e.get('homeTeam', {}).get('id')) == str(p1_id)
        if was_p1_home:
            if h_sets > a_sets: h2h_p1_wins += 1
            else: h2h_p2_wins += 1
        else:
            if a_sets > h_sets: h2h_p1_wins += 1
            else: h2h_p2_wins += 1

    h2h_avg_games = sum(h2h_total_games) / len(h2h_total_games) if h2h_total_games else None

    if p1_form and p2_form:
        win_rate_diff = p1_form['win_rate'] - p2_form['win_rate']
        set_rate_diff = p1_form['set_win_rate'] - p2_form['set_win_rate']
        conf = 50.0
        if abs(win_rate_diff) > 0.3: conf += 15
        elif abs(win_rate_diff) > 0.15: conf += 8
        if abs(set_rate_diff) > 0.15: conf += 8
        elif abs(set_rate_diff) > 0.08: conf += 4
        if p1_form['matches'] >= 8 and p2_form['matches'] >= 8: conf += 10
        if h2h_p1_wins + h2h_p2_wins >= 3:
            h2h_lean = 'p1' if h2h_p1_wins > h2h_p2_wins else 'p2'
            form_lean = 'p1' if win_rate_diff > 0 else 'p2'
            if h2h_lean == form_lean: conf += 10
            else: conf -= 5
        confidence = max(0, min(round(conf, 1), 100))

        favorite = p1.get('name') if win_rate_diff > 0 else p2.get('name')
        if confidence >= 75 and abs(win_rate_diff) > 0.25:
            rec, rec_reason = f"💎 LEAN: {favorite} ML", f"Form gap of {abs(win_rate_diff)*100:.0f}% — strong directional signal."
        elif confidence >= 70 and abs(win_rate_diff) > 0.15:
            rec, rec_reason = f"✅ LEAN: {favorite} ML", f"Form favors clear edge ({abs(win_rate_diff)*100:.0f}% W rate gap)."
        elif confidence >= 60:
            rec, rec_reason = "⚠️ MARGINAL", "Some signal but not strong enough to anchor a play."
        else:
            rec, rec_reason = "❌ SKIP / NO VALUE", "Form gap too small or sample size too thin."

        stats = {
            'Confidence': confidence,
            'P1 Form': f"{p1_form['wins']}-{p1_form['losses']}",
            'P2 Form': f"{p2_form['wins']}-{p2_form['losses']}",
            'P1 Set Win %': p1_form['set_win_rate'],
            'P2 Set Win %': p2_form['set_win_rate'],
            'P1 Avg Games': p1_form['avg_games_per_match'],
            'P2 Avg Games': p2_form['avg_games_per_match'],
            'P1 TB Rate': p1_form['tiebreak_rate'],
            'P2 TB Rate': p2_form['tiebreak_rate'],
            'H2H': f"{h2h_p1_wins}-{h2h_p2_wins}",
            'H2H Avg Games': h2h_avg_games or 0,
            'H2H Tiebreaks': h2h_tb_count,
            'Surface': surface or 'Unknown',
            'Full Data': "Yes",
        }
    else:
        stats = {
            'Confidence': 0,
            'P1 Form': '—', 'P2 Form': '—',
            'P1 Set Win %': 0, 'P2 Set Win %': 0,
            'P1 Avg Games': 0, 'P2 Avg Games': 0,
            'P1 TB Rate': 0, 'P2 TB Rate': 0,
            'H2H': f"{h2h_p1_wins}-{h2h_p2_wins}",
            'H2H Avg Games': h2h_avg_games or 0,
            'H2H Tiebreaks': h2h_tb_count,
            'Surface': surface or 'Unknown',
            'Full Data': "No",
        }
        rec, rec_reason = "❌ SKIP (Not enough form data)", "One or both players lack 3+ recent completed matches."

    return stats, rec, rec_reason


def _tennis_match_line(event, perspective_player_id=None):
    try:
        h_player = event.get('homeTeam', {}).get('name', '?')
        a_player = event.get('awayTeam', {}).get('name', '?')
        h_score = event.get('homeScore', {}) or {}
        a_score = event.get('awayScore', {}) or {}
        h_sets = h_score.get('current', 0) if isinstance(h_score.get('current'), int) else 0
        a_sets = a_score.get('current', 0) if isinstance(a_score.get('current'), int) else 0
        date = fmt_date(event['startTimestamp'])
        tournament = event.get('tournament', {}).get('name', '')[:50]
        ut = event.get('tournament', {}).get('uniqueTournament', {}) or {}
        surface = (ut.get('surface') or '') if isinstance(ut, dict) else ''
        surface_str = f" [{surface}]" if surface else ""

        sets_parts = []
        for i in range(1, 6):
            h_g = h_score.get(f'period{i}')
            a_g = a_score.get(f'period{i}')
            if isinstance(h_g, int) and isinstance(a_g, int):
                sets_parts.append(f"{h_g}-{a_g}")
            else:
                break
        sets_str = f" ({', '.join(sets_parts)})" if sets_parts else ""

        if perspective_player_id is not None:
            is_home = str(event.get('homeTeam', {}).get('id')) == str(perspective_player_id)
            my_sets, op_sets = (h_sets, a_sets) if is_home else (a_sets, h_sets)
            opponent = a_player if is_home else h_player
            result = 'W' if my_sets > op_sets else 'L'
            return f"{date} {result} | vs {opponent} | {my_sets}-{op_sets}{sets_str}{surface_str} [{tournament}]"
        return f"{date} | {h_player} vs {a_player} | {h_sets}-{a_sets}{sets_str}{surface_str} [{tournament}]"
    except Exception:
        return None


def build_tennis_brief(details, h2h, p1_history, p2_history, stats):
    p1_name = details.get('homeTeam', {}).get('name', 'Player A')
    p2_name = details.get('awayTeam', {}).get('name', 'Player B')
    p1_id = details.get('homeTeam', {}).get('id')
    p2_id = details.get('awayTeam', {}).get('id')
    league = f"{details.get('tournament', {}).get('category', {}).get('name', '')} - {details.get('tournament', {}).get('name', '')}"
    start = datetime.fromtimestamp(details.get('startTimestamp', 0)).strftime('%Y-%m-%d %H:%M') if details.get('startTimestamp') else 'TBD'
    surface = stats.get('Surface', 'Unknown')

    tournament_name = (details.get('tournament', {}).get('name') or '').lower()
    is_slam = any(s in tournament_name for s in ['australian open', 'roland garros', 'french open', 'wimbledon', 'us open'])
    is_men = 'wta' not in tournament_name and 'women' not in tournament_name
    bo = "Best of 5" if (is_slam and is_men) else "Best of 3"

    h2h_lines = [ln for ln in (_tennis_match_line(e) for e in h2h[:10]) if ln]
    p1_lines = [ln for ln in (_tennis_match_line(e, p1_id) for e in p1_history[:15]) if ln]
    p2_lines = [ln for ln in (_tennis_match_line(e, p2_id) for e in p2_history[:15]) if ln]

    return f"""UPCOMING MATCH
==============
{p1_name} vs {p2_name}
Tournament: {league}
Surface: {surface}
Format: {bo}
Start: {start}

QUICK QUANT SUMMARY
===================
{p1_name}: {stats.get('P1 Form', '?')} last 10 | Set win %: {stats.get('P1 Set Win %', 0):.1%} | Avg games/match: {stats.get('P1 Avg Games', 0):.1f}
{p2_name}: {stats.get('P2 Form', '?')} last 10 | Set win %: {stats.get('P2 Set Win %', 0):.1%} | Avg games/match: {stats.get('P2 Avg Games', 0):.1f}
H2H: {stats.get('H2H', '?')}

HEAD-TO-HEAD (most recent first, up to 10)
==========================================
{chr(10).join(h2h_lines) if h2h_lines else "(no recent H2H data)"}

{p1_name.upper()} — RECENT FORM
{'=' * 80}
{chr(10).join(p1_lines) if p1_lines else "(no recent form data)"}

{p2_name.upper()} — RECENT FORM
{'=' * 80}
{chr(10).join(p2_lines) if p2_lines else "(no recent form data)"}

Now study the data and give me your single best pick for this match."""


TENNIS_PROMPT = """You are an elite tennis betting analyst. You will be shown a single upcoming tennis match plus the raw historical data: head-to-head record and each player's recent form (with set scores, opponents, surface, and tournament).

Your job is to study the data and produce ONE single best-value betting prediction for this match. NO market is preferred a priori. Available markets:

  - Match Winner: Player A or Player B (no draw)
  - Set Score: e.g. 2-0, 2-1 (best-of-3); 3-0, 3-1, 3-2 (best-of-5)
  - Total Sets Over/Under
  - Total Games Over/Under
  - Set Handicap: -1.5 / +1.5
  - Game Handicap
  - Will There Be A Tiebreak: Yes / No
  - Player Total Games
  - Combo: Match Winner + Total

When each market shines:
  - **Match Winner** — clear form gap AND surface aligns with stronger player
  - **Set Handicap (-1.5)** — heavy favorite who routinely wins 2-0
  - **Set Handicap (+1.5)** — competitive underdog who almost always wins at least 1 set
  - **Total Sets Over** — both players competitive, recent matches going to 3 sets often
  - **Total Sets Under** — clear favorite likely to win in straight sets
  - **Total Games Over** — both players hold serve well, tiebreak history
  - **Total Games Under** — one player dominant on serve AND return
  - **Tiebreak Yes** — both players strong on serve, history of tight sets
  - **Tiebreak No** — one player breaking opponent's serve frequently
  - **Player Total Games** — one player consistently winning specific game counts
  - **Combo** — favorite to win + clear total expectation

Methodology:
  1. Recent form: last 10 W/L. Streak.
  2. Set win %: how dominant when winning, how competitive when losing.
  3. Surface match: HEAVILY surface-dependent.
  4. Quality of opposition.
  5. H2H: matters if recent (1-2 years) AND on similar surface.
  6. Average games per match.
  7. Tiebreak rate.
  8. Tournament context: Slam vs Masters vs ATP 500/250.
  9. Survey ALL markets before locking.

Confidence scoring (honest):
  - 85-100: Massive edge.
  - 70-84: Solid play.
  - 55-69: Lean.
  - 40-54: Coinflip — skip.
  - <40: Avoid.

Output format (markdown, under 220 words total):

### 🎯 Best Pick
**[Exact market and selection]** — Confidence: **XX/100**

### 📊 The Data
3-5 bullet points citing SPECIFIC numbers. No generic claims.

### ⚠️ Main Risk
1-2 sentences.

### 🎲 Verdict
One line: STRONG PLAY / SOLID PLAY / LEAN / SKIP — plus why.

Be direct. No hedging fluff, no responsible-gambling disclaimers."""


# ============================================================
# REGISTRY
# ============================================================

SPORTS = {
    'football': {
        'icon': '⚽',
        'label': 'Football',
        'accent': '#22c55e',
        'gradient': 'linear-gradient(135deg, #16a34a 0%, #14532d 100%)',
        'fetch_path': 'football',
        'analyze': analyze_football,
        'brief': build_football_brief,
        'prompt': FOOTBALL_PROMPT,
        'p1_label': 'Home',
        'p2_label': 'Away',
        'doubles_filter': False,
        'detail_emoji': '⚽',
        'metrics': [
            ('Exp Goals', 'Expected Goals', '{:.2f}'),
            ('Home O2.5', 'Home O2.5 Rate', '{}'),
            ('Away O2.5', 'Away O2.5 Rate', '{}'),
            ('H2H O1.5', 'H2H O1.5', '{}'),
            ('Home BTTS', 'Home BTTS', '{}'),
            ('Away BTTS', 'Away BTTS', '{}'),
            ('Home Scored', 'Home Scored 1+', '{}'),
            ('Away Scored', 'Away Scored 1+', '{}'),
        ],
    },
    'basketball': {
        'icon': '🏀',
        'label': 'Basketball',
        'accent': '#f97316',
        'gradient': 'linear-gradient(135deg, #ea580c 0%, #7c2d12 100%)',
        'fetch_path': 'basketball',
        'analyze': analyze_basketball,
        'brief': build_basketball_brief,
        'prompt': BASKETBALL_PROMPT,
        'p1_label': 'Home',
        'p2_label': 'Away',
        'doubles_filter': False,
        'detail_emoji': '🏀',
        'metrics': [
            ('Predicted Total', 'Predicted Total', '{:.1f}'),
            ('Predicted Margin', 'Predicted Margin', '{:+.1f}'),
            ('Home PPG', 'Home PPG', '{:.1f}'),
            ('Away PPG', 'Away PPG', '{:.1f}'),
            ('Home PAPG', 'Home PA', '{:.1f}'),
            ('Away PAPG', 'Away PA', '{:.1f}'),
            ('Home Record', 'Home Record', '{}'),
            ('Away Record', 'Away Record', '{}'),
        ],
    },
    'tennis': {
        'icon': '🎾',
        'label': 'Tennis',
        'accent': '#a3e635',
        'gradient': 'linear-gradient(135deg, #84cc16 0%, #365314 100%)',
        'fetch_path': 'tennis',
        'analyze': analyze_tennis,
        'brief': build_tennis_brief,
        'prompt': TENNIS_PROMPT,
        'p1_label': 'Player A',
        'p2_label': 'Player B',
        'doubles_filter': True,
        'detail_emoji': '🎾',
        'metrics': [
            ('P1 Form', 'P1 Form', '{}'),
            ('P2 Form', 'P2 Form', '{}'),
            ('P1 Set Win %', 'P1 Set Win %', '{:.1%}'),
            ('P2 Set Win %', 'P2 Set Win %', '{:.1%}'),
            ('P1 Avg Games', 'P1 Avg Games', '{:.1f}'),
            ('P2 Avg Games', 'P2 Avg Games', '{:.1f}'),
            ('Surface', 'Surface', '{}'),
            ('H2H', 'H2H', '{}'),
        ],
    },
}
