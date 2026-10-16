const STATE_TTL_SECONDS = 10 * 60;
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const COOKIE_STATE = 'changeflow_oauth_state';

export class AuthError extends Error {
  constructor(message, status = 503) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

/** Handle the GitHub App sign-in flow and session endpoints; return null for other paths. */
export async function handleAuthRequest(request, env, authStoreFactory = configuredAuthStore, fetchImpl = fetch, now = () => Date.now()) {
  const url = new URL(request.url);
  const secure = url.protocol === 'https:';
  const sessionCookie = secure ? '__Host-changeflow_session' : 'changeflow_session';
  const authStore = () => authStoreFactory(env);

  if (url.pathname === '/auth/github/start' && request.method === 'GET') {
    assertGithubConfig(env);
    const callbackUrl = validateCallbackUrl(env.GITHUB_APP_CALLBACK_URL, url.origin);
    const state = randomToken();
    await authStore().createOAuthState(await digest(state), now() + STATE_TTL_SECONDS * 1000);
    const authorize = new URL('https://github.com/login/oauth/authorize');
    authorize.searchParams.set('client_id', env.GITHUB_APP_CLIENT_ID);
    authorize.searchParams.set('redirect_uri', callbackUrl);
    authorize.searchParams.set('state', state);
    authorize.searchParams.set('allow_signup', 'false');
    return redirect(authorize.toString(), [cookie(COOKIE_STATE, state, {
      secure, httpOnly: true, sameSite: 'Lax', path: '/auth/github', maxAge: STATE_TTL_SECONDS,
    })]);
  }

  if (url.pathname === '/auth/github/callback' && request.method === 'GET') {
    assertGithubConfig(env);
    const state = url.searchParams.get('state') || '';
    const code = url.searchParams.get('code') || '';
    const cookieState = readCookie(request.headers.get('cookie'), COOKIE_STATE);
    const clearStateCookie = cookie(COOKIE_STATE, '', { secure, httpOnly: true, sameSite: 'Lax', path: '/auth/github', maxAge: 0 });
    if (!state || !code || !cookieState || !constantTimeEqual(state, cookieState)) {
      return redirect('/?auth=failed', [clearStateCookie]);
    }

    const callbackUrl = validateCallbackUrl(env.GITHUB_APP_CALLBACK_URL, url.origin);
    const consumed = await authStore().consumeOAuthState(await digest(state), now());
    if (!consumed) return redirect('/?auth=expired', [clearStateCookie]);

    try {
      const accessToken = await exchangeCode({ env, code, state, callbackUrl, fetchImpl });
      const user = await getGithubUser(accessToken, fetchImpl);
      const sessionToken = randomToken();
      const createdAt = now();
      const expiresAt = createdAt + SESSION_TTL_SECONDS * 1000;
      await authStore().createSession({
        sessionHash: await digest(sessionToken),
        user: { githubUserId: user.id, login: user.login, avatarUrl: user.avatar_url || null },
        createdAt,
        expiresAt,
      });
      return redirect('/?auth=success', [clearStateCookie, cookie(sessionCookie, sessionToken, {
        secure, httpOnly: true, sameSite: 'Lax', path: '/', maxAge: SESSION_TTL_SECONDS,
      })]);
    } catch {
      return redirect('/?auth=failed', [clearStateCookie]);
    }
  }

  if (url.pathname === '/api/auth/me' && request.method === 'GET') {
    const token = readCookie(request.headers.get('cookie'), sessionCookie);
    if (!token) return json({ error: 'unauthorized' }, 401);
    const session = await authStore().getSession(await digest(token), now());
    if (!session) return json({ error: 'unauthorized' }, 401, { 'set-cookie': cookie(sessionCookie, '', { secure, httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 0 }) });
    return json({ user: { id: session.githubUserId, login: session.login, avatarUrl: session.avatarUrl }, expiresAt: new Date(session.expiresAt).toISOString() });
  }

  if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
    if (request.headers.get('origin') !== url.origin) return json({ error: 'origin_mismatch' }, 403);
    const token = readCookie(request.headers.get('cookie'), sessionCookie);
    if (token) await authStore().revokeSession(await digest(token), now());
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store', 'set-cookie': cookie(sessionCookie, '', { secure, httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 0 }) } });
  }

  return null;
}

export class D1AuthStore {
  constructor(db) {
    if (!db) throw new AuthError('Missing D1 binding for authentication.', 503);
    this.db = db;
  }

  async createOAuthState(stateHash, expiresAt) {
    await this.db.prepare('DELETE FROM oauth_states WHERE expires_at <= ?').bind(Date.now()).run();
    await this.db.prepare('DELETE FROM user_sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL').bind(Date.now()).run();
    await this.db.prepare('INSERT INTO oauth_states (state_hash, expires_at) VALUES (?, ?)')
      .bind(stateHash, expiresAt).run();
  }

  async consumeOAuthState(stateHash, now) {
    const result = await this.db.prepare('DELETE FROM oauth_states WHERE state_hash = ? AND expires_at > ?')
      .bind(stateHash, now).run();
    return result.meta.changes === 1;
  }

  async createSession({ sessionHash, user, createdAt, expiresAt }) {
    await this.db.batch([
      this.db.prepare(`INSERT INTO github_users (github_user_id, login, avatar_url, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(github_user_id) DO UPDATE SET login = excluded.login, avatar_url = excluded.avatar_url, updated_at = excluded.updated_at`)
        .bind(user.githubUserId, user.login, user.avatarUrl, createdAt, createdAt),
      this.db.prepare('INSERT INTO user_sessions (session_hash, github_user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
        .bind(sessionHash, user.githubUserId, createdAt, expiresAt),
    ]);
  }

  async getSession(sessionHash, now) {
    return this.db.prepare(`SELECT s.github_user_id AS githubUserId, u.login, u.avatar_url AS avatarUrl, s.expires_at AS expiresAt
      FROM user_sessions s JOIN github_users u ON u.github_user_id = s.github_user_id
      WHERE s.session_hash = ? AND s.expires_at > ? AND s.revoked_at IS NULL`)
      .bind(sessionHash, now).first();
  }

  async revokeSession(sessionHash, now) {
    await this.db.prepare('UPDATE user_sessions SET revoked_at = ? WHERE session_hash = ? AND revoked_at IS NULL')
      .bind(now, sessionHash).run();
  }
}

export class MemoryAuthStore {
  constructor() { this.states = new Map(); this.sessions = new Map(); }
  async createOAuthState(hash, expiresAt) { this.states.set(hash, expiresAt); }
  async consumeOAuthState(hash, now) {
    const expiry = this.states.get(hash);
    this.states.delete(hash);
    return Number.isFinite(expiry) && expiry > now;
  }
  async createSession(session) { this.sessions.set(session.sessionHash, { ...session.user, expiresAt: session.expiresAt, revokedAt: null }); }
  async getSession(hash, now) {
    const session = this.sessions.get(hash);
    return session && session.expiresAt > now && session.revokedAt === null ? session : null;
  }
  async revokeSession(hash, now) { const session = this.sessions.get(hash); if (session) session.revokedAt = now; }
}

function configuredAuthStore(env) {
  return new D1AuthStore(env.AUTH_DB || env.DB);
}

function assertGithubConfig(env) {
  if (!env.GITHUB_APP_CLIENT_ID || !env.GITHUB_APP_CLIENT_SECRET || !env.GITHUB_APP_CALLBACK_URL) {
    throw new AuthError('GitHub App sign-in is not configured.', 503);
  }
}

function validateCallbackUrl(value, requestOrigin) {
  let callback;
  try { callback = new URL(value); } catch { throw new AuthError('GitHub callback URL is invalid.', 503); }
  if (callback.protocol !== 'https:' && callback.hostname !== 'localhost') throw new AuthError('GitHub callback URL must use HTTPS.', 503);
  if (callback.origin !== requestOrigin || callback.pathname !== '/auth/github/callback' || callback.search || callback.hash) {
    throw new AuthError('GitHub callback URL must match this Worker origin and callback path.', 400);
  }
  return callback.toString();
}

async function exchangeCode({ env, code, state, callbackUrl, fetchImpl }) {
  const response = await fetchImpl('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: env.GITHUB_APP_CLIENT_ID, client_secret: env.GITHUB_APP_CLIENT_SECRET, code, redirect_uri: callbackUrl, state }),
  });
  if (!response.ok) throw new AuthError('GitHub token exchange failed.');
  const result = await response.json();
  if (result.error || typeof result.access_token !== 'string') throw new AuthError('GitHub did not return an access token.');
  return result.access_token;
}

async function getGithubUser(accessToken, fetchImpl) {
  const response = await fetchImpl('https://api.github.com/user', {
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${accessToken}`, 'x-github-api-version': '2022-11-28', 'user-agent': 'changeflow-prototype' },
  });
  if (!response.ok) throw new AuthError('GitHub identity lookup failed.');
  const user = await response.json();
  if (!Number.isSafeInteger(user.id) || typeof user.login !== 'string') throw new AuthError('GitHub identity response was invalid.');
  return user;
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toBase64Url(bytes);
}

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function constantTimeEqual(left, right) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) mismatch |= (a[i] || 0) ^ (b[i] || 0);
  return mismatch === 0;
}

function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return null;
}

function cookie(name, value, { secure, httpOnly, sameSite, path, maxAge }) {
  return `${name}=${value}; Path=${path}; Max-Age=${maxAge}; SameSite=${sameSite}${secure ? '; Secure' : ''}${httpOnly ? '; HttpOnly' : ''}`;
}

function redirect(location, cookies = []) {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  for (const value of cookies) headers.append('set-cookie', value);
  return new Response(null, { status: 302, headers });
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders } });
}
