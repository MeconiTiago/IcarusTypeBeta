window.__APP_CONFIG__ = Object.assign({}, window.__APP_CONFIG__, {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  SPOTIFY_CLIENT_ID: '',
  SPOTIFY_REDIRECT_URI: ''
});

// Local-only override for non-Vercel development.
(function loadLocalRuntimeConfig() {
  try {
    var host = String(window.location.hostname || '').toLowerCase();
    var isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (!isLocal) return;
    var script = document.createElement('script');
    script.src = 'scripts/config/env.local.js';
    script.async = false;
    document.head.appendChild(script);
  } catch (_err) {
    // Ignore optional local override failures.
  }
})();
