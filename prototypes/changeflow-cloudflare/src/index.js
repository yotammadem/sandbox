import { applyCommand, createTaskDocument, DomainError, documentSize, MAX_DOCUMENT_BYTES, validateTaskDocument } from './domain.js';
import { GitHubContentsTaskStore, GitHubStorageError } from './github-store.js';
import { AuthError, D1AuthStore, handleAuthRequest } from './auth.js';
import { D1TaskStore } from './store.js';

const MAX_REQUEST_BYTES = 64_000;

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
};

export async function handleRequest(request, env, createStore = configuredStore, createAuthStore = configuredAuthStore, fetchImpl = fetch) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true, service: 'changeflow-api' }, 200, cors);

    try {
      const authResponse = await handleAuthRequest(request, env, createAuthStore, fetchImpl);
      if (authResponse) return authResponse;
      if (!url.pathname.startsWith('/api/')) {
        if (env.ASSETS) return env.ASSETS.fetch(request);
        return json({ error: 'not_found' }, 404, cors);
      }
      if (!await authorized(request, env)) return json({ error: 'unauthorized' }, 401, cors);
      const store = createStore(env);
      if (url.pathname === '/api/storage/status' && request.method === 'GET') return await storageStatus(store, cors);
      if (url.pathname === '/api/tasks' && request.method === 'POST') return await createTask(request, store, cors);
      const match = url.pathname.match(/^\/api\/tasks\/([A-Za-z0-9][A-Za-z0-9._:-]{0,99})(?:\/(events|commands))?$/);
      if (!match) return json({ error: 'not_found' }, 404, cors);
      const [, taskId, action] = match;
      if (!action && request.method === 'GET') return await getTask(taskId, store, cors);
      if (action === 'events' && request.method === 'GET') return await getEvents(taskId, url, store, cors);
      if (action === 'commands' && request.method === 'POST') return await runCommand(request, taskId, store, cors);
      return json({ error: 'method_not_allowed' }, 405, cors);
    } catch (error) {
      if (error instanceof AuthError) return json({ error: 'authentication_error', message: error.message }, error.status, cors);
      if (error instanceof DomainError) return json({ error: error.code, message: error.message }, error.status, cors);
      if (error instanceof GitHubStorageError) return json({ error: 'storage_provider_error', message: 'The storage provider could not complete the request.' }, 503, { ...cors, 'retry-after': '1' });
      console.error('Changeflow API error:', error);
      return json({ error: 'internal_error', message: 'The request could not be completed.' }, 500, cors);
    }
}

function configuredAuthStore(runtime) {
  return new D1AuthStore(runtime.AUTH_DB || runtime.DB);
}

async function storageStatus(store, cors) {
  if (typeof store.checkConnection !== 'function') {
    return json({ error: 'storage_check_unavailable' }, 501, cors);
  }
  const status = await store.checkConnection();
  return json(status, 200, cors);
}

function configuredStore(runtime) {
  if (runtime.STORAGE_DRIVER === 'github') {
    return new GitHubContentsTaskStore({
      owner: runtime.GITHUB_OWNER,
      repo: runtime.GITHUB_REPO,
      branch: runtime.GITHUB_BRANCH || 'main',
      token: runtime.GITHUB_TOKEN,
    });
  }
  return new D1TaskStore(runtime.DB);
}

async function createTask(request, store, cors) {
  const body = await readJson(request);
  const taskId = String(body.taskId || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{1,99}$/.test(taskId)) throw new DomainError('taskId must be a 2–100 character stable identifier.');
  const document = createTaskDocument({ taskId, title: body.title, description: body.description });
  if (documentSize(document) > MAX_DOCUMENT_BYTES) throw new DomainError('Task document is too large.', 413, 'document_too_large');
  if (!await store.create(document)) return json({ error: 'task_exists', taskId }, 409, cors);
  return json({ task: document }, 201, { ...cors, etag: etag(document.revision) });
}

async function getTask(taskId, store, cors) {
  const task = await store.get(taskId);
  if (!task) return json({ error: 'task_not_found' }, 404, cors);
  return json({ task }, 200, { ...cors, etag: etag(task.revision) });
}

async function getEvents(taskId, url, store, cors) {
  const task = await store.get(taskId);
  if (!task) return json({ error: 'task_not_found' }, 404, cors);
  const afterRevision = Number(url.searchParams.get('afterRevision') || 0);
  if (!Number.isInteger(afterRevision) || afterRevision < 0) throw new DomainError('afterRevision must be a non-negative integer.');
  const events = task.events.filter((event) => event.revision > afterRevision);
  return json({ taskId, revision: task.revision, events }, 200, { ...cors, etag: etag(task.revision) });
}

async function runCommand(request, taskId, store, cors) {
  const expectedRevision = parseRevision(request.headers.get('if-match'));
  if (expectedRevision == null) return json({ error: 'if_match_required', message: 'Send If-Match with the task revision ETag.' }, 428, cors);
  const commandId = request.headers.get('idempotency-key');
  if (!commandId || !/^[A-Za-z0-9._:-]{8,120}$/.test(commandId)) return json({ error: 'idempotency_key_required' }, 400, cors);
  const current = await store.get(taskId);
  if (!current) return json({ error: 'task_not_found' }, 404, cors);
  const body = await readJson(request);
  const commandHash = await hashCommand(body);
  const priorEvent = current.events.find((event) => event.commandId === commandId);
  if (priorEvent) {
    if (priorEvent.commandHash !== commandHash) return json({ error: 'idempotency_key_reused' }, 409, { ...cors, etag: etag(current.revision) });
    return json({ task: current, duplicate: true, event: priorEvent }, 200, { ...cors, etag: etag(current.revision) });
  }
  if (current.revision !== expectedRevision) return json({ error: 'revision_conflict', expectedRevision, currentRevision: current.revision }, 409, { ...cors, etag: etag(current.revision) });

  const command = { ...body, commandId, commandHash };
  const next = applyCommand(current, command);
  const bytes = validateTaskDocument(next);
  if (!await store.compareAndSwap(taskId, expectedRevision, next)) {
    const latest = await store.get(taskId);
    return json({ error: 'revision_conflict', expectedRevision, currentRevision: latest?.revision ?? null }, 409, latest ? { ...cors, etag: etag(latest.revision) } : cors);
  }
  return json({ task: next, bytes }, 200, { ...cors, etag: etag(next.revision) });
}

async function hashCommand(body) {
  const canonical = canonicalJson(body);
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

async function readJson(request) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_REQUEST_BYTES) throw new DomainError('Request body is too large.', 413, 'request_too_large');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) throw new DomainError('Request body is too large.', 413, 'request_too_large');
  let value;
  try { value = JSON.parse(text); } catch { throw new DomainError('Request body must be valid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DomainError('Request body must be a JSON object.');
  return value;
}

async function authorized(request, env) {
  if (typeof env.CHANGEFLOW_API_TOKEN !== 'string' || env.CHANGEFLOW_API_TOKEN.length < 24) return false;
  const supplied = request.headers.get('authorization') || '';
  if (!supplied.startsWith('Bearer ')) return false;
  const encoder = new TextEncoder();
  const expectedBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(env.CHANGEFLOW_API_TOKEN)));
  const suppliedBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(supplied.slice(7))));
  let mismatch = expectedBytes.length ^ suppliedBytes.length;
  for (let index = 0; index < expectedBytes.length; index += 1) mismatch |= expectedBytes[index] ^ suppliedBytes[index];
  return mismatch === 0;
}

function parseRevision(value) {
  if (!value) return null;
  const parsed = Number(value.replaceAll('"', '').trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function etag(revision) { return `"${revision}"`; }

function corsHeaders(request, env) {
  const origin = request.headers.get('origin');
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, if-match, idempotency-key',
    'access-control-expose-headers': 'etag',
    'vary': 'Origin',
  };
}

function json(body, status, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
}
