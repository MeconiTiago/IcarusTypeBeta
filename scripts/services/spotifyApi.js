import { getValidAccessToken } from './spotifyAuth.js';

function mapSpotifyApiError(responseStatus, payload) {
  const err = new Error(payload?.error?.message || payload?.error_description || `Spotify API error (${responseStatus})`);
  err.status = responseStatus;
  err.code = payload?.error?.reason || payload?.error || `http_${responseStatus}`;
  return err;
}

export async function spotifyGetRecentlyPlayed(limit = 25) {
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 25));
  const accessToken = await getValidAccessToken();
  const response = await fetch(`https://api.spotify.com/v1/me/player/recently-played?limit=${safeLimit}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw mapSpotifyApiError(response.status, payload);
  }
  return payload;
}

export function normalizeRecentlyPlayed(items) {
  if (!Array.isArray(items)) return [];
  return items.map((entry) => {
    const track = entry?.track || {};
    const artists = Array.isArray(track?.artists) ? track.artists.map((a) => a?.name).filter(Boolean).join(', ') : '';
    const albumImages = Array.isArray(track?.album?.images) ? track.album.images : [];
    return {
      trackName: track?.name || 'Unknown track',
      artists: artists || 'Unknown artist',
      playedAt: entry?.played_at || '',
      trackId: track?.id || '',
      trackUrl: track?.external_urls?.spotify || '',
      albumImage: albumImages[0]?.url || ''
    };
  });
}
