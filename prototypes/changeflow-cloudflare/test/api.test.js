import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../src/index.js';
import { createTaskDocument } from '../src/domain.js';
import { MemoryAuthStore } from '../src/auth.js';
import { GitHubStorageError } from '../src/github-store.js';
import { MemoryTaskStore } from '../src/store.js';

const token = 'prototype-test-token-at-least-24-characters';
const store = new MemoryTaskStore();
const env = { CHANGEFLOW_API_TOKEN: token, ALLOWED_ORIGINS: 'https://review.example' };
const call = (path, { method = 'GET', body, headers = {} } = {}) => handleRequest(new Request(`https://worker.example${path}`, {
  method,
  headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}), env, () => store);
const auth = { authorization: `Bearer ${token}` };

test('health is public while API endpoints require the configured bearer token', async () => {
  const health = await call('/health');
  assert.equal(health.status, 200);
  const unauthorized = await call('/api/tasks');
  assert.equal(unauthorized.status, 401);
  const wrong = await call('/api/tasks', { headers: { authorization: 'Bearer wrong-token' } });
  assert.equal(wrong.status, 401);
  const storageStatusUnauthorized = await call('/api/storage/status');
  assert.equal(storageStatusUnauthorized.status, 401);
});

test('storage status verifies the configured provider behind authentication', async () => {
  const store = {
    checkConnection: async () => ({ driver: 'github', connected: true, repository: { id: 42, fullName: 'owner/changeflow-data', private: true }, branch: 'main' }),
  };
  const response = await handleRequest(new Request('https://worker.example/api/storage/status', { headers: auth }), env, () => store);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    driver: 'github', connected: true,
    repository: { id: 42, fullName: 'owner/changeflow-data', private: true }, branch: 'main',
  });
});

test('Worker serves the Changeflow client assets from the same origin', async () => {
  let servedRequest;
  const response = await handleRequest(new Request('https://changeflow.example/'), {
    ...env,
    ASSETS: { fetch: async (request) => { servedRequest = request; return new Response('<main>Changeflow</main>', { status: 200 }); } },
  }, () => store);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '<main>Changeflow</main>');
  assert.equal(servedRequest.url, 'https://changeflow.example/');
});

test('GitHub sign-in starts on the Worker without the prototype API token', async () => {
  const authStore = new MemoryAuthStore();
  const authEnv = {
    GITHUB_APP_CLIENT_ID: 'Iv1.test-client',
    GITHUB_APP_CLIENT_SECRET: 'test-client-secret',
    GITHUB_APP_CALLBACK_URL: 'https://changeflow.example/auth/github/callback',
  };
  const response = await handleRequest(new Request('https://changeflow.example/auth/github/start'), authEnv, () => store, () => authStore);
  assert.equal(response.status, 302);
  assert.equal(new URL(response.headers.get('location')).origin, 'https://github.com');
  assert.match(response.headers.get('set-cookie'), /changeflow_oauth_state=/);
});

test('task creation, ETag reads, event reads, and optimistic command writes work together', async () => {
  const created = await call('/api/tasks', { method: 'POST', headers: auth, body: { taskId: 'api-task', title: 'Refactor auth' } });
  assert.equal(created.status, 201);
  assert.equal(created.headers.get('etag'), '"1"');
  const current = await call('/api/tasks/api-task', { headers: auth });
  assert.equal(current.status, 200);
  const commandResponse = await call('/api/tasks/api-task/commands', {
    method: 'POST',
    headers: { ...auth, 'if-match': '"1"', 'idempotency-key': 'comment-000001' },
    body: { type: 'comment.add', actor: 'human', payload: { body: 'Please clarify the goal.' } },
  });
  assert.equal(commandResponse.status, 200);
  const result = await commandResponse.json();
  assert.equal(result.task.revision, 2);
  assert.equal(result.task.events.at(-1).type, 'comment.added');
  const eventResponse = await call('/api/tasks/api-task/events?afterRevision=1', { headers: auth });
  const eventBody = await eventResponse.json();
  assert.equal(eventBody.events.length, 1);
  assert.equal(eventBody.events[0].commandId, 'comment-000001');
});

test('commands require optimistic lock and idempotency; retries are safe', async () => {
  const created = await call('/api/tasks', { method: 'POST', headers: auth, body: { taskId: 'retry-task', title: 'Retry safety' } });
  assert.equal(created.status, 201);
  const headers = { ...auth, 'if-match': '"1"', 'idempotency-key': 'retry-command-1' };
  const body = { type: 'comment.add', actor: 'human', payload: { body: 'One durable comment.' } };
  const first = await call('/api/tasks/retry-task/commands', { method: 'POST', headers, body });
  assert.equal(first.status, 200);
  const retry = await call('/api/tasks/retry-task/commands', { method: 'POST', headers, body });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).duplicate, true);
  const reused = await call('/api/tasks/retry-task/commands', { method: 'POST', headers, body: { ...body, payload: { body: 'Different operation.' } } });
  assert.equal(reused.status, 409);
  assert.equal((await reused.json()).error, 'idempotency_key_reused');
  const stale = await call('/api/tasks/retry-task/commands', { method: 'POST', headers: { ...auth, 'if-match': '"1"', 'idempotency-key': 'retry-command-2' }, body });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error, 'revision_conflict');
  const missingIfMatch = await call('/api/tasks/retry-task/commands', { method: 'POST', headers: { ...auth, 'idempotency-key': 'retry-command-3' }, body });
  assert.equal(missingIfMatch.status, 428);
});

test('origin allowlist controls browser access headers', async () => {
  const allowed = await handleRequest(new Request('https://worker.example/health', { headers: { origin: 'https://review.example' } }), env, () => store);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://review.example');
  const denied = await handleRequest(new Request('https://worker.example/health', { headers: { origin: 'https://evil.example' } }), env, () => store);
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
});

test('storage-provider write conflicts are retryable responses, not internal server errors', async () => {
  const backing = new MemoryTaskStore();
  await backing.create(createTaskDocument({ taskId: 'storage-conflict', title: 'Storage conflict' }));
  const store = {
    get: (taskId) => backing.get(taskId),
    compareAndSwap: async () => { throw new GitHubStorageError('private provider detail', 409); },
  };
  const response = await handleRequest(new Request('https://worker.example/api/tasks/storage-conflict/commands', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json', 'if-match': '"1"', 'idempotency-key': 'provider-write-0001' },
    body: JSON.stringify({ type: 'comment.add', actor: 'human', payload: { body: 'Retry after transient storage conflict.' } }),
  }), env, () => store);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('retry-after'), '1');
  assert.equal((await response.json()).error, 'storage_provider_error');
});
