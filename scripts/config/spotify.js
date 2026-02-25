export const SPOTIFY_CLIENT_ID = '79a95a0dcde843e19634096ccfdf942e';
export const SPOTIFY_REDIRECT_URI = 'https://icarustypebeta.vercel.app/';
export const SPOTIFY_SCOPES = [
  'user-read-recently-played',
  'streaming',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing'
];

export function getSpotifyRedirectUri() {
  try {
    const origin = String(window.location.origin || '').trim();
    if (/^https?:\/\//i.test(origin)) {
      return `${origin}/`;
    }
  } catch (_err) {
    // Fallback below
  }
  return SPOTIFY_REDIRECT_URI;
}
