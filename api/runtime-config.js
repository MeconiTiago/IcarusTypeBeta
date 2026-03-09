function toSafeString(value) {
  if (value == null) return '';
  return String(value);
}

function escJs(value) {
  return toSafeString(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

module.exports = (req, res) => {
  const payload = [
    "window.__APP_CONFIG__ = Object.assign({}, window.__APP_CONFIG__, {",
    `  SUPABASE_URL: '${escJs(process.env.SUPABASE_URL)}',`,
    `  SUPABASE_ANON_KEY: '${escJs(process.env.SUPABASE_ANON_KEY)}',`,
    `  SPOTIFY_CLIENT_ID: '${escJs(process.env.SPOTIFY_CLIENT_ID)}',`,
    `  SPOTIFY_REDIRECT_URI: '${escJs(process.env.SPOTIFY_REDIRECT_URI)}'`,
    '});'
  ].join('\n');

  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.status(200).send(payload);
};
