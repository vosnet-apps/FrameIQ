// Achievement engine: season awards and career milestones, derived from match data.
//
// Two kinds of achievement, both described by plain definition objects:
//   season - decided once per season (e.g. Player of the Season). Repeatable, so a player
//            can hold the same badge several times. Snapshotted when the admin publishes
//            a season's awards (see the season_awards table).
//   career - reached once, ever, by crossing a threshold on a career total (e.g. 100th
//            win). Worked out live from the data, never stored.
//
// The engine takes its definitions and per-definition overrides as arguments, so a
// different edition can add definitions, retune thresholds or switch awards off without
// touching the evaluation code:
//
//   createAchievementEngine({ definitions: [...DEFAULT_DEFINITIONS, myDefinition],
//                             overrides: { iron_man: { enabled: false },
//                                          century_club: { threshold: 150 } } })
//
// A season definition supplies evaluate(ctx, seasonId, params) -> [{ player_id, name, value }].
// A career definition supplies a metric ('frames_won' | 'appearances' for players,
// 'team_wins' | 'team_played' for the team) and a threshold.
// Definitions with subject: 'team' belong to the team rather than a player: their rows have
// player_id and name set to null.

const MIN_APPEARANCES = 3;

// Every row tied for best under the comparator (a > 0 means a ranks above b).
function topRows(rows, compare) {
  if (!rows.length) return [];
  const sorted = [...rows].sort(compare);
  return sorted.filter((r) => compare(sorted[0], r) === 0);
}

const asWinner = (r, value) => ({ player_id: r.player_id, name: r.name, value });

const SEASON_DEFINITIONS = [
  {
    id: 'player_of_season', kind: 'season', group: 'award', icon: '🏆', title: 'Player of the Season',
    description: 'Most points in the season.',
    evaluate(ctx, seasonId) {
      const rows = ctx.playerSeasons(seasonId).filter((r) => r.total_points > 0);
      const byPoints = (a, b) => b.total_points - a.total_points || b.singles_won - a.singles_won || (b.frame_win_pct || 0) - (a.frame_win_pct || 0);
      return topRows(rows, byPoints).map((r) => asWinner(r, `${r.total_points} points`));
    },
  },
  {
    id: 'sharpshooter', kind: 'season', group: 'award', icon: '🎯', title: 'Sharpshooter',
    description: 'Best frame win % in the season.',
    params: { minAppearances: MIN_APPEARANCES },
    evaluate(ctx, seasonId, p) {
      const rows = ctx.playerSeasons(seasonId).filter((r) => r.appearances >= p.minAppearances && r.frame_win_pct != null);
      return topRows(rows, (a, b) => b.frame_win_pct - a.frame_win_pct).map((r) => asWinner(r, `${(r.frame_win_pct * 100).toFixed(1)}%`));
    },
  },
  {
    id: 'singles_specialist', kind: 'season', group: 'award', icon: '🎱', title: 'Singles Specialist',
    description: 'Most singles wins in the season.',
    evaluate(ctx, seasonId) {
      const rows = ctx.playerSeasons(seasonId).filter((r) => r.singles_won > 0);
      return topRows(rows, (a, b) => b.singles_won - a.singles_won).map((r) => asWinner(r, `${r.singles_won} won`));
    },
  },
  {
    id: 'doubles_ace', kind: 'season', group: 'award', icon: '🤝', title: 'Doubles Ace',
    description: 'Most doubles wins in the season.',
    evaluate(ctx, seasonId) {
      const rows = ctx.playerSeasons(seasonId).filter((r) => r.doubles_won > 0);
      return topRows(rows, (a, b) => b.doubles_won - a.doubles_won).map((r) => asWinner(r, `${r.doubles_won} won`));
    },
  },
  {
    id: 'most_improved', kind: 'season', group: 'award', icon: '📈', title: 'Most Improved',
    description: 'Biggest rise in points per game on the previous season.',
    params: { minAppearances: MIN_APPEARANCES },
    evaluate(ctx, seasonId, p) {
      const season = ctx.seasonById.get(seasonId);
      const improved = [];
      for (const cur of ctx.playerSeasons(seasonId)) {
        if (cur.appearances < p.minAppearances) continue;
        const prev = ctx.seasonRows
          .filter((r) => r.player_id === cur.player_id && ctx.seasonById.get(r.season_id).sort_order < season.sort_order && r.appearances >= p.minAppearances)
          .sort((a, b) => ctx.seasonById.get(b.season_id).sort_order - ctx.seasonById.get(a.season_id).sort_order)[0];
        if (!prev) continue;
        const before = prev.total_points / prev.appearances;
        const after = cur.total_points / cur.appearances;
        if (after > before) improved.push({ ...cur, delta: after - before, before, after });
      }
      return topRows(improved, (a, b) => b.delta - a.delta)
        .map((r) => asWinner(r, `+${r.delta.toFixed(2)} (${r.before.toFixed(2)} → ${r.after.toFixed(2)})`));
    },
  },
  {
    id: 'hot_streak', kind: 'season', group: 'award', icon: '🔥', title: 'Hot Streak',
    description: 'Longest run of winning weeks in the season.',
    params: { minStreak: 2 },
    evaluate(ctx, seasonId, p) {
      // A winning week is more frames won than lost - the same rule as the Form column.
      const streaks = new Map();
      for (const r of ctx.weekRows.filter((w) => w.season_id === seasonId)) {
        const s = streaks.get(r.player_id) || { player_id: r.player_id, name: r.name, run: 0, best: 0 };
        s.run = r.singles_won + r.doubles_won > r.singles_lost + r.doubles_lost ? s.run + 1 : 0;
        s.best = Math.max(s.best, s.run);
        streaks.set(r.player_id, s);
      }
      return topRows([...streaks.values()].filter((s) => s.best >= p.minStreak), (a, b) => b.best - a.best)
        .map((s) => asWinner(s, `${s.best} weeks in a row`));
    },
  },
  {
    id: 'iron_man', kind: 'season', group: 'feat', icon: '🛡️', title: 'Iron Man',
    description: 'Played every match of the season.',
    params: { minWeeks: 3 },
    evaluate(ctx, seasonId, p) {
      const total = ctx.playedWeeks(seasonId);
      if (total < p.minWeeks) return [];
      const played = new Map();
      for (const r of ctx.weekRows.filter((w) => w.season_id === seasonId)) played.set(r.player_id, (played.get(r.player_id) || 0) + 1);
      return ctx.playerSeasons(seasonId)
        .filter((r) => (played.get(r.player_id) || 0) >= total)
        .map((r) => asWinner(r, `${total} of ${total} matches`));
    },
  },
  {
    id: 'perfect_season', kind: 'season', group: 'feat', icon: '💎', title: 'Perfect Season',
    description: 'Finished the season without losing a frame.',
    params: { minAppearances: MIN_APPEARANCES },
    evaluate(ctx, seasonId, p) {
      // Needs every result recorded: a season imported without losses can't be shown to be perfect.
      return ctx.playerSeasons(seasonId)
        .filter((r) => r.appearances >= p.minAppearances && r.unknown_rows === 0 && r.frames_known > 0 && r.frames_known === r.frames_won_known)
        .map((r) => asWinner(r, `${r.frames_won_known} frames won, none lost`));
    },
  },
];

const teamWin = (m) => m.score_for > m.score_against;
const teamLoss = (m) => m.score_for < m.score_against;

const TEAM_SEASON_DEFINITIONS = [
  {
    id: 'unbeaten_season', kind: 'season', subject: 'team', group: 'team', icon: '🛡️', title: 'Unbeaten Season',
    description: 'Finished the season without losing a match.',
    params: { minMatches: 5 },
    evaluate(ctx, seasonId, p) {
      const ms = ctx.teamMatches(seasonId);
      if (ms.length < p.minMatches || ms.some(teamLoss)) return [];
      const wins = ms.filter(teamWin).length;
      return [{ player_id: null, name: null, value: `${wins} wins from ${ms.length} matches` }];
    },
  },
  {
    id: 'winning_run', kind: 'season', subject: 'team', group: 'team', icon: '⚡', title: 'Longest Winning Run',
    description: "The team's longest run of consecutive match wins.",
    params: { minRun: 3 },
    evaluate(ctx, seasonId, p) {
      let run = 0;
      let best = 0;
      for (const m of ctx.teamMatches(seasonId)) {
        run = teamWin(m) ? run + 1 : 0;
        best = Math.max(best, run);
      }
      return best >= p.minRun ? [{ player_id: null, name: null, value: `${best} matches in a row` }] : [];
    },
  },
  {
    id: 'whitewash', kind: 'season', subject: 'team', group: 'team', icon: '🧹', title: 'Whitewash',
    description: 'Won a match without conceding a frame.',
    evaluate(ctx, seasonId) {
      return ctx.teamMatches(seasonId)
        .filter((m) => teamWin(m) && m.score_against === 0)
        .map((m) => ({ player_id: null, name: null, value: `Week ${m.week_number}${m.opponent ? ' v ' + m.opponent : ''}, ${m.score_for}-0` }));
    },
  },
  {
    id: 'record_season', kind: 'season', subject: 'team', group: 'team', icon: '📊', title: 'Record Season',
    description: 'Beat every earlier season on win rate or league points.',
    params: { minMatches: 5 },
    evaluate(ctx, seasonId, p) {
      const cur = ctx.teamSummary(seasonId);
      if (cur.decided < p.minMatches) return [];
      const season = ctx.seasonById.get(seasonId);
      const earlier = ctx.seasons
        .filter((s) => s.sort_order < season.sort_order)
        .map((s) => ctx.teamSummary(s.id))
        .filter((s) => s.decided >= p.minMatches);
      if (!earlier.length) return [];
      const notes = [];
      if (earlier.every((s) => cur.win_rate > s.win_rate)) notes.push(`best win rate (${Math.round(cur.win_rate * 100)}%)`);
      if (earlier.every((s) => cur.league_points > s.league_points)) notes.push(`most league points (${cur.league_points})`);
      return notes.length ? [{ player_id: null, name: null, value: notes.join(', ') }] : [];
    },
  },
];

const CAREER_DEFINITIONS = [
  { id: 'first_blood', kind: 'career', icon: '🩸', title: 'First Blood', description: 'Recorded your first competitive win.', metric: 'frames_won', threshold: 1 },
  { id: 'half_century', kind: 'career', icon: '⭐', title: 'Half Century', description: 'Recorded your 50th career win.', metric: 'frames_won', threshold: 50 },
  { id: 'century_club', kind: 'career', icon: '💯', title: 'Century Club', description: 'Recorded your 100th career win.', metric: 'frames_won', threshold: 100 },
  { id: 'double_century', kind: 'career', icon: '👑', title: 'Double Century', description: 'Recorded your 200th career win.', metric: 'frames_won', threshold: 200 },
  { id: 'regular', kind: 'career', icon: '📅', title: 'Regular', description: 'Made your 25th appearance.', metric: 'appearances', threshold: 25 },
  { id: 'veteran', kind: 'career', icon: '🎖️', title: 'Veteran', description: 'Made your 50th appearance.', metric: 'appearances', threshold: 50 },
  { id: 'club_legend', kind: 'career', icon: '🏛️', title: 'Club Legend', description: 'Made your 100th appearance.', metric: 'appearances', threshold: 100 },
];

const TEAM_CAREER_DEFINITIONS = [
  { id: 'team_50_wins', kind: 'career', subject: 'team', icon: '🥈', title: '50 Match Wins', description: 'The team won its 50th match.', metric: 'team_wins', threshold: 50 },
  { id: 'team_100_wins', kind: 'career', subject: 'team', icon: '🥇', title: '100 Match Wins', description: 'The team won its 100th match.', metric: 'team_wins', threshold: 100 },
  { id: 'team_100_played', kind: 'career', subject: 'team', icon: '📆', title: '100 Matches Played', description: 'The team played its 100th match.', metric: 'team_played', threshold: 100 },
];

const DEFAULT_DEFINITIONS = [...SEASON_DEFINITIONS, ...TEAM_SEASON_DEFINITIONS, ...CAREER_DEFINITIONS, ...TEAM_CAREER_DEFINITIONS];

// Reads everything the definitions need in a few queries. all/get are the caller's query helpers.
function loadContext({ all }, settings) {
  const seasons = all('SELECT id, name, sort_order FROM seasons ORDER BY sort_order, id');
  const seasonById = new Map(seasons.map((s) => [s.id, s]));

  // One row per player per season, aggregate (imported season-total) rows included.
  const seasonRows = all(
    `SELECT
       e.player_id, p.name, w.season_id,
       SUM(e.appearances) AS appearances,
       SUM(e.singles_won) AS singles_won,
       SUM(e.doubles_won) AS doubles_won,
       SUM(CASE WHEN e.singles_lost IS NULL THEN 1 ELSE 0 END) AS unknown_rows,
       SUM(CASE WHEN e.singles_lost IS NOT NULL THEN e.singles_won + e.singles_lost + e.doubles_won + e.doubles_lost ELSE 0 END) AS frames_known,
       SUM(CASE WHEN e.singles_lost IS NOT NULL THEN e.singles_won + e.doubles_won ELSE 0 END) AS frames_won_known
     FROM match_entries e
     JOIN players p ON p.id = e.player_id
     JOIN match_weeks w ON w.id = e.week_id
     GROUP BY e.player_id, p.name, w.season_id`
  ).map((r) => ({
    ...r,
    total_points: r.singles_won * settings.points_per_singles_win + r.doubles_won * settings.points_per_doubles_win,
    frame_win_pct: r.frames_known > 0 ? r.frames_won_known / r.frames_known : null,
  }));

  // One row per player per real match week with recorded losses (no aggregate rows).
  const weekRows = all(
    `SELECT e.player_id, p.name, w.season_id, w.week_number,
            e.singles_won, e.singles_lost, e.doubles_won, e.doubles_lost
     FROM match_entries e
     JOIN match_weeks w ON w.id = e.week_id
     JOIN players p ON p.id = e.player_id
     WHERE w.is_aggregate = 0 AND e.singles_lost IS NOT NULL
     ORDER BY e.player_id, w.season_id, w.week_number`
  );

  // Matches actually played: real weeks (not BYE, not season-total imports) with a result.
  const playedBySeason = new Map(
    all(
      `SELECT season_id, COUNT(*) AS c FROM match_weeks
       WHERE is_aggregate = 0 AND is_bye = 0 AND score_for IS NOT NULL AND score_against IS NOT NULL
       GROUP BY season_id`
    ).map((r) => [r.season_id, r.c])
  );

  // Real matches (BYEs are kept out of every team achievement) with a recorded score.
  const teamWeeks = all(
    `SELECT season_id, week_number, opponent, match_date, score_for, score_against, is_bye
     FROM match_weeks
     WHERE is_aggregate = 0 AND score_for IS NOT NULL AND score_against IS NOT NULL
     ORDER BY season_id, week_number`
  );
  const teamMatches = (seasonId) => teamWeeks.filter((w) => w.season_id === seasonId && !w.is_bye);
  // Same league-points formula as the summary KPI: frames won, plus the bonus for a decided win
  // (a BYE earns frame points but never the bonus).
  const teamSummary = (seasonId) => {
    const ms = teamMatches(seasonId);
    const wins = ms.filter(teamWin).length;
    const points = teamWeeks
      .filter((w) => w.season_id === seasonId)
      .reduce((sum, w) => sum + w.score_for * settings.points_per_frame_won + (!w.is_bye && teamWin(w) ? settings.match_win_bonus : 0), 0);
    return { decided: ms.length, wins, win_rate: ms.length ? wins / ms.length : 0, league_points: points };
  };

  return {
    seasons,
    seasonById,
    teamMatches,
    teamSummary,
    seasonRows,
    weekRows,
    playerSeasons: (seasonId) => seasonRows.filter((r) => r.season_id === seasonId),
    playedWeeks: (seasonId) => playedBySeason.get(seasonId) || 0,
  };
}

function createAchievementEngine({ definitions = DEFAULT_DEFINITIONS, overrides = {} } = {}) {
  const active = definitions
    .map((d) => ({ ...d, ...(overrides[d.id] || {}), params: { ...(d.params || {}), ...((overrides[d.id] || {}).params || {}) } }))
    .filter((d) => d.enabled !== false);
  const byId = new Map(active.map((d) => [d.id, d]));

  const meta = (d) => ({ id: d.id, kind: d.kind, group: d.group || null, icon: d.icon, title: d.title, description: d.description });

  // Season achievements for one season, as flat rows ready to snapshot.
  function evaluateSeason(ctx, seasonId) {
    const out = [];
    for (const d of active.filter((x) => x.kind === 'season')) {
      for (const w of d.evaluate(ctx, seasonId, d.params)) out.push({ achievement_id: d.id, ...w });
    }
    return out;
  }

  // Cumulative career total for a player at the end of each season, in season order.
  function careerTotals(ctx, playerId) {
    const totals = [];
    let appearances = 0;
    let frames_won = 0;
    for (const s of ctx.seasons) {
      const r = ctx.seasonRows.find((x) => x.player_id === playerId && x.season_id === s.id);
      if (r) {
        appearances += r.appearances;
        frames_won += r.singles_won + r.doubles_won;
      }
      totals.push({ season_id: s.id, appearances, frames_won });
    }
    return totals;
  }

  // The team's cumulative totals at the end of each season, in season order.
  function teamTotals(ctx) {
    let team_wins = 0;
    let team_played = 0;
    return ctx.seasons.map((s) => {
      const t = ctx.teamSummary(s.id);
      team_wins += t.wins;
      team_played += t.decided;
      return { season_id: s.id, team_wins, team_played };
    });
  }

  // Career achievements earned, each with the season in which the threshold was crossed.
  function evaluateCareer(ctx) {
    const out = [];
    const teamHits = teamTotals(ctx);
    for (const d of active.filter((x) => x.kind === 'career' && x.subject === 'team')) {
      const hit = teamHits.find((t) => t[d.metric] >= d.threshold);
      if (hit) out.push({ achievement_id: d.id, player_id: null, name: null, season_id: hit.season_id, value: `${d.threshold}` });
    }
    const playerIds = [...new Set(ctx.seasonRows.map((r) => r.player_id))];
    for (const pid of playerIds) {
      const name = ctx.seasonRows.find((r) => r.player_id === pid).name;
      const totals = careerTotals(ctx, pid);
      for (const d of active.filter((x) => x.kind === 'career' && x.subject !== 'team')) {
        const hit = totals.find((t) => t[d.metric] >= d.threshold);
        if (hit) out.push({ achievement_id: d.id, player_id: pid, name, season_id: hit.season_id, value: `${d.threshold}` });
      }
    }
    return out;
  }

  // Career achievements this season's players are close to, as of the end of that season.
  function upcoming(ctx, seasonId) {
    const out = [];
    for (const cur of ctx.playerSeasons(seasonId)) {
      const totals = careerTotals(ctx, cur.player_id);
      const now = totals.find((t) => t.season_id === seasonId);
      for (const d of active.filter((x) => x.kind === 'career' && x.subject !== 'team')) {
        const remaining = d.threshold - now[d.metric];
        const near = d.metric === 'appearances' ? 5 : 10;
        if (remaining > 0 && remaining <= Math.min(near, Math.max(1, Math.ceil(d.threshold / 2)))) {
          out.push({ achievement_id: d.id, player_id: cur.player_id, name: cur.name, remaining });
        }
      }
    }
    const now = teamTotals(ctx).find((t) => t.season_id === seasonId);
    for (const d of active.filter((x) => x.kind === 'career' && x.subject === 'team')) {
      const remaining = d.threshold - now[d.metric];
      if (remaining > 0 && remaining <= 5) out.push({ achievement_id: d.id, player_id: null, name: null, remaining });
    }
    return out.sort((a, b) => a.remaining - b.remaining || (a.name || '').localeCompare(b.name || ''));
  }

  return {
    definitions: active.map(meta),
    describe: (id) => (byId.has(id) ? meta(byId.get(id)) : null),
    evaluateSeason,
    evaluateCareer,
    upcoming,
  };
}

export { createAchievementEngine, loadContext, DEFAULT_DEFINITIONS };
