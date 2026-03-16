window.__APP_CONFIG__ = Object.assign({}, window.__APP_CONFIG__, {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  SPOTIFY_CLIENT_ID: '',
  SPOTIFY_REDIRECT_URI: ''
});

// Local-only override for non-Vercel development.
(function loadLocalRuntimeConfig() {
  window.__LOCAL_RUNTIME_CONFIG_PROMISE__ = Promise.resolve();
  try {
    var host = String(window.location.hostname || '').toLowerCase();
    var isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (!isLocal) return;
    window.__LOCAL_RUNTIME_CONFIG_PROMISE__ = new Promise(function(resolve) {
      var script = document.createElement('script');
      script.src = 'scripts/config/env.local.js';
      script.async = false;
      script.onload = resolve;
      script.onerror = resolve;
      document.head.appendChild(script);
    });
  } catch (_err) {
    // Ignore optional local override failures.
  }
})();
