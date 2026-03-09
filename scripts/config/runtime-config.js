function getConfigObject() {
  const root = typeof globalThis !== 'undefined' ? globalThis : {};
  const cfg = root.__APP_CONFIG__;
  if (!cfg || typeof cfg !== 'object') return {};
  return cfg;
}

function readConfigValue(key, fallback = '') {
  const value = getConfigObject()[key];
  if (typeof value === 'string') {
    return value.trim();
  }
  if (value == null) return fallback;
  return String(value).trim();
}

export const APP_CONFIG = Object.freeze({
  SUPABASE_URL: readConfigValue('SUPABASE_URL', ''),
  SUPABASE_ANON_KEY: readConfigValue('SUPABASE_ANON_KEY', ''),
  SPOTIFY_CLIENT_ID: readConfigValue('SPOTIFY_CLIENT_ID', ''),
  SPOTIFY_REDIRECT_URI: readConfigValue('SPOTIFY_REDIRECT_URI', '')
});
