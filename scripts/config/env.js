window.__APP_CONFIG__ = Object.assign({}, window.__APP_CONFIG__, {
  SUPABASE_URL: 'https://fanimwzslunaxybpryll.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhbmltd3pzbHVuYXh5YnByeWxsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0ODI1NzIsImV4cCI6MjA4NzA1ODU3Mn0.nsjSwBLineL_HMS_HfMzGsmQOWY5WGX0VxsUS5vLzLU',
  SPOTIFY_CLIENT_ID: '79a95a0dcde843e19634096ccfdf942e',
  SPOTIFY_REDIRECT_URI: 'https://icarustypebeta.vercel.app'
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
