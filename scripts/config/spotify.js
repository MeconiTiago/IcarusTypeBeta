import { APP_CONFIG } from './runtime-config.js';

export const SPOTIFY_CLIENT_ID = APP_CONFIG.SPOTIFY_CLIENT_ID;
export const SPOTIFY_REDIRECT_URI = APP_CONFIG.SPOTIFY_REDIRECT_URI;
export const SPOTIFY_SCOPES = [
  'user-read-recently-played',
  'streaming',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing'
];

export function getSpotifyRedirectUri() {
  if (/^https?:\/\//i.test(SPOTIFY_REDIRECT_URI)) {
    return SPOTIFY_REDIRECT_URI;
  }
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
