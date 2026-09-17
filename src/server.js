import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';

if (!process.env.ADMIN_PASSWORD) {
  console.error('ADMIN_PASSWORD is not set. Copy .env.example to .env and set a password before starting the server.');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const adminDir = path.join(publicDir, 'admin');

const app = express();
app.set('trust proxy', 1); // needed for correct client IPs/protocol behind Railway's proxy
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 },
  })
);

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  res.redirect('/admin/login');
}

app.get('/admin/login', (req, res) => {
  if (req.session.isAdmin) return res.redirect('/admin');
  res.sendFile(path.join(adminDir, 'login.html'));
});

app.post('/admin/login', (req, res) => {
  if (req.body.password && req.body.password === process.env.ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.redirect('/admin');
  }
  res.redirect('/admin/login?error=1');
});

app.post('/admin/logout', (req, res) => {
  req.session.destroy(() => res.status(204).end());
});

app.use('/admin', requireAdmin, express.static(adminDir));
app.use(express.static(publicDir));

const all = (sql, params = []) => db.prepare(sql).all(...params);
const get = (sql, params = []) => db.prepare(sql).get(...params);
const run = (sql, params = []) => db.prepare(sql).run(...params);

const getSettings = () => get('SELECT * FROM league_settings WHERE id = 1');

// ---------- Players ----------
app.get('/api/players', requireAdmin, (req, res) => {
  res.json(all('SELECT * FROM players ORDER BY (left_date IS NOT NULL), name'));
});

app.post('/api/players', requireAdmin, (req, res) => {
  const { name, is_original, joined_date, left_date, notes } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  try {
    const result = run(
      'INSERT INTO players (name, is_original, joined_date, left_date, notes) VALUES (?, ?, ?, ?, ?)',
      [name.trim(), is_original ? 1 : 0, joined_date || null, left_date || null, notes || null]
    );
    res.status(201).json(get('SELECT * FROM players WHERE id = ?', [Number(result.lastInsertRowid)]));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/players/:id', requireAdmin, (req, res) => {
  const { name, is_original, joined_date, left_date, notes } = req.body;
  const existing = get('SELECT * FROM players WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'not found' });
  run(
    `UPDATE players SET name = ?, is_original = ?, joined_date = ?, left_date = ?, notes = ? WHERE id = ?`,
    [
      name ?? existing.name,
      is_original === undefined ? existing.is_original : (is_original ? 1 : 0),
      joined_date === undefined ? existing.joined_date : joined_date,
      left_date === undefined ? existing.left_date : left_date,
      notes === undefined ? existing.notes : notes,
      req.params.id,
    ]
  );
  res.json(get('SELECT * FROM players WHERE id = ?', [req.params.id]));
});

app.delete('/api/players/:id', requireAdmin, (req, res) => {
  run('DELETE FROM players WHERE id = ?', [req.params.id]);
  res.status(204).end();
});

// ---------- Player profile (public) ----------
// Career totals, a per-season breakdown, and full match-by-match history for one player.
// Public like /api/stats - it's the same numbers, just sliced down to a single player.
function shapePlayerStats(r) {
  return {
    appearances: r.appearances || 0,
    singles_won: r.singles_won || 0,
    doubles_won: r.doubles_won || 0,
    total_points: r.total_points || 0,
    points_per_appearance: r.appearances > 0 ? r.total_points / r.appearances : 0,
    frame_win_pct: r.frames_with_known_result > 0 ? r.frames_won_known / r.frames_with_known_result : null,
  };
}

app.get('/api/players/:id/profile', (req, res) => {
  const playerId = Number(req.params.id);
  const player = get('SELECT * FROM players WHERE id = ?', [playerId]);
  if (!player) return res.status(404).json({ error: 'not found' });

  const settings = getSettings();
  const pointsParams = [settings.points_per_singles_win, settings.points_per_doubles_win];

  const careerRow = get(
    `SELECT
       SUM(e.appearances) AS appearances,
       SUM(e.singles_won) AS singles_won,
       SUM(e.doubles_won) AS doubles_won,
       (SUM(e.singles_won) * ? + SUM(e.doubles_won) * ?) AS total_points,
       SUM(CASE WHEN e.singles_lost IS NOT NULL THEN e.singles_won + e.singles_lost + e.doubles_won + e.doubles_lost ELSE 0 END) AS frames_with_known_result,
       SUM(CASE WHEN e.singles_lost IS NOT NULL THEN e.singles_won + e.doubles_won ELSE 0 END) AS frames_won_known
     FROM match_entries e
     WHERE e.player_id = ?`,
    [...pointsParams, playerId]
  );

  const seasonRows = all(
    `SELECT
       w.season_id, s.name AS season_name, s.sort_order,
       SUM(e.appearances) AS appearances,
       SUM(e.singles_won) AS singles_won,
       SUM(e.doubles_won) AS doubles_won,
       (SUM(e.singles_won) * ? + SUM(e.doubles_won) * ?) AS total_points,
       SUM(CASE WHEN e.singles_lost IS NOT NULL THEN e.singles_won + e.singles_lost + e.doubles_won + e.doubles_lost ELSE 0 END) AS frames_with_known_result,
       SUM(CASE WHEN e.singles_lost IS NOT NULL THEN e.singles_won + e.doubles_won ELSE 0 END) AS frames_won_known
     FROM match_entries e
     JOIN match_weeks w ON w.id = e.week_id
     JOIN seasons s ON s.id = w.season_id
     WHERE e.player_id = ?
     GROUP BY w.season_id, s.name, s.sort_order
     ORDER BY s.sort_order`,
    [...pointsParams, playerId]
  );

  // Excludes aggregate (season-total import) rows - those aren't a real single match to list,
  // they're already folded into the season row above.
  const matchRows = all(
    `SELECT
       w.season_id, s.name AS season_name, s.sort_order,
       w.week_number, w.match_date, w.opponent, w.venue, w.score_for, w.score_against, w.is_bye,
       e.singles_won, e.singles_lost, e.doubles_won, e.doubles_lost
     FROM match_entries e
     JOIN match_weeks w ON w.id = e.week_id
     JOIN seasons s ON s.id = w.season_id
     WHERE e.player_id = ? AND w.is_aggregate = 0
     ORDER BY s.sort_order DESC, w.week_number DESC`,
    [playerId]
  );

  res.json({
    player,
    career: shapePlayerStats(careerRow || {}),
    seasons: seasonRows.map((r) => ({ season_id: r.season_id, season_name: r.season_name, ...shapePlayerStats(r) })),
    matches: matchRows.map((r) => ({
      season_id: r.season_id,
      season_name: r.season_name,
      week_number: r.week_number,
      match_date: r.match_date,
      opponent: r.opponent,
      venue: r.venue,
      score_for: r.score_for,
      score_against: r.score_against,
      is_bye: !!r.is_bye,
      singles_won: r.singles_won,
      singles_lost: r.singles_lost,
      doubles_won: r.doubles_won,
      doubles_lost: r.doubles_lost,
    })),
  });
});

// ---------- Seasons ----------
app.get('/api/seasons', (req, res) => {
  res.json(all('SELECT * FROM seasons ORDER BY sort_order, id'));
});

app.post('/api/seasons', requireAdmin, (req, res) => {
  const { name, start_date, end_date, is_active } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  const maxOrder = get('SELECT COALESCE(MAX(sort_order), 0) AS m FROM seasons').m;
  try {
    if (is_active) run('UPDATE seasons SET is_active = 0');
    const result = run(
      'INSERT INTO seasons (name, start_date, end_date, is_active, sort_order) VALUES (?, ?, ?, ?, ?)',
      [name.trim(), start_date || null, end_date || null, is_active ? 1 : 0, maxOrder + 1]
    );
    res.status(201).json(get('SELECT * FROM seasons WHERE id = ?', [Number(result.lastInsertRowid)]));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/seasons/:id', requireAdmin, (req, res) => {
  const existing = get('SELECT * FROM seasons WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const { name, start_date, end_date, is_active } = req.body;
  if (is_active) run('UPDATE seasons SET is_active = 0');
  run(
    'UPDATE seasons SET name = ?, start_date = ?, end_date = ?, is_active = ? WHERE id = ?',
    [
      name ?? existing.name,
      start_date === undefined ? existing.start_date : start_date,
      end_date === undefined ? existing.end_date : end_date,
      is_active === undefined ? existing.is_active : (is_active ? 1 : 0),
      req.params.id,
    ]
  );
  res.json(get('SELECT * FROM seasons WHERE id = ?', [req.params.id]));
});

app.delete('/api/seasons/:id', requireAdmin, (req, res) => {
  run('DELETE FROM seasons WHERE id = ?', [req.params.id]);
  res.status(204).end();
});

// ---------- Season roster ----------
app.get('/api/seasons/:id/roster', requireAdmin, (req, res) => {
  res.json(
    all(
      `SELECT sr.id, sr.player_id, p.name, p.is_original, p.left_date, sr.role, sr.pick_status
       FROM season_rosters sr JOIN players p ON p.id = sr.player_id
       WHERE sr.season_id = ?
       ORDER BY (sr.role = 'Captain') DESC, (sr.role = 'Vice-Captain') DESC, p.name`,
      [req.params.id]
    )
  );
});

app.post('/api/seasons/:id/roster', requireAdmin, (req, res) => {
  const { player_id, role, pick_status } = req.body;
  try {
    run(
      'INSERT INTO season_rosters (season_id, player_id, role, pick_status) VALUES (?, ?, ?, ?)',
      [req.params.id, player_id, role || 'Member', pick_status || 'Regular']
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/seasons/:id/roster/:playerId', requireAdmin, (req, res) => {
  const { role, pick_status } = req.body;
  const existing = get('SELECT * FROM season_rosters WHERE season_id = ? AND player_id = ?', [req.params.id, req.params.playerId]);
  if (!existing) return res.status(404).json({ error: 'not on roster' });
  run(
    'UPDATE season_rosters SET role = ?, pick_status = ? WHERE season_id = ? AND player_id = ?',
    [role ?? existing.role, pick_status ?? existing.pick_status, req.params.id, req.params.playerId]
  );
  res.json({ ok: true });
});

app.delete('/api/seasons/:id/roster/:playerId', requireAdmin, (req, res) => {
  run('DELETE FROM season_rosters WHERE season_id = ? AND player_id = ?', [req.params.id, req.params.playerId]);
  res.status(204).end();
});

// ---------- Match weeks ----------
app.get('/api/seasons/:id/weeks', (req, res) => {
  res.json(
    all(
      `SELECT w.*, (SELECT COUNT(*) FROM match_entries e WHERE e.week_id = w.id) AS entry_count
       FROM match_weeks w WHERE w.season_id = ?
       ORDER BY (w.week_number IS NULL), w.week_number`,
      [req.params.id]
    )
  );
});

app.post('/api/seasons/:id/weeks', requireAdmin, (req, res) => {
  const { week_number, match_date, opponent, is_bye } = req.body;
  if (!week_number) return res.status(400).json({ error: 'week_number is required' });
  try {
    const result = run(
      'INSERT INTO match_weeks (season_id, week_number, label, match_date, opponent, is_aggregate, is_bye) VALUES (?, ?, ?, ?, ?, 0, ?)',
      [req.params.id, week_number, `Week ${week_number}`, match_date || null, opponent || null, is_bye ? 1 : 0]
    );
    res.status(201).json(get('SELECT * FROM match_weeks WHERE id = ?', [Number(result.lastInsertRowid)]));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/weeks/:id', requireAdmin, (req, res) => {
  const existing = get('SELECT * FROM match_weeks WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const { match_date, opponent, venue, score_for, score_against, is_bye } = req.body;
  run(
    'UPDATE match_weeks SET match_date = ?, opponent = ?, venue = ?, score_for = ?, score_against = ?, is_bye = ? WHERE id = ?',
    [
      match_date === undefined ? existing.match_date : match_date,
      opponent === undefined ? existing.opponent : opponent,
      venue === undefined ? existing.venue : venue,
      score_for === undefined ? existing.score_for : (score_for === null || score_for === '' ? null : Number(score_for)),
      score_against === undefined ? existing.score_against : (score_against === null || score_against === '' ? null : Number(score_against)),
      is_bye === undefined ? existing.is_bye : (is_bye ? 1 : 0),
      req.params.id,
    ]
  );
  res.json(get('SELECT * FROM match_weeks WHERE id = ?', [req.params.id]));
});

app.delete('/api/weeks/:id', requireAdmin, (req, res) => {
  run('DELETE FROM match_weeks WHERE id = ?', [req.params.id]);
  res.status(204).end();
});

// ---------- Match entries for a week ----------
app.get('/api/weeks/:id/entries', requireAdmin, (req, res) => {
  const week = get('SELECT * FROM match_weeks WHERE id = ?', [req.params.id]);
  if (!week) return res.status(404).json({ error: 'week not found' });
  const roster = all(
    `SELECT p.id AS player_id, p.name,
            e.singles_won, e.singles_lost, e.doubles_won, e.doubles_lost, e.appearances
     FROM season_rosters sr
     JOIN players p ON p.id = sr.player_id
     LEFT JOIN match_entries e ON e.week_id = ? AND e.player_id = p.id
     WHERE sr.season_id = ?
     ORDER BY p.name`,
    [req.params.id, week.season_id]
  );
  res.json({ week, roster });
});

app.put('/api/weeks/:id/entries/:playerId', requireAdmin, (req, res) => {
  const { singles_won, singles_lost, doubles_won, doubles_lost } = req.body;
  const sw = Number(singles_won) || 0;
  const sl = Number(singles_lost) || 0;
  const dw = Number(doubles_won) || 0;
  const dl = Number(doubles_lost) || 0;
  const existing = get('SELECT id FROM match_entries WHERE week_id = ? AND player_id = ?', [req.params.id, req.params.playerId]);
  if (existing) {
    run(
      'UPDATE match_entries SET singles_won = ?, singles_lost = ?, doubles_won = ?, doubles_lost = ? WHERE id = ?',
      [sw, sl, dw, dl, existing.id]
    );
  } else {
    run(
      'INSERT INTO match_entries (week_id, player_id, singles_won, singles_lost, doubles_won, doubles_lost, appearances) VALUES (?, ?, ?, ?, ?, ?, 1)',
      [req.params.id, req.params.playerId, sw, sl, dw, dl]
    );
  }
  res.json({ ok: true });
});

app.delete('/api/weeks/:id/entries/:playerId', requireAdmin, (req, res) => {
  run('DELETE FROM match_entries WHERE week_id = ? AND player_id = ?', [req.params.id, req.params.playerId]);
  res.status(204).end();
});

// ---------- League settings ----------
// Controls the scoring formula used everywhere below: how many points a singles/doubles
// win is worth to a player, and how team League Points are calculated (points per frame
// won, plus a bonus for winning the match). Kept editable so it can be corrected here
// without a code change if the league ever changes how it awards points.
app.get('/api/settings', (req, res) => {
  res.json(getSettings());
});

app.put('/api/settings', requireAdmin, (req, res) => {
  const existing = getSettings();
  const { points_per_singles_win, points_per_doubles_win, points_per_frame_won, match_win_bonus } = req.body;
  const clean = (value, fallback) => {
    const n = Number(value);
    return value === undefined || value === null || value === '' || Number.isNaN(n) || n < 0 ? fallback : n;
  };
  run(
    `UPDATE league_settings
     SET points_per_singles_win = ?, points_per_doubles_win = ?, points_per_frame_won = ?, match_win_bonus = ?
     WHERE id = 1`,
    [
      clean(points_per_singles_win, existing.points_per_singles_win),
      clean(points_per_doubles_win, existing.points_per_doubles_win),
      clean(points_per_frame_won, existing.points_per_frame_won),
      clean(match_win_bonus, existing.match_win_bonus),
    ]
  );
  res.json(getSettings());
});

// ---------- Stats ----------
const STATS_SQL = `
  SELECT
    p.id AS player_id,
    p.name,
    SUM(e.appearances) AS appearances,
    SUM(e.singles_won) AS singles_won,
    SUM(e.doubles_won) AS doubles_won,
    (SUM(e.singles_won) * ? + SUM(e.doubles_won) * ?) AS total_points,
    SUM(CASE WHEN e.singles_lost IS NOT NULL THEN e.singles_won + e.singles_lost + e.doubles_won + e.doubles_lost ELSE 0 END) AS frames_with_known_result,
    SUM(CASE WHEN e.singles_lost IS NOT NULL THEN e.singles_won + e.doubles_won ELSE 0 END) AS frames_won_known
  FROM match_entries e
  JOIN players p ON p.id = e.player_id
  JOIN match_weeks w ON w.id = e.week_id
  WHERE (? IS NULL OR w.season_id = ?)
  GROUP BY p.id, p.name
  ORDER BY total_points DESC, singles_won DESC
`;

app.get('/api/stats', (req, res) => {
  const seasonId = req.query.season_id ? Number(req.query.season_id) : null;
  const settings = getSettings();
  const rows = all(STATS_SQL, [settings.points_per_singles_win, settings.points_per_doubles_win, seasonId, seasonId]);
  const shaped = rows.map((r) => ({
    player_id: r.player_id,
    name: r.name,
    appearances: r.appearances,
    singles_won: r.singles_won,
    doubles_won: r.doubles_won,
    total_points: r.total_points,
    points_per_appearance: r.appearances > 0 ? r.total_points / r.appearances : 0,
    frame_win_pct: r.frames_with_known_result > 0 ? r.frames_won_known / r.frames_with_known_result : null,
    frames_played_known: r.frames_with_known_result,
  }));
  res.json(shaped);
});

// ---------- Stats: KPI summary ----------
app.get('/api/stats/summary', (req, res) => {
  const seasonId = req.query.season_id ? Number(req.query.season_id) : null;
  const settings = getSettings();

  // "Decided" matches exclude BYEs (a fixed league bye - counts as played, but never a win/loss).
  // League Points = frames won (score_for) times the per-frame rate, plus the match-win bonus
  // for a decided win only - a BYE's score_for still earns frame points, just never the bonus.
  const matchRow = get(
    `SELECT
       SUM(CASE WHEN is_bye = 0 AND score_for > score_against THEN 1 ELSE 0 END) AS wins,
       SUM(CASE WHEN is_bye = 0 AND score_for < score_against THEN 1 ELSE 0 END) AS losses,
       SUM(CASE WHEN is_bye = 0 AND score_for = score_against THEN 1 ELSE 0 END) AS draws,
       SUM(CASE WHEN is_bye = 0 THEN 1 ELSE 0 END) AS decided_total,
       SUM(CASE WHEN is_bye = 1 THEN 1 ELSE 0 END) AS byes,
       COUNT(*) AS matches_played,
       SUM(score_for * ? + CASE WHEN is_bye = 0 AND score_for > score_against THEN ? ELSE 0 END) AS league_points
     FROM match_weeks
     WHERE is_aggregate = 0 AND score_for IS NOT NULL AND score_against IS NOT NULL
       AND (? IS NULL OR season_id = ?)`,
    [settings.points_per_frame_won, settings.match_win_bonus, seasonId, seasonId]
  );

  const statsRows = all(STATS_SQL, [settings.points_per_singles_win, settings.points_per_doubles_win, seasonId, seasonId]).map((r) => ({
    player_id: r.player_id,
    name: r.name,
    appearances: r.appearances,
    total_points: r.total_points,
    frame_win_pct: r.frames_with_known_result > 0 ? r.frames_won_known / r.frames_with_known_result : null,
  }));

  const pointsLeader = statsRows[0] || null; // STATS_SQL already orders by total_points DESC
  const bestFrameWinPct = statsRows
    .filter((r) => r.appearances >= 3 && r.frame_win_pct != null)
    .sort((a, b) => b.frame_win_pct - a.frame_win_pct)[0] || null;

  res.json({
    win_rate: {
      wins: matchRow.wins || 0,
      losses: matchRow.losses || 0,
      draws: matchRow.draws || 0,
      decided_total: matchRow.decided_total || 0,
      byes: matchRow.byes || 0,
      pct: matchRow.decided_total > 0 ? matchRow.wins / matchRow.decided_total : null,
    },
    matches_played: matchRow.matches_played || 0,
    league_points: matchRow.league_points || 0,
    points_leader: pointsLeader ? { name: pointsLeader.name, total_points: pointsLeader.total_points } : null,
    best_frame_win_pct: bestFrameWinPct ? { name: bestFrameWinPct.name, frame_win_pct: bestFrameWinPct.frame_win_pct } : null,
    settings,
  });
});

// ---------- Stats: player form (last 5 weeks played, season-scoped) ----------
app.get('/api/stats/form', (req, res) => {
  const seasonId = req.query.season_id ? Number(req.query.season_id) : null;
  if (!seasonId) return res.json([]); // form is season-scoped only; no season selected means nothing to show

  const rows = all(
    `WITH ranked AS (
       SELECT
         e.player_id,
         p.name,
         w.week_number,
         e.singles_won, e.singles_lost, e.doubles_won, e.doubles_lost,
         ROW_NUMBER() OVER (PARTITION BY e.player_id ORDER BY w.week_number DESC) AS rn
       FROM match_entries e
       JOIN match_weeks w ON w.id = e.week_id
       JOIN players p ON p.id = e.player_id
       WHERE w.is_aggregate = 0 AND e.singles_lost IS NOT NULL AND w.season_id = ?
     )
     SELECT * FROM ranked WHERE rn <= 5 ORDER BY player_id, week_number ASC`,
    [seasonId]
  );

  const byPlayer = new Map();
  for (const r of rows) {
    if (!byPlayer.has(r.player_id)) byPlayer.set(r.player_id, { player_id: r.player_id, name: r.name, form: [] });
    const won = r.singles_won + r.doubles_won;
    const lost = r.singles_lost + r.doubles_lost;
    const result = won > lost ? 'W' : lost > won ? 'L' : 'split';
    byPlayer.get(r.player_id).form.push(result);
  }
  res.json(Array.from(byPlayer.values()));
});

// ---------- Backup / restore ----------
// Used to move data between environments (e.g. local -> a fresh host), since the
// database file itself typically isn't something you can just copy across hosts.
const BACKUP_TABLES = ['players', 'seasons', 'season_rosters', 'match_weeks', 'match_entries'];

app.get('/api/admin/export', requireAdmin, (req, res) => {
  const dump = {};
  for (const table of BACKUP_TABLES) {
    dump[table] = all(`SELECT * FROM ${table}`);
  }
  res.setHeader('Content-Disposition', `attachment; filename="crusaders-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(dump);
});

app.post('/api/admin/import', requireAdmin, (req, res) => {
  const existing = get('SELECT COUNT(*) AS c FROM players').c;
  if (existing > 0) {
    return res.status(400).json({ error: 'This database already has players in it. Import only works into an empty database, to avoid overwriting existing data.' });
  }
  const dump = req.body;
  for (const table of BACKUP_TABLES) {
    if (!Array.isArray(dump[table])) {
      return res.status(400).json({ error: `Backup file is missing or has an invalid "${table}" section.` });
    }
  }
  db.exec('BEGIN');
  try {
    for (const table of BACKUP_TABLES) {
      for (const row of dump[table]) {
        const cols = Object.keys(row);
        const placeholders = cols.map(() => '?').join(', ');
        run(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`, cols.map((c) => row[c]));
      }
    }
    db.exec('COMMIT');
    res.json({ ok: true, imported: Object.fromEntries(BACKUP_TABLES.map((t) => [t, dump[t].length])) });
  } catch (err) {
    db.exec('ROLLBACK');
    res.status(400).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4173;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`FrameIQ running at http://localhost:${PORT}`);
});
