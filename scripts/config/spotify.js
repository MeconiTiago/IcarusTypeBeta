export const SPOTIFY_CLIENT_ID = '79a95a0dcde843e19634096ccfdf942e';
export const SPOTIFY_REDIRECT_URI = 'https://icarustypebeta.vercel.app/';
export const SPOTIFY_SCOPES = ['user-read-recently-played'];

export function getSpotifyRedirectUri() {
  const host = window.location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  if (isLocal) {
    return `${window.location.origin}/`;
  }
  return SPOTIFY_REDIRECT_URI;
}
