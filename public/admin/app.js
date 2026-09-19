const state = {
  seasons: [],
  currentSeasonId: null,
  players: [],
  statsSortKey: 'total_points',
  statsSortDir: 'desc',
  selectedWeekId: null,
  statsView: 'performance',
  formMap: {},
  rosterSortKey: null,
  rosterSortDir: 'asc',
  playersSortKey: null,
  playersSortDir: 'asc',
  h2hSortKey: 'opponent',
  h2hSortDir: 'asc',
};

// Generic sort used by the Roster and Players tables (Stats has its own, unrelated
// to this - left alone). Returns rows unchanged when no key is set, so a table keeps
// its natural API order until the user actually clicks a header.
function sortRows(rows, key, dir) {
  if (!key) return rows;
  return [...rows].sort((a, b) => {
    let av = a[key];
    let bv = b[key];
    if (typeof av === 'string') av = av.toLowerCase();
    if (typeof bv === 'string') bv = bv.toLowerCase();
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

function wireSortableHeaders(tableId, sortKeyProp, sortDirProp, reload) {
  $$(`#${tableId} th[data-key]`).forEach((th) => {
    th.addEventListener('click', () => {
      if (state[sortKeyProp] === th.dataset.key) {
        state[sortDirProp] = state[sortDirProp] === 'asc' ? 'desc' : 'asc';
      } else {
        state[sortKeyProp] = th.dataset.key;
        state[sortDirProp] = 'asc';
      }
      reload();
    });
  });
}

function markSortedHeaders(tableId, sortKeyProp, sortDirProp) {
  $$(`#${tableId} th[data-key]`).forEach((th) => {
    th.classList.toggle('sorted', th.dataset.key === state[sortKeyProp]);
    th.classList.toggle('asc', th.dataset.key === state[sortKeyProp] && state[sortDirProp] === 'asc');
  });
}

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 401) {
    window.location.href = '/admin/login';
    throw new Error('Not authenticated');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

$('#logoutBtn').addEventListener('click', async () => {
  await fetch('/admin/logout', { method: 'POST' });
  window.location.href = '/admin/login';
});

$('#importBtn').addEventListener('click', async () => {
  const file = $('#importFile').files[0];
  if (!file) return alert('Choose a backup JSON file first.');
  if (!confirm('Import this backup? This only works into an empty database and cannot be undone.')) return;
  try {
    const text = await file.text();
    const dump = JSON.parse(text);
    const result = await api('/api/admin/import', { method: 'POST', body: JSON.stringify(dump) });
    alert('Import complete: ' + JSON.stringify(result.imported));
    window.location.reload();
  } catch (err) {
    alert('Import failed: ' + err.message);
  }
});

// ---------- Sidebar (mobile) ----------
$('#sidebarToggle').addEventListener('click', (e) => {
  e.stopPropagation();
  $('#sidebar').classList.toggle('open');
});

document.addEventListener('click', (e) => {
  const sidebar = $('#sidebar');
  if (sidebar.classList.contains('open') && !sidebar.contains(e.target) && e.target.id !== 'sidebarToggle') {
    sidebar.classList.remove('open');
  }
});

// ---------- Tabs ----------
$$('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.tab-btn').forEach((b) => b.classList.remove('active'));
    $$('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    $(`#tab-${btn.dataset.tab}`).classList.add('active');
    $('#sidebar').classList.remove('open');
    refreshCurrentTab();
  });
});

function activeTab() {
  return $('.tab-btn.active').dataset.tab;
}

function refreshCurrentTab() {
  const tab = activeTab();
  if (tab === 'stats') {
    if (state.statsView === 'performance') loadStats();
    else if (state.statsView === 'results') loadResults();
    else loadH2H();
  }
  if (tab === 'matches') loadWeeks();
  if (tab === 'roster') loadRoster();
  if (tab === 'players') loadPlayers();
  if (tab === 'seasons') loadSeasons();
  if (tab === 'settings') loadSettings();
}

// ---------- Season picker ----------
$('#seasonSelect').addEventListener('change', async (e) => {
  state.currentSeasonId = Number(e.target.value);
  await Promise.all([loadKpis(), loadForm()]);
  refreshCurrentTab();
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

// ---------- Stats ----------
$$('.view-toggle-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.view-toggle-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.statsView = btn.dataset.view;
    $('#performanceView').hidden = state.statsView !== 'performance';
    $('#resultsView').hidden = state.statsView !== 'results';
    $('#h2hView').hidden = state.statsView !== 'h2h';
    $('#allTimeToggleWrap').hidden = state.statsView !== 'performance';
    if (state.statsView === 'performance') loadStats();
    else if (state.statsView === 'results') loadResults();
    else loadH2H();
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
        <td><a class="player-link" href="/player.html?id=${r.player_id}" target="_blank" rel="noopener">${escapeHtml(r.name)}</a></td>
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

// ---------- Head-to-head (all-time, not season-scoped) ----------
async function loadH2H() {
  const data = await api('/api/stats/head-to-head');
  renderH2H(data);
}

function renderH2H(data) {
  $('#h2hDrawsHeader').hidden = !data.allow_draws;
  const sorted = sortRows(data.opponents, state.h2hSortKey, state.h2hSortDir);
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
  markSortedHeaders('h2hTable', 'h2hSortKey', 'h2hSortDir');
}

// ---------- Match weeks ----------
async function loadWeeks() {
  if (!state.currentSeasonId) return;
  const weeks = await api(`/api/seasons/${state.currentSeasonId}/weeks`);
  const list = $('#weeksList');
  list.innerHTML = weeks
    .map((w) => {
      const label = w.is_aggregate ? w.label : `Week ${w.week_number}`;
      const bits = [w.match_date, w.venue, w.opponent, (w.score_for != null && w.score_against != null) ? `${w.score_for}-${w.score_against}` : null].filter(Boolean);
      return `<div class="week-chip ${w.id === state.selectedWeekId ? 'selected' : ''}" data-id="${w.id}">
        <span>${escapeHtml(label)}${bits.length ? ' · ' + bits.map(escapeHtml).join(' · ') : ''}</span>
        <span class="del" data-del="${w.id}" title="Delete week">✕</span>
      </div>`;
    })
    .join('');

  list.querySelectorAll('.week-chip').forEach((chip) => {
    chip.addEventListener('click', (e) => {
      if (e.target.dataset.del) return;
      state.selectedWeekId = Number(chip.dataset.id);
      loadWeeks();
      loadWeekEntry();
    });
  });
  list.querySelectorAll('[data-del]').forEach((el) => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this week and all its match entries?')) return;
      await api(`/api/weeks/${el.dataset.del}`, { method: 'DELETE' });
      if (state.selectedWeekId === Number(el.dataset.del)) {
        state.selectedWeekId = null;
        $('#weekEntryPanel').hidden = true;
      }
      loadWeeks();
    });
  });

  if (state.selectedWeekId && weeks.some((w) => w.id === state.selectedWeekId)) {
    loadWeekEntry();
  } else if (!weeks.some((w) => w.id === state.selectedWeekId)) {
    $('#weekEntryPanel').hidden = true;
  }
}

$('#addWeekForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.currentSeasonId) return;
  const week_number = Number($('#newWeekNumber').value);
  const match_date = $('#newWeekDate').value || null;
  const is_bye = $('#newWeekBye').checked;
  const opponent = $('#newWeekOpponent').value || (is_bye ? 'BYE' : null);
  try {
    await api(`/api/seasons/${state.currentSeasonId}/weeks`, {
      method: 'POST',
      body: JSON.stringify({ week_number, match_date, opponent, is_bye }),
    });
    e.target.reset();
    loadWeeks();
  } catch (err) {
    alert(err.message);
  }
});

async function saveWeekDetails() {
  if (!state.selectedWeekId) return;
  await api(`/api/weeks/${state.selectedWeekId}`, {
    method: 'PUT',
    body: JSON.stringify({
      opponent: $('#detailOpponent').value || null,
      match_date: $('#detailDate').value || null,
      venue: $('#detailVenue').value || null,
      score_for: $('#detailScoreFor').value === '' ? null : Number($('#detailScoreFor').value),
      score_against: $('#detailScoreAgainst').value === '' ? null : Number($('#detailScoreAgainst').value),
      is_bye: $('#detailIsBye').checked,
    }),
  });
  loadWeeks();
}

['#detailOpponent', '#detailDate', '#detailVenue', '#detailScoreFor', '#detailScoreAgainst', '#detailIsBye'].forEach((sel) => {
  $(sel).addEventListener('change', saveWeekDetails);
});

function resultOf(won, lost) {
  if (won > 0) return 'won';
  if (lost > 0) return 'lost';
  return 'none';
}

function resultSelect(cssClass, current) {
  const opts = [
    ['none', "Didn't play"],
    ['won', 'Won'],
    ['lost', 'Lost'],
  ];
  return `<select class="${cssClass} result-${current}">
    ${opts.map(([v, label]) => `<option value="${v}" ${v === current ? 'selected' : ''}>${label}</option>`).join('')}
  </select>`;
}

async function loadWeekEntry() {
  const data = await api(`/api/weeks/${state.selectedWeekId}/entries`);
  const panel = $('#weekEntryPanel');
  panel.hidden = false;
  $('#weekEntryTitle').textContent = data.week.is_aggregate ? data.week.label : `Week ${data.week.week_number} entries`;
  const body = $('#weekEntryBody');
  const detailsForm = $('#weekDetailsForm');
  const head = $('#weekEntryHead');

  if (data.week.is_aggregate) {
    detailsForm.hidden = true;
    head.innerHTML = '<tr><th>Player</th><th>Singles Won</th><th>Singles Lost</th><th>Doubles Won</th><th>Doubles Lost</th></tr>';
    $('#weekEntryTitle').textContent += ' — read-only historical import';
    body.innerHTML = data.roster
      .map(
        (r) => `<tr>
          <td>${escapeHtml(r.name)}</td>
          <td>${r.singles_won ?? 0}</td>
          <td>${r.singles_lost ?? 'n/a'}</td>
          <td>${r.doubles_won ?? 0}</td>
          <td>${r.doubles_lost ?? 'n/a'}</td>
        </tr>`
      )
      .join('');
    return;
  }

  head.innerHTML = '<tr><th>Player</th><th>Singles</th><th>Doubles</th></tr>';
  detailsForm.hidden = false;
  $('#detailOpponent').value = data.week.opponent || '';
  $('#detailDate').value = data.week.match_date || '';
  $('#detailVenue').value = data.week.venue || '';
  $('#detailScoreFor').value = data.week.score_for ?? '';
  $('#detailScoreAgainst').value = data.week.score_against ?? '';
  $('#detailIsBye').checked = !!data.week.is_bye;

  body.innerHTML = data.roster
    .map((r) => {
      const singlesResult = resultOf(r.singles_won ?? 0, r.singles_lost ?? 0);
      const doublesResult = resultOf(r.doubles_won ?? 0, r.doubles_lost ?? 0);
      return `<tr data-player="${r.player_id}">
        <td>${escapeHtml(r.name)}</td>
        <td>${resultSelect('singles-result', singlesResult)}</td>
        <td>${resultSelect('doubles-result', doublesResult)}</td>
      </tr>`;
    })
    .join('');

  body.querySelectorAll('tr').forEach((row) => {
    const playerId = row.dataset.player;
    const singlesSelect = row.querySelector('.singles-result');
    const doublesSelect = row.querySelector('.doubles-result');

    const save = async () => {
      if (singlesSelect.value === 'none' && doublesSelect.value === 'none') {
        // Didn't play either frame this week — remove any stored row rather than
        // leaving a zeroed-out entry that would still count as an appearance.
        await api(`/api/weeks/${state.selectedWeekId}/entries/${playerId}`, { method: 'DELETE' });
        return;
      }
      const vals = {
        singles_won: singlesSelect.value === 'won' ? 1 : 0,
        singles_lost: singlesSelect.value === 'lost' ? 1 : 0,
        doubles_won: doublesSelect.value === 'won' ? 1 : 0,
        doubles_lost: doublesSelect.value === 'lost' ? 1 : 0,
      };
      await api(`/api/weeks/${state.selectedWeekId}/entries/${playerId}`, {
        method: 'PUT',
        body: JSON.stringify(vals),
      });
    };

    [singlesSelect, doublesSelect].forEach((select) => {
      select.addEventListener('change', () => {
        select.className = select.className.replace(/result-\S+/, `result-${select.value}`);
        save();
      });
    });
  });

  if (!data.roster.length) {
    body.innerHTML = `<tr><td colspan="3">No players on this season's roster yet. Add them under the Roster tab first.</td></tr>`;
  }
}

// ---------- Roster ----------
async function loadRoster() {
  if (!state.currentSeasonId) return;
  const [roster, players] = await Promise.all([
    api(`/api/seasons/${state.currentSeasonId}/roster`),
    api('/api/players'),
  ]);
  state.players = players;

  const rosterIds = new Set(roster.map((r) => r.player_id));
  const sel = $('#rosterPlayerSelect');
  sel.innerHTML = players
    .filter((p) => !rosterIds.has(p.id))
    .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
    .join('');

  const sortedRoster = sortRows(roster, state.rosterSortKey, state.rosterSortDir);

  const body = $('#rosterBody');
  body.innerHTML = sortedRoster
    .map(
      (r) => `<tr>
        <td>${escapeHtml(r.name)}</td>
        <td>${r.is_original ? '✓' : ''}</td>
        <td>
          <select data-role="${r.player_id}">
            ${['Member', 'Vice-Captain', 'Captain'].map((o) => `<option ${o === r.role ? 'selected' : ''}>${o}</option>`).join('')}
          </select>
        </td>
        <td>
          <select data-pick="${r.player_id}">
            ${['Regular', 'Sub'].map((o) => `<option ${o === r.pick_status ? 'selected' : ''}>${o}</option>`).join('')}
          </select>
        </td>
        <td class="actions"><button class="danger" data-remove="${r.player_id}">Remove</button></td>
      </tr>`
    )
    .join('');
  markSortedHeaders('rosterTable', 'rosterSortKey', 'rosterSortDir');

  body.querySelectorAll('[data-role]').forEach((el) => {
    el.addEventListener('change', () => updateRoster(el.dataset.role));
  });
  body.querySelectorAll('[data-pick]').forEach((el) => {
    el.addEventListener('change', () => updateRoster(el.dataset.pick));
  });
  body.querySelectorAll('[data-remove]').forEach((el) => {
    el.addEventListener('click', async () => {
      if (!confirm('Remove this player from the season roster?')) return;
      await api(`/api/seasons/${state.currentSeasonId}/roster/${el.dataset.remove}`, { method: 'DELETE' });
      loadRoster();
    });
  });
}

async function updateRoster(playerId) {
  const role = $(`[data-role="${playerId}"]`).value;
  const pick_status = $(`[data-pick="${playerId}"]`).value;
  await api(`/api/seasons/${state.currentSeasonId}/roster/${playerId}`, {
    method: 'PUT',
    body: JSON.stringify({ role, pick_status }),
  });
}

$('#addRosterForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const player_id = Number($('#rosterPlayerSelect').value);
  if (!player_id) return alert('No available players to add (everyone is already on this roster).');
  const role = $('#rosterRoleSelect').value;
  const pick_status = $('#rosterPickSelect').value;
  await api(`/api/seasons/${state.currentSeasonId}/roster`, {
    method: 'POST',
    body: JSON.stringify({ player_id, role, pick_status }),
  });
  loadRoster();
});

// ---------- Players ----------
async function loadPlayers() {
  const players = await api('/api/players');
  const sortedPlayers = sortRows(players, state.playersSortKey, state.playersSortDir);
  const body = $('#playersBody');
  body.innerHTML = sortedPlayers
    .map(
      (p) => `<tr data-player-row="${p.id}">
        <td><input type="text" class="f-name" value="${escapeHtml(p.name)}" /></td>
        <td><input type="checkbox" class="f-original" ${p.is_original ? 'checked' : ''} /></td>
        <td><input type="date" class="f-joined" value="${escapeHtml(p.joined_date || '')}" /></td>
        <td><input type="date" class="f-left" value="${escapeHtml(p.left_date || '')}" /></td>
        <td><input type="text" class="f-notes" value="${escapeHtml(p.notes || '')}" /></td>
        <td class="actions"><button class="danger" data-delete="${p.id}">Delete</button></td>
      </tr>`
    )
    .join('');

  body.querySelectorAll('tr[data-player-row]').forEach((row) => {
    const playerId = row.dataset.playerRow;
    const save = async () => {
      await api(`/api/players/${playerId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: row.querySelector('.f-name').value.trim(),
          is_original: row.querySelector('.f-original').checked,
          joined_date: row.querySelector('.f-joined').value || null,
          left_date: row.querySelector('.f-left').value || null,
          notes: row.querySelector('.f-notes').value || null,
        }),
      });
    };
    row.querySelectorAll('input').forEach((input) => input.addEventListener('change', save));
  });

  body.querySelectorAll('[data-delete]').forEach((el) => {
    el.addEventListener('click', async () => {
      const row = el.closest('tr');
      const name = row.querySelector('.f-name').value;
      if (!confirm(`Delete ${name} entirely? This also removes them from any season rosters and match history.`)) return;
      await api(`/api/players/${el.dataset.delete}`, { method: 'DELETE' });
      loadPlayers();
    });
  });

  markSortedHeaders('playersTable', 'playersSortKey', 'playersSortDir');
}

wireSortableHeaders('rosterTable', 'rosterSortKey', 'rosterSortDir', loadRoster);
wireSortableHeaders('playersTable', 'playersSortKey', 'playersSortDir', loadPlayers);
wireSortableHeaders('h2hTable', 'h2hSortKey', 'h2hSortDir', loadH2H);

$('#showAddPlayer').addEventListener('click', () => {
  $('#addPlayerForm').hidden = !$('#addPlayerForm').hidden;
});

$('#addPlayerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#newPlayerName').value.trim();
  if (!name) return;
  await api('/api/players', {
    method: 'POST',
    body: JSON.stringify({
      name,
      is_original: $('#newPlayerOriginal').checked,
      joined_date: $('#newPlayerJoined').value || null,
      left_date: $('#newPlayerLeft').value || null,
      notes: $('#newPlayerNotes').value || null,
    }),
  });
  e.target.reset();
  $('#addPlayerForm').hidden = true;
  loadPlayers();
});

// ---------- Seasons ----------
async function loadSeasons() {
  const seasons = await api('/api/seasons');
  const body = $('#seasonsBody');
  body.innerHTML = seasons
    .map(
      (s) => `<tr>
        <td>${escapeHtml(s.name)}</td>
        <td><input type="date" data-start="${s.id}" value="${escapeHtml(s.start_date || '')}" /></td>
        <td><input type="date" data-end="${s.id}" value="${escapeHtml(s.end_date || '')}" /></td>
        <td><input type="checkbox" data-active="${s.id}" ${s.is_active ? 'checked' : ''} /></td>
        <td class="actions"><button class="danger" data-delseason="${s.id}">Delete</button></td>
      </tr>`
    )
    .join('');

  body.querySelectorAll('[data-start]').forEach((el) =>
    el.addEventListener('change', () => api(`/api/seasons/${el.dataset.start}`, { method: 'PUT', body: JSON.stringify({ start_date: el.value || null }) }))
  );
  body.querySelectorAll('[data-end]').forEach((el) =>
    el.addEventListener('change', () => api(`/api/seasons/${el.dataset.end}`, { method: 'PUT', body: JSON.stringify({ end_date: el.value || null }) }))
  );
  body.querySelectorAll('[data-active]').forEach((el) =>
    el.addEventListener('change', async () => {
      await api(`/api/seasons/${el.dataset.active}`, { method: 'PUT', body: JSON.stringify({ is_active: el.checked }) });
      await loadSeasonPicker();
      loadSeasons();
    })
  );
  body.querySelectorAll('[data-delseason]').forEach((el) =>
    el.addEventListener('click', async () => {
      if (!confirm('Delete this season and all its roster/match data? This cannot be undone.')) return;
      await api(`/api/seasons/${el.dataset.delseason}`, { method: 'DELETE' });
      await loadSeasonPicker();
      loadSeasons();
    })
  );
}

$('#addSeasonForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#newSeasonName').value.trim();
  if (!name) return;
  await api('/api/seasons', { method: 'POST', body: JSON.stringify({ name }) });
  e.target.reset();
  await loadSeasonPicker();
  loadSeasons();
});

// ---------- Settings ----------
async function loadSettings() {
  const [s, a] = await Promise.all([api('/api/settings'), api('/api/app-settings')]);
  $('#setSinglesWin').value = s.points_per_singles_win;
  $('#setDoublesWin').value = s.points_per_doubles_win;
  $('#setFrameWon').value = s.points_per_frame_won;
  $('#setWinBonus').value = s.match_win_bonus;
  $('#setAllowDraws').checked = !!s.allow_draws;
  $('#setShowFooter').checked = !!a.show_footer;
  $('#setAccentColor').value = a.accent_color;
  $('#setTeamName').value = a.team_name;
  resetLogoControls(a);
}

// Logo changes are staged until "Save Settings", like every other field on this page.
const logoState = { file: null, remove: false, hasLogo: false, defaultSrc: $('#logoPreview').getAttribute('src') };

function resetLogoControls(a) {
  logoState.file = null;
  logoState.remove = false;
  logoState.hasLogo = a.has_logo;
  $('#setLogoFile').value = '';
  $('#logoPreview').src = a.has_logo ? `/api/logo?v=${a.logo_version}` : logoState.defaultSrc;
  $('#removeLogoBtn').hidden = !a.has_logo;
}

$('#setLogoFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 1024 * 1024) {
    e.target.value = '';
    return alert('Choose a PNG, JPEG, WebP or GIF image under 1 MB.');
  }
  logoState.file = file;
  logoState.remove = false;
  $('#logoPreview').src = URL.createObjectURL(file);
  $('#removeLogoBtn').hidden = false;
});

$('#removeLogoBtn').addEventListener('click', () => {
  logoState.file = null;
  logoState.remove = logoState.hasLogo;
  $('#setLogoFile').value = '';
  $('#logoPreview').src = logoState.defaultSrc;
  $('#removeLogoBtn').hidden = true;
});

async function saveLogoChange() {
  let res = null;
  if (logoState.file) {
    res = await fetch('/api/logo', { method: 'PUT', headers: { 'Content-Type': logoState.file.type }, body: logoState.file });
  } else if (logoState.remove) {
    res = await fetch('/api/logo', { method: 'DELETE' });
  }
  if (!res) return null;
  if (res.status === 401) {
    window.location.href = '/admin/login';
    throw new Error('Not authenticated');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Logo upload failed: ${res.status}`);
  }
  return res.json();
}

$('#settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  let updatedApp;
  try {
    [, updatedApp] = await Promise.all([
      api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          points_per_singles_win: Number($('#setSinglesWin').value),
          points_per_doubles_win: Number($('#setDoublesWin').value),
          points_per_frame_won: Number($('#setFrameWon').value),
          match_win_bonus: Number($('#setWinBonus').value),
          allow_draws: $('#setAllowDraws').checked,
        }),
      }),
      api('/api/app-settings', {
        method: 'PUT',
        body: JSON.stringify({ accent_color: $('#setAccentColor').value, team_name: $('#setTeamName').value, show_footer: $('#setShowFooter').checked }),
      }),
    ]);
    // Runs after the text settings so a failed upload doesn't lose them; its response
    // (if any) is the freshest view of the branding.
    updatedApp = (await saveLogoChange()) || updatedApp;
  } catch (err) {
    return alert(err.message);
  }
  applyAccent(updatedApp.accent_color);
  applyIdentity(updatedApp);
  resetLogoControls(updatedApp);
  await loadKpis();
  if (activeTab() === 'stats') {
    if (state.statsView === 'performance') loadStats();
    else if (state.statsView === 'h2h') loadH2H();
  }
  alert('Settings saved.');
});

// ---------- Init ----------
(async function init() {
  await loadSeasonPicker();
  await Promise.all([loadKpis(), loadForm()]);
  refreshCurrentTab();
})();
