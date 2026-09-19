const error = new URLSearchParams(window.location.search).get('error');
if (error) {
  const hint = document.getElementById('loginError');
  if (error === '2') hint.textContent = 'Too many failed attempts. Try again in 15 minutes.';
  hint.hidden = false;
}
