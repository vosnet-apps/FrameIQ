const state = {
  seasons: [],
  currentSeasonId: null,
  statsSortKey: 'total_points',
  statsSortDir: 'desc',
  statsView: 'performance',
  formMap: {},
  h2hSortKey: 'opponent',
  h2hSortDir: 'asc',
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

async function api(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

// ---------- Season picker ----------
$('#seasonSelect').addEventListener('change', async (e) => {
  state.currentSeasonId = Number(e.target.value);
  await Promise.all([loadKpis(), loadForm()]);
  refresh();
});

async function loadSeasonPicker() {
  state.seasons = await api('/api/seasons');
  const sel = $('#seasonSelect');
  sel.innerHTML = state.seasons
    .map((s) => `<option value="${s.id}">${escapeHtml(s.name)}${s.is_active ? ' (active)' : ''}</option>`)
    .join('');
  const active = state.seasons.find((s) => s.is_active) || state.seasons[state.seasons.length - 1];
  state.currentSeasonId = active ? active.id : null;
  if (state.currentSeasonId) sel.value = state.currentSeasonId;
}

function refresh() {
  if (state.statsView === 'performance') loadStats();
  else if (state.statsView === 'results') loadResults();
  else loadH2H();
}

// ---------- View toggle ----------
$$('.view-toggle-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.view-toggle-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.statsView = btn.dataset.view;
    $('#performanceView').hidden = state.statsView !== 'performance';
    $('#resultsView').hidden = state.statsView !== 'results';
    $('#h2hView').hidden = state.statsView !== 'h2h';
    $('#allTimeToggleWrap').hidden = state.statsView !== 'performance';
    refresh();
  });
});

// ---------- KPI cards ----------
async function loadKpis() {
  const allTime = $('#allTimeToggle').checked;
  const url = allTime || !state.currentSeasonId ? '/api/stats/summary' : `/api/stats/summary?season_id=${state.currentSeasonId}`;
  const data = await api(url);
  renderKpis(data);
}

function pointsWord(n) {
  return n === 1 ? 'point' : 'points';
}

function renderKpis(data) {
  const wr = data.win_rate;
  $('#kpiWinRate').textContent = wr.decided_total > 0 ? `${Math.round(wr.pct * 100)}%` : '—';
  const byeNote = wr.byes ? ` (+${wr.byes} BYE)` : '';
  $('#kpiWinRateSub').textContent = wr.decided_total > 0 ? `${wr.wins}W ${wr.losses}L${wr.draws ? ' ' + wr.draws + 'D' : ''}${byeNote}` : (wr.byes ? `${wr.byes} BYE` : '');
  $('#kpiMatchesPlayed').textContent = data.matches_played || '0';
  $('#kpiLeaguePoints').textContent = data.league_points || '0';

  if (data.settings) {
    const s = data.settings;
    $('#kpiLeaguePointsSub').textContent =
      `${s.points_per_frame_won} per frame won, +${s.match_win_bonus} bonus for winning the match`;
    $('#pointsFormulaHint').textContent =
      `${s.points_per_singles_win} ${pointsWord(s.points_per_singles_win)} per singles won, ` +
      `${s.points_per_doubles_win} ${pointsWord(s.points_per_doubles_win)} per doubles won. ` +
      `Frame Win % excludes any imported rows where losses weren't recorded.`;
  }

  if (data.points_leader) {
    $('#kpiPointsLeader').textContent = data.points_leader.name;
    $('#kpiPointsLeaderSub').textContent = `${data.points_leader.total_points} points`;
  } else {
    $('#kpiPointsLeader').textContent = '—';
    $('#kpiPointsLeaderSub').textContent = '';
  }

  if (data.best_frame_win_pct) {
    $('#kpiBestFrame').textContent = `${Math.round(data.best_frame_win_pct.frame_win_pct * 100)}%`;
    $('#kpiBestFrameSub').textContent = data.best_frame_win_pct.name;
  } else {
    $('#kpiBestFrame').textContent = '—';
    $('#kpiBestFrameSub').textContent = '';
  }
}

// ---------- Player form (season-scoped, independent of All-time toggle) ----------
async function loadForm() {
  if (!state.currentSeasonId) {
    state.formMap = {};
    return;
  }
  const rows = await api(`/api/stats/form?season_id=${state.currentSeasonId}`);
  state.formMap = {};
  rows.forEach((r) => {
    state.formMap[r.player_id] = r.form;
  });
}

function formChipsHtml(playerId) {
  const form = state.formMap[playerId] || [];
  if (!form.length) return '<span class="hint">—</span>';
  return `<div class="form-chips">${form
    .map((r) => {
      const cls = r === 'W' ? 'form-w' : r === 'L' ? 'form-l' : 'form-split';
      const label = r === 'W' ? 'W' : r === 'L' ? 'L' : 'S';
      const title = r === 'W' ? 'Won' : r === 'L' ? 'Lost' : 'Split (won one frame, lost the other)';
      return `<span class="form-chip ${cls}" title="${title}">${label}</span>`;
    })
    .join('')}</div>`;
}

// ---------- Performance ----------
async function loadStats() {
  const allTime = $('#allTimeToggle').checked;
  const url = allTime || !state.currentSeasonId ? '/api/stats' : `/api/stats?season_id=${state.currentSeasonId}`;
  const rows = await api(url);
  renderStats(rows);
}

$('#allTimeToggle').addEventListener('change', () => {
  loadKpis();
  loadStats();
});

function renderStats(rows) {
  const sorted = [...rows].sort((a, b) => {
    const dir = state.statsSortDir === 'asc' ? 1 : -1;
    const av = a[state.statsSortKey];
    const bv = b[state.statsSortKey];
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'string') return av.localeCompare(bv) * dir;
    return (av - bv) * dir;
  });
  const tbody = $('#statsTable tbody');
  tbody.innerHTML = sorted
    .map(
      (r) => `<tr>
        <td><a class="player-link" href="/player.html?id=${r.player_id}">${escapeHtml(r.name)}</a></td>
        <td>${r.appearances}</td>
        <td>${r.singles_won}</td>
        <td>${r.doubles_won}</td>
        <td>${r.total_points}</td>
        <td>${r.points_per_appearance.toFixed(2)}</td>
        <td>${r.frame_win_pct == null ? '—' : (r.frame_win_pct * 100).toFixed(1) + '%'}</td>
        <td>${formChipsHtml(r.player_id)}</td>
      </tr>`
    )
    .join('');

  $$('#statsTable th[data-key]').forEach((th) => {
    th.classList.toggle('sorted', th.dataset.key === state.statsSortKey);
    th.classList.toggle('asc', th.dataset.key === state.statsSortKey && state.statsSortDir === 'asc');
  });
}

$$('#statsTable th[data-key]').forEach((th) => {
  th.addEventListener('click', () => {
    if (state.statsSortKey === th.dataset.key) {
      state.statsSortDir = state.statsSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.statsSortKey = th.dataset.key;
      state.statsSortDir = 'desc';
    }
    loadStats();
  });
});

// ---------- Match results ----------
async function loadResults() {
  if (!state.currentSeasonId) return;
  const weeks = await api(`/api/seasons/${state.currentSeasonId}/weeks`);
  const played = weeks.filter((w) => !w.is_aggregate).sort((a, b) => a.week_number - b.week_number);
  const tbody = $('#resultsTable tbody');
  const empty = $('#resultsEmpty');

  if (!played.length) {
    tbody.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  tbody.innerHTML = played
    .map((w) => {
      let result = '—';
      if (w.is_bye) {
        result = 'BYE';
      } else if (w.score_for != null && w.score_against != null) {
        if (w.score_for > w.score_against) result = 'Win';
        else if (w.score_for < w.score_against) result = 'Loss';
        else result = 'Draw';
      }
      const score = w.score_for != null && w.score_against != null ? `${w.score_for}-${w.score_against}` : '—';
      const resultClass = result === 'Win' ? 'result-won' : result === 'Loss' ? 'result-lost' : result === 'BYE' ? 'result-bye' : '';
      return `<tr>
        <td>Week ${w.week_number}</td>
        <td>${escapeHtml(w.match_date || '—')}</td>
        <td>${escapeHtml(w.venue || '—')}</td>
        <td>${escapeHtml(w.opponent || '—')}</td>
        <td>${score}</td>
        <td><span class="result-pill ${resultClass}">${result}</span></td>
      </tr>`;
    })
    .join('');
}

// ---------- Head-to-head (all-time, not season-scoped) ----------
async function loadH2H() {
  const data = await api('/api/stats/head-to-head');
  renderH2H(data);
}

function renderH2H(data) {
  $('#h2hDrawsHeader').hidden = !data.allow_draws;
  const sorted = [...data.opponents].sort((a, b) => {
    const dir = state.h2hSortDir === 'asc' ? 1 : -1;
    const av = a[state.h2hSortKey];
    const bv = b[state.h2hSortKey];
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'string') return av.localeCompare(bv) * dir;
    return (av - bv) * dir;
  });
  const tbody = $('#h2hTable tbody');
  tbody.innerHTML = sorted
    .map(
      (r) => `<tr>
        <td>${escapeHtml(r.opponent)}</td>
        <td>${r.played}</td>
        <td>${r.wins}</td>
        <td>${r.losses}</td>
        ${data.allow_draws ? `<td>${r.draws}</td>` : ''}
        <td>${r.win_pct == null ? '—' : (r.win_pct * 100).toFixed(0) + '%'}</td>
        <td>${r.frames_for}-${r.frames_against} (${r.frame_diff > 0 ? '+' : ''}${r.frame_diff})</td>
        <td>${escapeHtml(r.last_played || '—')}</td>
      </tr>`
    )
    .join('');

  $$('#h2hTable th[data-key]').forEach((th) => {
    th.classList.toggle('sorted', th.dataset.key === state.h2hSortKey);
    th.classList.toggle('asc', th.dataset.key === state.h2hSortKey && state.h2hSortDir === 'asc');
  });
}

$$('#h2hTable th[data-key]').forEach((th) => {
  th.addEventListener('click', () => {
    if (state.h2hSortKey === th.dataset.key) {
      state.h2hSortDir = state.h2hSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.h2hSortKey = th.dataset.key;
      state.h2hSortDir = 'asc';
    }
    loadH2H();
  });
});

// ---------- Init ----------
(async function init() {
  await loadSeasonPicker();
  await Promise.all([loadKpis(), loadForm()]);
  refresh();
})();
