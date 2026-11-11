// Evita parpadeo: aplica el tema antes de pintar (archivo externo para poder usar una CSP sin 'unsafe-inline' en scripts).
try {
  var t = localStorage.getItem('lumenza-theme') || 'system';
  var dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
} catch (e) {}
