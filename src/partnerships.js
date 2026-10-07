// Doubles partnership records, shared by the stats routes and the achievement engine.
//
// A partnership is two players sharing a doubles pair number in the same week with the same
// doubles result. A week where the pair is incomplete or the two results disagree is left out
// (admin Match Entry flags it) rather than guessed at.
export function partnershipRows({ all }, { seasonId = null, playerId = null } = {}) {
  return all(
    `SELECT e1.player_id AS a_id, p1.name AS a_name, e2.player_id AS b_id, p2.name AS b_name,
            COUNT(*) AS played,
            SUM(CASE WHEN e1.doubles_won > 0 THEN 1 ELSE 0 END) AS wins,
            SUM(CASE WHEN e1.doubles_lost > 0 THEN 1 ELSE 0 END) AS losses,
            MAX(w.match_date) AS last_played
     FROM match_entries e1
     JOIN match_entries e2 ON e2.week_id = e1.week_id AND e2.doubles_pair = e1.doubles_pair AND e2.player_id > e1.player_id
     JOIN match_weeks w ON w.id = e1.week_id
     JOIN players p1 ON p1.id = e1.player_id
     JOIN players p2 ON p2.id = e2.player_id
     WHERE e1.doubles_pair IS NOT NULL AND w.is_aggregate = 0
       AND (e1.doubles_won > 0 OR e1.doubles_lost > 0)
       AND NOT (e1.doubles_won > 0 AND e1.doubles_lost > 0)
       AND (e1.doubles_won > 0) = (e2.doubles_won > 0) AND (e1.doubles_lost > 0) = (e2.doubles_lost > 0)
       AND (SELECT COUNT(*) FROM match_entries x WHERE x.week_id = e1.week_id AND x.doubles_pair = e1.doubles_pair) = 2
       AND (? IS NULL OR w.season_id = ?)
       AND (? IS NULL OR e1.player_id = ? OR e2.player_id = ?)
     GROUP BY e1.player_id, e2.player_id`,
    [seasonId, seasonId, playerId, playerId, playerId]
  );
}
