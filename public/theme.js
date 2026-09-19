// Applies the admin-configured accent color on every page. Runs before app.js so the
// theme is in place before content renders. Falls back silently to the CSS defaults in
// styles.css if the request fails - never blocks the page on this.
(function () {
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

  fetch('/api/app-settings')
    .then((res) => (res.ok ? res.json() : null))
    .then((settings) => {
      if (settings && settings.accent_color) applyAccent(settings.accent_color);
    })
    .catch(() => {});
})();
