// Applies admin-configured branding (accent color, team name, logo) on every page.
// The brand name/logo stay hidden until settings arrive so a renamed team never flashes
// the default name; if the request fails they're revealed with the built-in defaults.
(function () {
  const initialTitle = document.title;

  // Shared by every page: names, opponents, venues etc. are free text an admin typed,
  // so anything interpolated into innerHTML goes through this first.
  window.escapeHtml = (value) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  function shade(hex, percent) {
    const num = parseInt(hex.slice(1), 16);
    const amt = Math.round(2.55 * percent);
    const r = Math.max(Math.min(255, (num >> 16) + amt), 0);
    const g = Math.max(Math.min(255, ((num >> 8) & 0x00ff) + amt), 0);
    const b = Math.max(Math.min(255, (num & 0x0000ff) + amt), 0);
    return '#' + (0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1);
  }

  function applyAccent(hex) {
    const root = document.documentElement.style;
    root.setProperty('--crimson', hex);
    root.setProperty('--crimson-dark', shade(hex, -25));
    root.setProperty('--crimson-light', shade(hex, 25));
  }
  window.applyAccent = applyAccent;

  function whenReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  function applyIdentity(settings) {
    document.querySelectorAll('.brand-team').forEach((el) => (el.textContent = settings.team_name));
    document.querySelectorAll('.brand-logo').forEach((el) => {
      if (!el.dataset.defaultSrc) el.dataset.defaultSrc = el.getAttribute('src');
      el.src = settings.has_logo ? `/api/logo?v=${settings.logo_version}` : el.dataset.defaultSrc;
    });
    // Static titles read "<page> — <team>"; pages that set their own title later
    // (e.g. a player's name) are left alone.
    if (document.title === initialTitle && initialTitle.includes(' — ')) {
      document.title = initialTitle.split(' — ')[0] + ' — ' + settings.team_name;
    }
  }
  window.applyIdentity = applyIdentity;

  fetch('/api/app-settings')
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null)
    .then((settings) => {
      if (settings && settings.accent_color) applyAccent(settings.accent_color);
      whenReady(() => {
        if (settings) applyIdentity(settings);
        document.documentElement.classList.add('brand-ready');
      });
    });
})();
