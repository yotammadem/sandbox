import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAuthRequest, MemoryAuthStore } from '../src/auth.js';

const NOW = Date.parse('2026-10-16T09:00:00Z');
const env = {
  GITHUB_APP_CLIENT_ID: 'Iv1.test-client',
  GITHUB_APP_CLIENT_SECRET: 'test-client-secret',
  GITHUB_APP_CALLBACK_URL: 'https://changeflow.example/auth/github/callback',
};

function cookieValue(header, name) {
  const item = header.split(';').find((part) => part.trim().startsWith(`${name}=`));
  return item?.trim().slice(name.length + 1);
}

test('GitHub App sign-in validates state, creates an HttpOnly session, and supports logout', async () => {
  const store = new MemoryAuthStore();
  const upstream = [];
  const fetchImpl = async (url, options) => {
    upstream.push({ url: String(url), options });
    if (String(url) === 'https://github.com/login/oauth/access_token') {
      const requestBody = JSON.parse(options.body);
      assert.equal(requestBody.state, callbackState);
      assert.equal(requestBody.redirect_uri, env.GITHUB_APP_CALLBACK_URL);
      return Response.json({ access_token: 'github-short-lived-user-token' });
    }
    if (String(url) === 'https://api.github.com/user') {
      assert.equal(options.headers.authorization, 'Bearer github-short-lived-user-token');
      return Response.json({ id: 1234, login: 'yotam', avatar_url: 'https://avatars.example/yotam.png' });
    }
    throw new Error(`Unexpected upstream request: ${url}`);
  };
  let callbackState;
  const auth = (request) => handleAuthRequest(request, env, () => store, fetchImpl, () => NOW);

  const start = await auth(new Request('https://changeflow.example/auth/github/start'));
  assert.equal(start.status, 302);
  const authorizeUrl = new URL(start.headers.get('location'));
  callbackState = authorizeUrl.searchParams.get('state');
  assert.equal(authorizeUrl.origin, 'https://github.com');
  assert.equal(authorizeUrl.pathname, '/login/oauth/authorize');
  assert.equal(authorizeUrl.searchParams.get('client_id'), env.GITHUB_APP_CLIENT_ID);
  const stateCookie = cookieValue(start.headers.get('set-cookie'), 'changeflow_oauth_state');
  assert.equal(stateCookie, callbackState);
  assert.match(start.headers.get('set-cookie'), /HttpOnly/);
  assert.match(start.headers.get('set-cookie'), /Secure/);
  assert.match(start.headers.get('set-cookie'), /SameSite=Lax/);

  const callback = await auth(new Request(`https://changeflow.example/auth/github/callback?code=mock-code&state=${callbackState}`, {
    headers: { cookie: `changeflow_oauth_state=${stateCookie}` },
  }));
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get('location'), '/?auth=success');
  const cookieHeaders = callback.headers.getSetCookie();
  const sessionCookie = cookieHeaders.find((value) => value.startsWith('__Host-changeflow_session='));
  assert.ok(sessionCookie);
  assert.match(sessionCookie, /HttpOnly/);
  assert.match(sessionCookie, /Secure/);
  assert.match(sessionCookie, /Path=\//);

  const session = cookieValue(sessionCookie, '__Host-changeflow_session');
  const me = await auth(new Request('https://changeflow.example/api/auth/me', { headers: { cookie: `__Host-changeflow_session=${session}` } }));
  assert.equal(me.status, 200);
  assert.deepEqual((await me.json()).user, { id: 1234, login: 'yotam', avatarUrl: 'https://avatars.example/yotam.png' });
  assert.equal(upstream.length, 2);

  const replay = await auth(new Request(`https://changeflow.example/auth/github/callback?code=mock-code&state=${callbackState}`, {
    headers: { cookie: `changeflow_oauth_state=${callbackState}` },
  }));
  assert.equal(replay.headers.get('location'), '/?auth=expired');
  assert.equal(upstream.length, 2);

  const expiredSession = await handleAuthRequest(new Request('https://changeflow.example/api/auth/me', {
    headers: { cookie: `__Host-changeflow_session=${session}` },
  }), env, () => store, fetchImpl, () => NOW + 9 * 60 * 60 * 1000);
  assert.equal(expiredSession.status, 401);

  const badLogout = await auth(new Request('https://changeflow.example/api/auth/logout', {
    method: 'POST', headers: { origin: 'https://attacker.example', cookie: `__Host-changeflow_session=${session}` },
  }));
  assert.equal(badLogout.status, 403);
  const logout = await auth(new Request('https://changeflow.example/api/auth/logout', {
    method: 'POST', headers: { origin: 'https://changeflow.example', cookie: `__Host-changeflow_session=${session}` },
  }));
  assert.equal(logout.status, 204);
  assert.equal((await auth(new Request('https://changeflow.example/api/auth/me', { headers: { cookie: `__Host-changeflow_session=${session}` } }))).status, 401);
});

test('GitHub callback rejects a state mismatch without contacting GitHub and rejects expired state', async () => {
  const store = new MemoryAuthStore();
  let upstreamCalls = 0;
  const fetchImpl = async () => { upstreamCalls += 1; return Response.json({ access_token: 'never-used' }); };
  const auth = (request) => handleAuthRequest(request, env, () => store, fetchImpl, () => NOW);
  const start = await auth(new Request('https://changeflow.example/auth/github/start'));
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const mismatched = await auth(new Request(`https://changeflow.example/auth/github/callback?code=code&state=${state}`, {
    headers: { cookie: 'changeflow_oauth_state=wrong-state' },
  }));
  assert.equal(mismatched.headers.get('location'), '/?auth=failed');
  assert.equal(upstreamCalls, 0);

  const expired = await handleAuthRequest(new Request(`https://changeflow.example/auth/github/callback?code=code&state=${state}`, {
    headers: { cookie: `changeflow_oauth_state=${state}` },
  }), env, () => store, fetchImpl, () => NOW + 11 * 60 * 1000);
  assert.equal(expired.headers.get('location'), '/?auth=expired');
  assert.equal(upstreamCalls, 0);
});

test('expired sessions cannot authenticate and callback origins cannot be overridden', async () => {
  const store = new MemoryAuthStore();
  const auth = (request, config = env) => handleAuthRequest(request, config, () => store, fetch, () => NOW);
  await assert.rejects(
    auth(new Request('https://evil.example/auth/github/start')),
    (error) => error.status === 400,
  );
  const expired = await auth(new Request('https://changeflow.example/api/auth/me', {
    headers: { cookie: 'changeflow_session=unknown' },
  }));
  assert.equal(expired.status, 401);
});
