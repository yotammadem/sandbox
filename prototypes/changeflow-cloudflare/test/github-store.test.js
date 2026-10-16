import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskDocument } from '../src/domain.js';
import { GitHubContentsTaskStore } from '../src/github-store.js';

function setupGithubMock() {
  let entry = null;
  let sequence = 0;
  let beforePut = null;
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), options });
    if (options.method === 'GET') {
      if (String(url).endsWith('/repos/owner/changeflow-data')) {
        return Response.json({ id: 42, full_name: 'owner/changeflow-data', private: true });
      }
      if (String(url).endsWith('/repos/owner/changeflow-data/branches/main')) {
        return Response.json({ name: 'main' });
      }
      if (!entry) return new Response('', { status: 404 });
      return Response.json({
        type: 'file',
        encoding: 'base64',
        content: Buffer.from(JSON.stringify(entry.document), 'utf8').toString('base64'),
        sha: entry.sha,
      });
    }
    if (options.method === 'PUT') {
      if (beforePut) {
        const callback = beforePut;
        beforePut = null;
        callback((document) => { entry = { document, sha: `blob-${++sequence}` }; });
      }
      const body = JSON.parse(options.body);
      if (!entry && body.sha) return new Response('', { status: 409 });
      if (entry && body.sha !== entry.sha) return new Response('', { status: 409 });
      const document = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'));
      const created = !entry;
      entry = { document, sha: `blob-${++sequence}` };
      return Response.json({}, { status: created ? 201 : 200 });
    }
    throw new Error(`Unexpected method ${options.method}`);
  };
  return {
    requests,
    fetchImpl,
    get entry() { return entry; },
    raceNextWrite(callback) { beforePut = callback; },
  };
}

function task(revision = 1) {
  const document = createTaskDocument({ taskId: 'review:task-1', title: 'בדיקת אחסון' }, '2026-10-16T10:00:00.000Z', 'event-created');
  document.revision = revision;
  return document;
}

function storeWith(mock) {
  return new GitHubContentsTaskStore({ owner: 'owner', repo: 'changeflow-data', branch: 'main', token: 'mock-token', fetchImpl: mock.fetchImpl });
}

test('GitHub adapter creates and reads one UTF-8 JSON file per Task', async () => {
  const mock = setupGithubMock();
  const store = storeWith(mock);
  const document = task();
  assert.equal(await store.create(document), true);
  assert.deepEqual(await store.get(document.taskId), document);
  assert.match(mock.requests[0].url, /tasks\/review%3Atask-1\.json\?ref=main$/);
  assert.equal(mock.requests[0].options.headers.authorization, 'Bearer mock-token');
  assert.equal(await store.create(document), false);
});

test('GitHub adapter verifies access to a private data repo and configured branch', async () => {
  const mock = setupGithubMock();
  const store = storeWith(mock);
  assert.deepEqual(await store.checkConnection(), {
    driver: 'github',
    connected: true,
    repository: { id: 42, fullName: 'owner/changeflow-data', private: true },
    branch: 'main',
  });
  assert.ok(mock.requests.every(({ options }) => options.headers.authorization === 'Bearer mock-token'));
});

test('GitHub adapter compare-and-swap uses the private blob SHA and preserves the TaskStore contract', async () => {
  const mock = setupGithubMock();
  const store = storeWith(mock);
  const original = task();
  await store.create(original);
  const next = { ...original, revision: 2, updatedAt: '2026-10-16T10:01:00.000Z' };
  assert.equal(await store.compareAndSwap(original.taskId, 1, next), true);
  assert.equal((await store.get(original.taskId)).revision, 2);
  const update = mock.requests.find(({ options }) => options.method === 'PUT' && JSON.parse(options.body).sha);
  assert.equal(JSON.parse(update.options.body).sha, 'blob-1');
});

test('a competing write makes GitHub compare-and-swap return false instead of overwriting it', async () => {
  const mock = setupGithubMock();
  const store = storeWith(mock);
  const original = task();
  await store.create(original);
  mock.raceNextWrite((replace) => replace({ ...original, revision: 2, title: 'Concurrent update' }));
  const losingWrite = { ...original, revision: 2, title: 'Stale update' };
  assert.equal(await store.compareAndSwap(original.taskId, 1, losingWrite), false);
  assert.equal((await store.get(original.taskId)).title, 'Concurrent update');
});
