// Demo data with every feature showing, for a public demo site.
//
// Loads the standard demo data (see seed.js), then fills in what that data predates: league
// details, a Champions flag, upcoming fixtures, doubles pairs and published season awards.
// Fixture dates are worked out from today, so they never go stale. Safe to run on every
// start: if the database already has players it does nothing.
import { db } from './db.js';
import { createAchievementEngine, loadContext } from './achievements.js';

const all = (sql, params = []) => db.prepare(sql).all(...params);
const get = (sql, params = []) => db.prepare(sql).get(...params);
const run = (sql, params = []) => db.prepare(sql).run(...params);

if (get('SELECT COUNT(*) AS c FROM players').c > 0) {
  console.log('Database already has players. Leaving it as it is.');
  process.exit(0);
}

await import('./seed.js'); // standard demo data (runs on import)

const current = get("SELECT id FROM seasons WHERE name = 'Summer 2026'");
const previous = get("SELECT id FROM seasons WHERE name = 'Winter 25-26'");
if (!current || !previous) {
  console.error('Expected the Summer 2026 and Winter 25-26 demo seasons. Has seed_data.json changed?');
  process.exit(1);
}

db.exec('BEGIN');
try {
  // League details, current position, and a title for the previous season
  run('UPDATE seasons SET league_name = ?, division = ?, league_position = ? WHERE id = ?', ['Tuesday League', 'Division 2', '1st', current.id]);
  run('UPDATE seasons SET league_name = ?, division = ?, league_champions = 1 WHERE id = ?', ['Tuesday League', 'Division 2', previous.id]);

  // Upcoming fixtures: the next three Tuesdays, against teams already in the results
  const opponents = all(
    `SELECT DISTINCT opponent FROM match_weeks
     WHERE season_id = ? AND is_bye = 0 AND opponent IS NOT NULL ORDER BY opponent`,
    [current.id]
  ).map((r) => r.opponent);
  const lastWeek = get('SELECT MAX(week_number) AS n FROM match_weeks WHERE season_id = ? AND is_aggregate = 0', [current.id]).n || 0;
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  do date.setUTCDate(date.getUTCDate() + 1);
  while (date.getUTCDay() !== 2); // Tuesday
  for (let i = 0; i < 3; i++) {
    const n = lastWeek + 1 + i;
    run(
      `INSERT INTO match_weeks (season_id, week_number, label, match_date, opponent, venue, is_aggregate, is_bye)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0)`,
      [current.id, n, `Week ${n}`, date.toISOString().slice(0, 10), opponents[i % opponents.length], i % 2 === 0 ? 'Home' : 'Away']
    );
    date.setUTCDate(date.getUTCDate() + 7);
  }

  // Doubles pairs: partner up players who shared a doubles result each week (up to three pairs)
  const weeks = all('SELECT id FROM match_weeks WHERE season_id = ? AND is_aggregate = 0', [current.id]);
  for (const w of weeks) {
    let slot = 1;
    for (const resultColumn of ['doubles_won', 'doubles_lost']) {
      const group = all(
        `SELECT player_id FROM match_entries WHERE week_id = ? AND ${resultColumn} > 0 ORDER BY player_id`,
        [w.id]
      );
      for (let i = 0; i + 1 < group.length && slot <= 3; i += 2, slot++) {
        run('UPDATE match_entries SET doubles_pair = ? WHERE week_id = ? AND player_id IN (?, ?)', [slot, w.id, group[i].player_id, group[i + 1].player_id]);
      }
    }
  }

  // Publish the current season's awards so the Awards tab and profile badges are populated
  const engine = createAchievementEngine();
  const results = engine.evaluateSeason(loadContext({ all, get }, get('SELECT * FROM league_settings WHERE id = 1')), current.id);
  for (const r of results) {
    run('INSERT INTO season_awards (season_id, achievement_id, player_id, partner_id, value) VALUES (?, ?, ?, ?, ?)', [current.id, r.achievement_id, r.player_id, r.partner_id ?? null, r.value]);
  }
  run('UPDATE seasons SET awards_published_at = ? WHERE id = ?', [Date.now(), current.id]);

  db.exec('COMMIT');
  console.log(`Demo extras added: league details, 3 fixtures, doubles pairs and ${results.length} published awards.`);
} catch (err) {
  db.exec('ROLLBACK');
  console.error('Demo extras failed, rolled back:', err);
  process.exit(1);
}
