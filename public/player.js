const $ = (sel) => document.querySelector(sel);

async function api(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

function formChip(result) {
  const cls = result === 'W' ? 'form-w' : result === 'L' ? 'form-l' : 'form-split';
  const label = result === 'W' ? 'W' : result === 'L' ? 'L' : 'S';
  const title = result === 'W' ? 'Won' : result === 'L' ? 'Lost' : 'Split (won one frame, lost the other)';
  return `<span class="form-chip ${cls}" title="${title}">${label}</span>`;
}

function frameCell(won, lost) {
  return lost == null ? `${won}` : `${won}-${lost}`;
}

function notFound() {
  $('#playerName').textContent = 'Player not found';
  document.querySelectorAll('.kpi-row-title, .kpi-row, .panel-header, .table-scroll').forEach((el) => (el.hidden = true));
}

(async function init() {
  const playerId = new URLSearchParams(location.search).get('id');
  if (!playerId) return notFound();

  let data;
  try {
    data = await api(`/api/players/${playerId}/profile`);
  } catch (err) {
    return notFound();
  }

  document.title = `FrameIQ — ${data.player.name}`;
  $('#playerName').textContent = data.player.name;

  const badges = [];
  if (data.player.is_original) badges.push('<span class="pill">Original Member</span>');
  if (data.player.left_date) badges.push(`<span class="pill ex">Left ${escapeHtml(data.player.left_date)}</span>`);
  $('#playerBadges').innerHTML = badges.join('');

  const c = data.career;
  $('#kpiTotalPoints').textContent = c.total_points;
  $('#kpiTotalPointsSub').textContent = `${c.singles_won} singles, ${c.doubles_won} doubles won`;
  $('#kpiAppearances').textContent = c.appearances;
  $('#kpiPointsPerGame').textContent = c.points_per_appearance.toFixed(2);
  $('#kpiFrameWinPct').textContent = c.frame_win_pct == null ? '—' : `${(c.frame_win_pct * 100).toFixed(1)}%`;

  $('#seasonTable tbody').innerHTML = data.seasons
    .map(
      (s) => `<tr>
        <td>${escapeHtml(s.season_name)}</td>
        <td>${s.appearances}</td>
        <td>${s.singles_won}</td>
        <td>${s.doubles_won}</td>
        <td>${s.total_points}</td>
        <td>${s.points_per_appearance.toFixed(2)}</td>
        <td>${s.frame_win_pct == null ? '—' : (s.frame_win_pct * 100).toFixed(1) + '%'}</td>
      </tr>`
    )
    .join('');

  if (!data.matches.length) {
    $('#noMatches').hidden = false;
    return;
  }

  $('#matchHistoryTable tbody').innerHTML = data.matches
    .map((m) => {
      let result = '—';
      let resultClass = '';
      if (m.is_bye) {
        result = 'BYE';
        resultClass = 'result-bye';
      } else if (m.score_for != null && m.score_against != null) {
        if (m.score_for > m.score_against) { result = 'Win'; resultClass = 'result-won'; }
        else if (m.score_for < m.score_against) { result = 'Loss'; resultClass = 'result-lost'; }
        else result = 'Draw';
      }
      const score = m.score_for != null && m.score_against != null ? `${m.score_for}-${m.score_against}` : '—';

      let form = '<span class="hint">—</span>';
      if (m.singles_lost != null) {
        const won = m.singles_won + m.doubles_won;
        const lost = m.singles_lost + m.doubles_lost;
        form = formChip(won > lost ? 'W' : lost > won ? 'L' : 'split');
      }

      return `<tr>
        <td>${escapeHtml(m.season_name)}</td>
        <td>Week ${m.week_number}</td>
        <td>${escapeHtml(m.match_date || '—')}</td>
        <td>${escapeHtml(m.venue || '—')}</td>
        <td>${escapeHtml(m.opponent || '—')}</td>
        <td>${score}</td>
        <td><span class="result-pill ${resultClass}">${result}</span></td>
        <td>${frameCell(m.singles_won, m.singles_lost)}</td>
        <td>${frameCell(m.doubles_won, m.doubles_lost)}</td>
        <td>${form}</td>
      </tr>`;
    })
    .join('');
})();
