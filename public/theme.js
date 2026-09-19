// Applies the viewer's light/dark choice and the admin-configured branding (accent color,
// team name, logo) on every page.
// The brand name/logo stay hidden until settings arrive so a renamed team never flashes
// the default name; if the request fails they're revealed with the built-in defaults.
(function () {
  const initialTitle = document.title;

  // Light/dark is a per-viewer preference kept in localStorage (never sent to the server).
  // Default is dark, the app's original look. Set synchronously - this script is in <head> -
  // so the page never paints in the wrong theme first.
  const THEME_KEY = 'frameiq-theme';
  let theme = 'dark';
  try {
    if (localStorage.getItem(THEME_KEY) === 'light') theme = 'light';
  } catch {
    /* storage blocked - stay on the default */
  }
  document.documentElement.dataset.theme = theme;
  let accent = null;

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
    // "light" is the accent as text/hover colour: lighter on dark, darker on light for contrast.
    root.setProperty('--crimson-light', shade(hex, theme === 'light' ? -15 : 25));
    accent = hex;
  }
  window.applyAccent = applyAccent;

  const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

  function updateToggles() {
    const next = theme === 'light' ? 'dark' : 'light';
    document.querySelectorAll('.theme-toggle').forEach((btn) => {
      btn.innerHTML = theme === 'light' ? MOON : SUN; // shows the mode a click switches to
      btn.title = btn.ariaLabel = `Switch to ${next} theme`;
    });
  }

  function setTheme(next) {
    theme = next;
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* not persisted, still applies for this visit */
    }
    if (accent) applyAccent(accent); // re-derive the accent text shade for the new theme
    updateToggles();
  }

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
    document.querySelectorAll('.site-footer').forEach((el) => (el.hidden = !settings.show_footer));
    const updated = document.getElementById('footerUpdated');
    if (updated) {
      updated.hidden = !settings.last_result_date;
      updated.textContent = settings.last_result_date ? `Results last updated ${settings.last_result_date}` : '';
    }
    if (settings.version) document.querySelectorAll('.app-version').forEach((el) => (el.textContent = `FrameIQ v${settings.version}`));
    // Static titles read "<page> — <team>"; pages that set their own title later
    // (e.g. a player's name) are left alone.
    if (document.title === initialTitle && initialTitle.includes(' — ')) {
      document.title = initialTitle.split(' — ')[0] + ' — ' + settings.team_name;
    }
  }
  window.applyIdentity = applyIdentity;

  whenReady(() => {
    updateToggles();
    document.querySelectorAll('.theme-toggle').forEach((btn) => btn.addEventListener('click', () => setTheme(theme === 'light' ? 'dark' : 'light')));
  });

  fetch('/api/app-settings')
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null)
    .then((settings) => {
      if (settings && settings.accent_color) applyAccent(settings.accent_color);
      whenReady(() => {
        updateToggles();
        if (settings) applyIdentity(settings);
        document.documentElement.classList.add('brand-ready');
      });
    });
})();
