import { db } from './db.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seedPath = path.join(__dirname, '..', 'import', 'seed_data.json');
const seed = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));

const existing = db.prepare('SELECT COUNT(*) AS c FROM players').get();
if (existing.c > 0) {
  console.log(`Database already has ${existing.c} players. Refusing to re-seed (would create duplicates).`);
  console.log('Delete data/pool.db first if you want to re-import from scratch.');
  process.exit(0);
}

const insertPlayer = db.prepare(
  'INSERT INTO players (name, is_original, left_date, notes) VALUES (?, ?, ?, ?)'
);
const getPlayerId = db.prepare('SELECT id FROM players WHERE name = ?');
const insertSeason = db.prepare(
  'INSERT INTO seasons (name, is_active, sort_order) VALUES (?, ?, ?)'
);
const insertRoster = db.prepare(
  'INSERT INTO season_rosters (season_id, player_id, role, pick_status) VALUES (?, ?, ?, ?)'
);
const insertWeek = db.prepare(
  `INSERT INTO match_weeks (season_id, week_number, label, is_aggregate, match_date, opponent, venue, score_for, score_against, is_bye)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const insertEntry = db.prepare(
  `INSERT INTO match_entries (week_id, player_id, singles_won, singles_lost, doubles_won, doubles_lost, appearances)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);

const playerIds = {};

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
function parseLeaveDate(text) {
  // e.g. "26th May 2025" -> "2025-05-26"
  const m = /(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})/.exec(text || '');
  if (!m) return null;
  const day = Number(m[1]);
  const monthIndex = MONTHS.indexOf(m[2].toLowerCase());
  if (monthIndex === -1) return null;
  const month = String(monthIndex + 1).padStart(2, '0');
  const dayStr = String(day).padStart(2, '0');
  return `${m[3]}-${month}-${dayStr}`;
}

db.exec('BEGIN');
try {
  for (const p of seed.players) {
    const parsedLeftDate = parseLeaveDate(p.left_date_text);
    const leftDateNote = p.left_date_text && !parsedLeftDate ? `Left: ${p.left_date_text} (from original spreadsheet, could not parse exact date)` : null;
    const exMemberNote = p.is_ex_member && !p.left_date_text ? 'Ex-member; no leave date recorded in original spreadsheet' : null;
    const notes = [p.notes, leftDateNote, exMemberNote].filter(Boolean).join('; ') || null;
    insertPlayer.run(p.name, p.is_original ? 1 : 0, parsedLeftDate, notes);
    playerIds[p.name] = getPlayerId.get(p.name).id;
  }

  for (const [seasonName, s] of Object.entries(seed.seasons)) {
    insertSeason.run(seasonName, s.is_active ? 1 : 0, s.sort_order);
    const seasonId = db.prepare('SELECT id FROM seasons WHERE name = ?').get(seasonName).id;

    for (const r of s.roster) {
      insertRoster.run(seasonId, playerIds[r.name], r.role, r.pick_status);
    }

    if (s.match_rows) {
      const weekIds = {};
      const detailsByWeek = {};
      (s.week_details || []).forEach((d) => { detailsByWeek[d.week_number] = d; });
      // Union of weeks with player frame data AND weeks that only have match-level details
      // (e.g. a BYE week has no player entries, since nobody actually played that week).
      const weekNumbers = [...new Set([
        ...s.match_rows.map((r) => r.week),
        ...Object.keys(detailsByWeek).map(Number),
      ])].sort((a, b) => a - b);
      for (const wn of weekNumbers) {
        const d = detailsByWeek[wn] || {};
        insertWeek.run(
          seasonId, wn, `Week ${wn}`, 0,
          d.match_date ?? null,
          d.opponent ?? null,
          d.venue ?? null,
          d.score_for ?? null,
          d.score_against ?? null,
          d.is_bye ? 1 : 0
        );
        weekIds[wn] = db.prepare('SELECT id FROM match_weeks WHERE season_id = ? AND week_number = ?').get(seasonId, wn).id;
      }
      for (const row of s.match_rows) {
        insertEntry.run(
          weekIds[row.week],
          playerIds[row.name],
          row.singles_won,
          row.singles_lost,
          row.doubles_won,
          row.doubles_lost,
          1
        );
      }
    }

    if (s.aggregate_stats) {
      insertWeek.run(seasonId, null, 'Season Total (imported, no weekly breakdown available)', 1, null, null, null, null, null, 0);
      const weekId = db.prepare(
        'SELECT id FROM match_weeks WHERE season_id = ? AND is_aggregate = 1'
      ).get(seasonId).id;
      for (const row of s.aggregate_stats) {
        if (!row.weeks_played) continue;
        insertEntry.run(
          weekId,
          playerIds[row.name],
          row.singles_won || 0,
          null,
          row.doubles_won || 0,
          null,
          row.weeks_played
        );
      }
    }
  }

  db.exec('COMMIT');
  console.log('Seed complete.');
  console.log('Players:', seed.players.length);
  console.log('Seasons:', Object.keys(seed.seasons).join(', '));
} catch (err) {
  db.exec('ROLLBACK');
  console.error('Seed failed, rolled back:', err);
  process.exit(1);
}
