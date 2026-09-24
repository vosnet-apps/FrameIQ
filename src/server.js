import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import { SqliteSessionStore } from './session-store.js';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { db } from './db.js';
import { createAchievementEngine, loadContext } from './achievements.js';

if (!process.env.ADMIN_PASSWORD) {
  console.error('ADMIN_PASSWORD is not set. Copy .env.example to .env and set a password before starting the server.');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const adminDir = path.join(publicDir, 'admin');
const APP_VERSION = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;

// Signing secret: SESSION_SECRET if the host sets one, otherwise generated once and kept
// in the database so sessions stay valid across restarts.
function sessionSecret() {
  // 'changeme' is the placeholder from .env.example - never sign cookies with that.
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET !== 'changeme') return process.env.SESSION_SECRET;
  const row = db.prepare('SELECT session_secret FROM server_secrets WHERE id = 1').get();
  if (row) return row.session_secret;
  const generated = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO server_secrets (id, session_secret) VALUES (1, ?)').run(generated);
  return generated;
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // needed for correct client IPs/protocol behind Railway's proxy

// Security headers. The CSP allows only our own scripts (no inline script), Google Fonts
// for the typeface, and inline style attributes (a few are used in the markup).
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=15552000');
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    store: new SqliteSessionStore(),
    secret: sessionSecret(),
    resave: false,
    saveUninitialized: false,
    // SameSite=Lax keeps the cookie off cross-site POST/PUT/DELETE; 'auto' marks it
    // Secure whenever the request arrived over HTTPS (works behind the proxy too).
    cookie: { httpOnly: true, sameSite: 'lax', secure: 'auto', maxAge: 30 * 24 * 60 * 60 * 1000 },
  })
);

// CSRF defence in depth on top of SameSite: browsers always send Origin on cross-site
// writes, so refuse any state-changing request whose Origin isn't this site.
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin) {
    let originHost = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      /* "null" or malformed - rejected below */
    }
    const ownHost = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
    if (originHost !== ownHost) return res.status(403).json({ error: 'Cross-origin request blocked' });
  }
  next();
});

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  res.redirect('/admin/login');
}

// Login throttling: after 5 wrong passwords from one IP, refuse all attempts from it
// (even a correct one, so guessing can't continue) until the window expires.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 5;
const loginFails = new Map(); // ip -> { count, firstAt }

function loginBlocked(ip) {
  const entry = loginFails.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.firstAt > LOGIN_WINDOW_MS) {
    loginFails.delete(ip);
    return false;
  }
  return entry.count >= LOGIN_MAX_FAILS;
}

function recordLoginFailure(ip) {
  const entry = loginFails.get(ip);
  if (!entry || Date.now() - entry.firstAt > LOGIN_WINDOW_MS) loginFails.set(ip, { count: 1, firstAt: Date.now() });
  else entry.count += 1;
}

setInterval(() => {
  for (const [ip, entry] of loginFails) if (Date.now() - entry.firstAt > LOGIN_WINDOW_MS) loginFails.delete(ip);
}, LOGIN_WINDOW_MS).unref();

// Hash both sides so timingSafeEqual gets equal-length buffers whatever was typed.
function passwordMatches(input) {
  const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(digest(input), digest(process.env.ADMIN_PASSWORD));
}

app.get('/admin/login', (req, res) => {
  if (req.session.isAdmin) return res.redirect('/admin');
  res.sendFile(path.join(adminDir, 'login.html'));
});

app.post('/admin/login', (req, res) => {
  if (loginBlocked(req.ip)) return res.redirect('/admin/login?error=2');
  if (req.body.password && passwordMatches(req.body.password)) {
    loginFails.delete(req.ip);
    // New session id on privilege change (prevents session fixation).
    return req.session.regenerate((err) => {
      if (err) return res.redirect('/admin/login?error=1');
      req.session.isAdmin = true;
      res.redirect('/admin');
    });
  }
  recordLoginFailure(req.ip);
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
// Never returns the logo bytes themselves - those are served by GET /api/logo.
const getAppSettings = () => {
  const r = get(
    'SELECT accent_color, team_name, show_footer, logo_updated_at, (logo_data IS NOT NULL) AS has_logo FROM app_settings WHERE id = 1'
  );
  // Newest scored, non-BYE match date - the footer's "results last updated" line.
  const last = get(
    'SELECT MAX(match_date) AS d FROM match_weeks WHERE is_aggregate = 0 AND is_bye = 0 AND score_for IS NOT NULL AND match_date IS NOT NULL'
  );
  return {
    accent_color: r.accent_color,
    team_name: r.team_name,
    has_logo: !!r.has_logo,
    logo_version: r.logo_updated_at || 0,
    show_footer: !!r.show_footer,
    last_result_date: last ? last.d : null,
  };
};
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

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

  // Badges: published season awards (repeatable, so counted) plus career milestones.
  const ctx = loadContext({ all, get }, settings);
  const seasonNames = new Map(ctx.seasons.map((x) => [x.id, x.name]));
  const badgeMap = new Map();
  const addBadge = (id, seasonId) => {
    const d = achievements.describe(id);
    if (!d) return;
    const b = badgeMap.get(id) || { ...d, count: 0, seasons: [] };
    b.count += 1;
    b.seasons.push(seasonNames.get(seasonId));
    badgeMap.set(id, b);
  };
  for (const r of all('SELECT a.achievement_id, a.season_id FROM season_awards a JOIN seasons s ON s.id = a.season_id WHERE a.player_id = ? ORDER BY s.sort_order', [playerId])) addBadge(r.achievement_id, r.season_id);
  for (const r of achievements.evaluateCareer(ctx).filter((m) => m.player_id === playerId)) addBadge(r.achievement_id, r.season_id);
  const order = new Map(achievements.definitions.map((d, i) => [d.id, i]));
  const badges = [...badgeMap.values()].sort((a, b) => order.get(a.id) - order.get(b.id));

  res.json({
    player,
    badges,
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

// League name / division are short optional labels: blank clears them, undefined leaves them alone.
const LEAGUE_TEXT_MAX = 80;
function cleanLeagueText(value) {
  if (value === undefined) return { value: undefined };
  if (value === null || String(value).trim() === '') return { value: null };
  const text = String(value).trim();
  if (text.length > LEAGUE_TEXT_MAX) return { error: `Keep league and division to ${LEAGUE_TEXT_MAX} characters or fewer.` };
  return { value: text };
}

app.post('/api/seasons', requireAdmin, (req, res) => {
  const { name, start_date, end_date, is_active } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  const league = cleanLeagueText(req.body.league_name);
  const division = cleanLeagueText(req.body.division);
  if (league.error || division.error) return res.status(400).json({ error: league.error || division.error });
  const maxOrder = get('SELECT COALESCE(MAX(sort_order), 0) AS m FROM seasons').m;
  try {
    if (is_active) run('UPDATE seasons SET is_active = 0');
    const result = run(
      'INSERT INTO seasons (name, start_date, end_date, is_active, sort_order, league_name, division) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [name.trim(), start_date || null, end_date || null, is_active ? 1 : 0, maxOrder + 1, league.value ?? null, division.value ?? null]
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
  const league = cleanLeagueText(req.body.league_name);
  const division = cleanLeagueText(req.body.division);
  if (league.error || division.error) return res.status(400).json({ error: league.error || division.error });
  if (is_active) run('UPDATE seasons SET is_active = 0');
  run(
    'UPDATE seasons SET name = ?, start_date = ?, end_date = ?, is_active = ?, league_name = ?, division = ? WHERE id = ?',
    [
      name ?? existing.name,
      start_date === undefined ? existing.start_date : start_date,
      end_date === undefined ? existing.end_date : end_date,
      is_active === undefined ? existing.is_active : (is_active ? 1 : 0),
      league.value === undefined ? existing.league_name : league.value,
      division.value === undefined ? existing.division : division.value,
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
  const { points_per_singles_win, points_per_doubles_win, points_per_frame_won, match_win_bonus, allow_draws } = req.body;
  const clean = (value, fallback) => {
    const n = Number(value);
    return value === undefined || value === null || value === '' || Number.isNaN(n) || n < 0 ? fallback : n;
  };
  run(
    `UPDATE league_settings
     SET points_per_singles_win = ?, points_per_doubles_win = ?, points_per_frame_won = ?, match_win_bonus = ?, allow_draws = ?
     WHERE id = 1`,
    [
      clean(points_per_singles_win, existing.points_per_singles_win),
      clean(points_per_doubles_win, existing.points_per_doubles_win),
      clean(points_per_frame_won, existing.points_per_frame_won),
      clean(match_win_bonus, existing.match_win_bonus),
      allow_draws === undefined ? existing.allow_draws : (allow_draws ? 1 : 0),
    ]
  );
  res.json(getSettings());
});

// ---------- App settings (branding) ----------
app.get('/api/app-settings', (req, res) => {
  // The version is only shown in the admin area, so it isn't handed to anonymous visitors.
  res.json(req.session && req.session.isAdmin ? { ...getAppSettings(), version: APP_VERSION } : getAppSettings());
});

app.put('/api/app-settings', requireAdmin, (req, res) => {
  const existing = getAppSettings();
  const { accent_color, team_name, show_footer } = req.body;
  const cleanColor = HEX_COLOR_RE.test(accent_color || '') ? accent_color : existing.accent_color;
  const name = typeof team_name === 'string' ? team_name.trim() : '';
  const cleanName = name && name.length <= 60 ? name : existing.team_name;
  const cleanFooter = show_footer === undefined ? existing.show_footer : !!show_footer;
  run('UPDATE app_settings SET accent_color = ?, team_name = ?, show_footer = ? WHERE id = 1', [cleanColor, cleanName, cleanFooter ? 1 : 0]);
  res.json(getAppSettings());
});

// Custom logo, stored in the database (so it lives on the same persistent volume as
// everything else). Raster formats only - SVG can carry scripts.
app.get('/api/logo', (req, res) => {
  const row = get('SELECT logo_data, logo_mime FROM app_settings WHERE id = 1');
  if (!row || !row.logo_data) return res.status(404).end();
  res.set({
    'Content-Type': row.logo_mime,
    'Cache-Control': 'public, max-age=31536000, immutable', // callers add ?v=<logo_version>
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(Buffer.from(row.logo_data));
});

app.put('/api/logo', requireAdmin, express.raw({ type: LOGO_TYPES, limit: '1mb' }), (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) {
    return res.status(400).json({ error: 'Upload a PNG, JPEG, WebP or GIF image under 1 MB.' });
  }
  const mime = req.get('content-type').split(';')[0].trim();
  run('UPDATE app_settings SET logo_data = ?, logo_mime = ?, logo_updated_at = ? WHERE id = 1', [req.body, mime, Date.now()]);
  res.json(getAppSettings());
});

app.delete('/api/logo', requireAdmin, (req, res) => {
  run('UPDATE app_settings SET logo_data = NULL, logo_mime = NULL, logo_updated_at = ? WHERE id = 1', [Date.now()]);
  res.json(getAppSettings());
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

// ---------- Stats: head-to-head (all-time, every season) ----------
// Deliberately not season-scoped - the point is the pattern across the team's whole
// history against each opponent. BYE weeks and aggregate (season-total) rows have no
// real opponent, so they're excluded rather than showing up as a fake "opponent".
app.get('/api/stats/head-to-head', (req, res) => {
  const settings = getSettings();
  const allowDraws = !!settings.allow_draws;

  const rows = all(
    `SELECT
       opponent,
       COUNT(*) AS played,
       SUM(CASE WHEN score_for > score_against THEN 1 ELSE 0 END) AS wins,
       SUM(CASE WHEN score_for < score_against THEN 1 ELSE 0 END) AS losses,
       SUM(CASE WHEN score_for = score_against THEN 1 ELSE 0 END) AS draws,
       SUM(score_for) AS frames_for,
       SUM(score_against) AS frames_against,
       MAX(match_date) AS last_played
     FROM match_weeks
     WHERE is_aggregate = 0 AND is_bye = 0
       AND opponent IS NOT NULL AND TRIM(opponent) != ''
       AND score_for IS NOT NULL AND score_against IS NOT NULL
     GROUP BY opponent
     ORDER BY opponent COLLATE NOCASE`
  );

  // When draws are switched off (a league where a match always has a winner), a scored
  // 4-4 is treated as a data-entry slip rather than a real draw: it stays in "played" but
  // counts toward neither W nor L, and the win% denominator drops it rather than the
  // column just disappearing while still silently deflating the percentage.
  res.json({
    allow_draws: allowDraws,
    opponents: rows.map((r) => {
      const decided = allowDraws ? r.played : r.wins + r.losses;
      const shaped = {
        opponent: r.opponent,
        played: r.played,
        wins: r.wins,
        losses: r.losses,
        win_pct: decided > 0 ? r.wins / decided : null,
        frames_for: r.frames_for,
        frames_against: r.frames_against,
        frame_diff: r.frames_for - r.frames_against,
        last_played: r.last_played,
      };
      if (allowDraws) shaped.draws = r.draws;
      return shaped;
    }),
  });
});

// ---------- Achievements: season awards & career milestones ----------
// Season awards are snapshotted into season_awards when an admin publishes them, and are
// hidden from everyone else until then. Career milestones are always live.
const achievements = createAchievementEngine();

const seasonOr404 = (req, res) => {
  const season = get('SELECT * FROM seasons WHERE id = ?', [Number(req.params.id ?? req.query.season_id)]);
  if (!season) res.status(404).json({ error: 'season not found' });
  return season;
};

function snapshotSeasonAwards(seasonId) {
  const results = achievements.evaluateSeason(loadContext({ all, get }, getSettings()), seasonId);
  db.exec('BEGIN');
  try {
    run('DELETE FROM season_awards WHERE season_id = ?', [seasonId]);
    for (const r of results) {
      run('INSERT INTO season_awards (season_id, achievement_id, player_id, value) VALUES (?, ?, ?, ?)', [seasonId, r.achievement_id, r.player_id, r.value]);
    }
    run('UPDATE seasons SET awards_published_at = ? WHERE id = ?', [Date.now(), seasonId]);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return results.length;
}

// Groups flat award rows into one entry per award, in definition order.
function groupAwards(rows) {
  return achievements.definitions
    .filter((d) => d.kind === 'season')
    .map((d) => {
      const winners = rows.filter((r) => r.achievement_id === d.id);
      return winners.length ? { ...d, value: winners[0].value, winners: winners.map((w) => ({ player_id: w.player_id, name: w.name, value: w.value })) } : null;
    })
    .filter(Boolean);
}

app.post('/api/seasons/:id/awards/publish', requireAdmin, (req, res) => {
  const season = seasonOr404(req, res);
  if (!season) return;
  if (season.is_active) return res.status(400).json({ error: 'Awards can be published once the season is no longer active.' });
  res.json({ ok: true, awarded: snapshotSeasonAwards(season.id) });
});

app.delete('/api/seasons/:id/awards', requireAdmin, (req, res) => {
  const season = seasonOr404(req, res);
  if (!season) return;
  run('DELETE FROM season_awards WHERE season_id = ?', [season.id]);
  run('UPDATE seasons SET awards_published_at = NULL WHERE id = ?', [season.id]);
  res.status(204).end();
});

app.get('/api/stats/awards', (req, res) => {
  const season = seasonOr404(req, res);
  if (!season) return;
  // The unpublished preview is only for the admin Stats page, which asks for it explicitly;
  // the public site never shows it, even to a logged-in admin.
  const wantsPreview = req.query.preview === '1' && !!(req.session && req.session.isAdmin);
  const published = !!season.awards_published_at;
  const ctx = loadContext({ all, get }, getSettings());
  const describe = (r) => ({ ...achievements.describe(r.achievement_id), player_id: r.player_id, name: r.name, season_name: season.name });

  let awardRows = [];
  if (published) {
    awardRows = all(
      `SELECT a.achievement_id, a.player_id, p.name, a.value
       FROM season_awards a LEFT JOIN players p ON p.id = a.player_id
       WHERE a.season_id = ? ORDER BY p.name COLLATE NOCASE, a.id`,
      [season.id]
    );
  } else if (wantsPreview) {
    awardRows = achievements.evaluateSeason(ctx, season.id);
  }

  res.json({
    season: { id: season.id, name: season.name },
    published,
    preview: !published && wantsPreview,
    awards: groupAwards(awardRows),
    milestones: achievements.evaluateCareer(ctx).filter((m) => m.season_id === season.id).map(describe),
    upcoming: achievements.upcoming(ctx, season.id).map((u) => ({ ...describe(u), remaining: u.remaining })),
  });
});

// ---------- Backup / restore ----------
// Used to move data between environments (e.g. local -> a fresh host), since the
// database file itself typically isn't something you can just copy across hosts.
const BACKUP_TABLES = ['players', 'seasons', 'season_rosters', 'match_weeks', 'match_entries', 'season_awards'];
// Backups made before a table existed don't have it, and that's fine.
const OPTIONAL_BACKUP_TABLES = new Set(['season_awards']);

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
    if (dump[table] === undefined && OPTIONAL_BACKUP_TABLES.has(table)) dump[table] = [];
    if (!Array.isArray(dump[table])) {
      return res.status(400).json({ error: `Backup file is missing or has an invalid "${table}" section.` });
    }
  }
  // Column names come from the uploaded file and end up in the SQL text (they can't be
  // bound as parameters), so only names that really exist on the table are allowed.
  // Everything is checked before the first insert so a bad file changes nothing.
  const allowedColumns = Object.fromEntries(
    BACKUP_TABLES.map((t) => [t, new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name))])
  );
  for (const table of BACKUP_TABLES) {
    for (const row of dump[table]) {
      if (row === null || typeof row !== 'object' || Array.isArray(row)) {
        return res.status(400).json({ error: `"${table}" contains a row that isn't an object.` });
      }
      for (const [col, value] of Object.entries(row)) {
        if (!allowedColumns[table].has(col)) {
          return res.status(400).json({ error: `"${table}" has an unknown column: ${col.slice(0, 40)}` });
        }
        if (value !== null && !['string', 'number'].includes(typeof value)) {
          return res.status(400).json({ error: `"${table}" column ${col} has an unsupported value.` });
        }
      }
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
