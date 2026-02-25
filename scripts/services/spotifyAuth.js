import { SPOTIFY_CLIENT_ID, SPOTIFY_SCOPES, getSpotifyRedirectUri } from '../config/spotify.js';

const SPOTIFY_AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const TOKEN_SAFETY_WINDOW_MS = 60 * 1000;

const STORAGE_KEYS = {
  accessToken: 'sp_access_token',
  refreshToken: 'sp_refresh_token',
  expiresAt: 'sp_expires_at',
  scope: 'sp_scope',
  pkceVerifier: 'sp_pkce_verifier',
  pkceState: 'sp_pkce_state'
};

const REQUIRED_SPOTIFY_SCOPES = ['user-read-recently-played'];
const OPTIONAL_PLAYBACK_SCOPES = [
  'streaming',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing'
];

function normalizeScopeList(scopeValue = '') {
  return String(scopeValue || '')
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function getMissingRequiredScopes(scopeValue = '') {
  const available = new Set(normalizeScopeList(scopeValue));
  return REQUIRED_SPOTIFY_SCOPES.filter((scope) => !available.has(scope));
}

function assertRequiredScopes(scopeValue = '') {
  const missing = getMissingRequiredScopes(scopeValue);
  if (missing.length > 0) {
    const err = new Error(`Spotify token sem scopes obrigatorios: ${missing.join(', ')}`);
    err.code = 'insufficient_scope_relogin';
    err.missingScopes = missing;
    throw err;
  }
}

function randomString(length = 64) {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let output = '';
  for (let i = 0; i < bytes.length; i += 1) {
    output += charset[bytes[i] % charset.length];
  }
  return output;
}

function base64UrlEncode(bytes) {
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function generateCodeChallenge(verifier) {
  const encoded = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  return base64UrlEncode(new Uint8Array(hash));
}

async function requestToken(formParams) {
  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formParams.toString()
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(payload.error_description || payload.error || `Spotify token error (${response.status})`);
    err.code = payload.error || `http_${response.status}`;
    err.status = response.status;
    throw err;
  }
  return payload;
}

function writeTokens(tokenPayload) {
  const expiresInSeconds = Number(tokenPayload?.expires_in || 3600);
  const expiresAt = Date.now() + (expiresInSeconds * 1000);
  const existingScope = localStorage.getItem(STORAGE_KEYS.scope) || '';
  const resolvedScope = String(tokenPayload?.scope || existingScope || '').trim();
  if (tokenPayload?.access_token) {
    localStorage.setItem(STORAGE_KEYS.accessToken, tokenPayload.access_token);
  }
  if (tokenPayload?.refresh_token) {
    localStorage.setItem(STORAGE_KEYS.refreshToken, tokenPayload.refresh_token);
  }
  if (resolvedScope) {
    localStorage.setItem(STORAGE_KEYS.scope, resolvedScope);
  }
  localStorage.setItem(STORAGE_KEYS.expiresAt, String(expiresAt));
}

function readStoredTokens() {
  const accessToken = localStorage.getItem(STORAGE_KEYS.accessToken) || '';
  const refreshToken = localStorage.getItem(STORAGE_KEYS.refreshToken) || '';
  const expiresAt = Number(localStorage.getItem(STORAGE_KEYS.expiresAt) || '0');
  const scope = localStorage.getItem(STORAGE_KEYS.scope) || '';
  return {
    accessToken,
    refreshToken,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
    scope
  };
}

function cleanCallbackUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete('code');
  url.searchParams.delete('error');
  url.searchParams.delete('state');
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState({}, document.title, next || '/');
}

export async function spotifyLogin() {
  const redirectUri = getSpotifyRedirectUri();
  if (!SPOTIFY_CLIENT_ID || !redirectUri) {
    throw new Error('Spotify config is missing client id or redirect uri.');
  }
  const codeVerifier = randomString(64);
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const authState = randomString(32);

  sessionStorage.setItem(STORAGE_KEYS.pkceVerifier, codeVerifier);
  sessionStorage.setItem(STORAGE_KEYS.pkceState, authState);

  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SPOTIFY_SCOPES.join(' '),
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    state: authState
  });
  window.location.assign(`${SPOTIFY_AUTHORIZE_URL}?${params.toString()}`);
}

export async function exchangeCodeForToken(code) {
  const redirectUri = getSpotifyRedirectUri();
  const verifier = sessionStorage.getItem(STORAGE_KEYS.pkceVerifier) || '';
  if (!verifier) {
    const err = new Error('Missing PKCE verifier.');
    err.code = 'missing_pkce_verifier';
    throw err;
  }
  const form = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier
  });
  const payload = await requestToken(form);
  sessionStorage.removeItem(STORAGE_KEYS.pkceVerifier);
  sessionStorage.removeItem(STORAGE_KEYS.pkceState);
  return payload;
}

export async function spotifyHandleCallback() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const callbackState = url.searchParams.get('state');
  const expectedState = sessionStorage.getItem(STORAGE_KEYS.pkceState) || '';

  if (!code && !error) return false;

  if (error) {
    cleanCallbackUrl();
    const err = new Error(error);
    err.code = error;
    throw err;
  }

  if (expectedState && callbackState && expectedState !== callbackState) {
    cleanCallbackUrl();
    const err = new Error('Invalid OAuth state.');
    err.code = 'invalid_state';
    throw err;
  }

  const payload = await exchangeCodeForToken(code);
  assertRequiredScopes(payload?.scope || '');
  writeTokens(payload);
  cleanCallbackUrl();
  return true;
}

export async function refreshAccessToken() {
  const refreshToken = localStorage.getItem(STORAGE_KEYS.refreshToken) || '';
  if (!refreshToken) {
    const err = new Error('Missing refresh token.');
    err.code = 'missing_refresh_token';
    throw err;
  }
  const form = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  });
  const payload = await requestToken(form);
  if (!payload.refresh_token) payload.refresh_token = refreshToken;
  const scopeFromPayloadOrStorage = String(payload?.scope || localStorage.getItem(STORAGE_KEYS.scope) || '').trim();
  assertRequiredScopes(scopeFromPayloadOrStorage);
  writeTokens(payload);
  return payload.access_token || '';
}

export async function getValidAccessToken() {
  const { accessToken, expiresAt, scope } = readStoredTokens();
  try {
    assertRequiredScopes(scope);
  } catch (error) {
    spotifyLogout();
    throw error;
  }
  if (accessToken && expiresAt > (Date.now() + TOKEN_SAFETY_WINDOW_MS)) {
    return accessToken;
  }
  return refreshAccessToken();
}

export function spotifyLogout() {
  localStorage.removeItem(STORAGE_KEYS.accessToken);
  localStorage.removeItem(STORAGE_KEYS.refreshToken);
  localStorage.removeItem(STORAGE_KEYS.expiresAt);
  localStorage.removeItem(STORAGE_KEYS.scope);
  sessionStorage.removeItem(STORAGE_KEYS.pkceVerifier);
  sessionStorage.removeItem(STORAGE_KEYS.pkceState);
}

export function isSpotifyLoggedIn() {
  const accessToken = localStorage.getItem(STORAGE_KEYS.accessToken) || '';
  const refreshToken = localStorage.getItem(STORAGE_KEYS.refreshToken) || '';
  const scope = localStorage.getItem(STORAGE_KEYS.scope) || '';
  if (!accessToken && !refreshToken) return false;
  if (!scope) return true;
  return getMissingRequiredScopes(scope).length === 0;
}

export function hasSpotifyPlaybackScopes(scopeValue = '') {
  const sourceScope = String(scopeValue || localStorage.getItem(STORAGE_KEYS.scope) || '');
  const available = new Set(normalizeScopeList(sourceScope));
  return OPTIONAL_PLAYBACK_SCOPES.every((scope) => available.has(scope));
}

export function getStoredSpotifyTokens() {
  return readStoredTokens();
}

export function setStoredSpotifyTokens(tokens = {}) {
  const accessToken = String(tokens.accessToken || '').trim();
  const refreshToken = String(tokens.refreshToken || '').trim();
  const expiresAtNum = Number(tokens.expiresAt || 0);
  const expiresAt = Number.isFinite(expiresAtNum) && expiresAtNum > 0 ? Math.floor(expiresAtNum) : 0;
  const hasScopeField = Object.prototype.hasOwnProperty.call(tokens, 'scope');
  const scope = String(tokens.scope || '').trim();

  if (accessToken) localStorage.setItem(STORAGE_KEYS.accessToken, accessToken);
  else localStorage.removeItem(STORAGE_KEYS.accessToken);

  if (refreshToken) localStorage.setItem(STORAGE_KEYS.refreshToken, refreshToken);
  else localStorage.removeItem(STORAGE_KEYS.refreshToken);

  if (expiresAt > 0) localStorage.setItem(STORAGE_KEYS.expiresAt, String(expiresAt));
  else localStorage.removeItem(STORAGE_KEYS.expiresAt);

  if (hasScopeField) {
    if (scope) localStorage.setItem(STORAGE_KEYS.scope, scope);
    else localStorage.removeItem(STORAGE_KEYS.scope);
  }
}

export function describeSpotifyAuthError(error) {
  const code = error?.code || error?.message || '';
  const message = String(error?.message || '');
  if (code === 'invalid_redirect_uri') {
    return 'Spotify redirect invalido. Confira o Redirect URI no dashboard e no app.';
  }
  if (message.toLowerCase().includes('redirect')) {
    return 'Spotify redirect invalido. Confira o Redirect URI no dashboard e no app.';
  }
  if (code === 'missing_refresh_token' || code === 'invalid_grant') {
    return 'Sessao Spotify expirada e sem refresh token. Faca login novamente.';
  }
  if (code === 'insufficient_scope_relogin') {
    return 'Spotify conectado com permissao incompleta. Re-vincule para conceder scopes de playback.';
  }
  if (code === 'missing_pkce_verifier') {
    return 'Falha no PKCE verifier. Inicie o login Spotify novamente.';
  }
  if (code === 'invalid_state') {
    return 'Estado de seguranca invalido no retorno do Spotify. Tente logar novamente.';
  }
  if (typeof error?.status === 'number' && (error.status === 401 || error.status === 403)) {
    return 'Sessao Spotify invalida (401/403). Entre novamente.';
  }
  if (message.toLowerCase().includes('failed to fetch')) {
    return 'Falha de rede ao falar com Spotify. Verifique CSP/connect-src, internet e Redirect URI cadastrado para este dominio.';
  }
  return error?.message || 'Nao foi possivel autenticar com Spotify.';
}
