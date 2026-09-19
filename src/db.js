import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// DATA_DIR lets a host point this at a persistent volume (e.g. Railway) instead of the
// project folder, which may not survive redeploys.
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'pool.db');
export const db = new DatabaseSync(dbPath);

db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  is_original INTEGER NOT NULL DEFAULT 0,
  joined_date TEXT,
  left_date TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS seasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  start_date TEXT,
  end_date TEXT,
  is_active INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS season_rosters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'Member',
  pick_status TEXT NOT NULL DEFAULT 'Regular',
  UNIQUE(season_id, player_id)
);

CREATE TABLE IF NOT EXISTS match_weeks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  week_number INTEGER,
  label TEXT,
  match_date TEXT,
  opponent TEXT,
  venue TEXT,
  score_for INTEGER,
  score_against INTEGER,
  is_aggregate INTEGER NOT NULL DEFAULT 0,
  is_bye INTEGER NOT NULL DEFAULT 0,
  UNIQUE(season_id, week_number)
);

-- singles_lost/doubles_lost are nullable: NULL means losses weren't recorded
-- (used for imported season-total rows), so frame win% excludes them rather than assuming 0 losses.
CREATE TABLE IF NOT EXISTS match_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_id INTEGER NOT NULL REFERENCES match_weeks(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  singles_won INTEGER NOT NULL DEFAULT 0,
  singles_lost INTEGER,
  doubles_won INTEGER NOT NULL DEFAULT 0,
  doubles_lost INTEGER,
  appearances INTEGER NOT NULL DEFAULT 1,
  UNIQUE(week_id, player_id)
);

-- Single-row table (id is always 1) holding the league's scoring formula, so it can be
-- changed from the admin UI instead of being hardcoded, should the league ever change it.
CREATE TABLE IF NOT EXISTS league_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  points_per_singles_win REAL NOT NULL DEFAULT 3,
  points_per_doubles_win REAL NOT NULL DEFAULT 1,
  points_per_frame_won REAL NOT NULL DEFAULT 1,
  match_win_bonus REAL NOT NULL DEFAULT 1
);

-- Single-row table (id is always 1) holding app-wide branding. Starts with the same
-- crimson used in styles.css, so switching this on changes nothing until an admin picks
-- a different color.
CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  accent_color TEXT NOT NULL DEFAULT '#b3182b'
);
`);

db.exec('INSERT OR IGNORE INTO league_settings (id) VALUES (1)');
db.exec('INSERT OR IGNORE INTO app_settings (id) VALUES (1)');

// Migrate older databases created before venue/score/is_bye columns existed.
const matchWeekColumns = db.prepare("PRAGMA table_info(match_weeks)").all().map((c) => c.name);
for (const [col, type] of [['venue', 'TEXT'], ['score_for', 'INTEGER'], ['score_against', 'INTEGER'], ['is_bye', 'INTEGER NOT NULL DEFAULT 0']]) {
  if (!matchWeekColumns.includes(col)) {
    db.exec(`ALTER TABLE match_weeks ADD COLUMN ${col} ${type}`);
  }
}

// One-time, idempotent backfill: weeks already marked "BYE" by opponent name (the old
// convention) get the new flag set automatically. Never clears a flag someone has set/unset.
db.exec(`UPDATE match_weeks SET is_bye = 1 WHERE is_bye = 0 AND LOWER(TRIM(opponent)) = 'bye'`);
