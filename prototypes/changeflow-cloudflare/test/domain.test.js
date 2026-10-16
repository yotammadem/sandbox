import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createTaskDocument, DomainError } from '../src/domain.js';

const now = '2026-10-16T12:00:00.000Z';
let sequence = 0;
const command = (type, actor, payload = {}) => ({ type, actor, payload, commandId: `command-${++sequence}` });
const apply = (task, type, actor, payload = {}) => applyCommand(task, command(type, actor, payload), { now, eventId: `event-${++sequence}` });
const implementation = (fingerprint, sha = 'a1b2c3d') => ({ revision: 1, patchFingerprint: fingerprint, commitBundle: { revisionId: 'r1', commits: [{ sha, order: 1, subject: 'implement change' }] } });
const changeset = (id, deps = [], fingerprint = `${id}-patch`, knowledgeLinks = { decisions: [], assumptions: [] }) => ({ id, title: `Change ${id}`, intent: 'Make a focused backend improvement.', deps, implementation: implementation(fingerprint), knowledgeLinks });

function baseTask() {
  return createTaskDocument({ taskId: 'task-1', title: 'Backend refactor' }, now, 'task-created');
}

function addChange(task, item) { return apply(task, 'changeset.upsert', 'agent', { changeset: item }); }

test('task-wide event log records comments, request threads, and object targets', () => {
  let task = baseTask();
  task = addChange(task, changeset('api'));
  task = apply(task, 'comment.add', 'human', { body: 'Please explain the boundary.', targets: [{ kind: 'changeset', id: 'api' }] });
  task = apply(task, 'request.create', 'human', { requestId: 'req-1', category: 'simplify', instruction: 'Simplify the boundary and explain the tradeoff.', targets: [{ kind: 'changeset', id: 'api' }] });
  task = apply(task, 'request.message.add', 'agent', { requestId: 'req-1', body: 'I will revise and return with a clearer implementation.', status: 'working' });
  assert.equal(task.events.at(-1).type, 'request.message.added');
  assert.deepEqual(task.events.at(-1).targets, [{ kind: 'request', id: 'req-1' }, { kind: 'changeset', id: 'api' }]);
  assert.equal(task.requests[0].messages.length, 2);
});

test('feedback submission snapshots review outcomes and event cursor, then agent can return a new iteration', () => {
  let task = baseTask();
  task = addChange(task, changeset('api'));
  task = apply(task, 'changeset.review', 'human', { changesetId: 'api', status: 'timeout' });
  task = apply(task, 'request.create', 'human', { requestId: 'req-iteration', instruction: 'Please make the boundary easier to understand.', targets: [{ kind: 'changeset', id: 'api' }] });
  const throughRevision = task.revision;
  task = apply(task, 'feedback.submit', 'human', { packageId: 'feedback-1', afterRevision: 1 });
  assert.equal(task.status, 'agent');
  assert.equal(task.iteration, 2);
  assert.equal(task.feedbackPackages[0].throughRevision, throughRevision);
  assert.ok(task.feedbackPackages[0].eventIds.length >= 2);
  assert.equal(task.feedbackPackages[0].reviewOutcomes[0].status, 'timeout');
  task = apply(task, 'iteration.complete', 'agent', { summary: 'Simplified the boundary and added focused tests.' });
  assert.equal(task.status, 'review');
  assert.equal(task.events.at(-1).type, 'iteration.prepared');
});

test('approval survives unrelated changes, but changes to a dependency invalidate it', () => {
  let task = baseTask();
  task = addChange(task, changeset('foundation'));
  task = addChange(task, changeset('dependent', ['foundation']));
  task = apply(task, 'changeset.review', 'human', { changesetId: 'dependent', status: 'approved' });
  task = addChange(task, changeset('unrelated'));
  assert.equal(task.changesets.find((item) => item.id === 'dependent').review.status, 'approved');
  task = addChange(task, changeset('foundation', [], 'foundation-patch-v2'));
  assert.equal(task.changesets.find((item) => item.id === 'dependent').review.status, 'recheck');
  assert.equal(task.events.at(-1).type, 'approvals.invalidated');
});

test('assumptions can be rejected with or without a reason; only unexplained rejection requests investigation', () => {
  let task = baseTask();
  task = apply(task, 'knowledge.upsert', 'agent', { kind: 'assumption', id: 'idem', title: 'The operation is idempotent.' });
  task = apply(task, 'knowledge.upsert', 'human', { kind: 'assumption', id: 'idem', title: 'The operation is idempotent.', status: 'rejected' });
  assert.equal(task.assumptions[0].needsInvestigation, true);
  task = apply(task, 'knowledge.upsert', 'human', { kind: 'assumption', id: 'idem', title: 'The operation is idempotent.', status: 'rejected', rejectionReason: 'The API increments a counter.' });
  assert.equal(task.assumptions[0].needsInvestigation, false);
  assert.throws(() => apply(task, 'knowledge.upsert', 'human', { kind: 'assumption', id: 'idem', title: 'The operation is idempotent.', status: 'cancelled' }), DomainError);
});

test('linked knowledge edits invalidate only approvals that depend on that knowledge', () => {
  let task = baseTask();
  task = addChange(task, changeset('uses-assumption'));
  task = addChange(task, changeset('independent'));
  task = apply(task, 'knowledge.upsert', 'agent', { kind: 'assumption', id: 'legacy-fallback', title: 'Fallback is needed only for legacy clients.', links: ['uses-assumption'] });
  task = addChange(task, changeset('uses-assumption', [], 'uses-assumption-patch', { decisions: [], assumptions: ['legacy-fallback'] }));
  task = apply(task, 'changeset.review', 'human', { changesetId: 'uses-assumption', status: 'approved' });
  task = apply(task, 'changeset.review', 'human', { changesetId: 'independent', status: 'approved' });
  task = apply(task, 'knowledge.upsert', 'human', { kind: 'assumption', id: 'legacy-fallback', title: 'Fallback is needed only for legacy clients.', status: 'verified', links: ['uses-assumption'] });
  assert.equal(task.changesets.find((item) => item.id === 'uses-assumption').review.status, 'recheck');
  assert.equal(task.changesets.find((item) => item.id === 'independent').review.status, 'approved');
});

test('decision cancellation is represented as a retained, rejected decision', () => {
  let task = baseTask();
  task = apply(task, 'knowledge.upsert', 'agent', { kind: 'decision', id: 'cache', title: 'Do not add a cache.' });
  task = apply(task, 'knowledge.upsert', 'human', { kind: 'decision', id: 'cache', title: 'Do not add a cache.', status: 'cancelled' });
  assert.equal(task.decisions[0].status, 'cancelled');
  assert.equal(task.events.at(-1).type, 'decision.updated');
});

test('dependency updates reject cycles', () => {
  let task = baseTask();
  task = addChange(task, changeset('a'));
  task = addChange(task, changeset('b', ['a']));
  assert.throws(() => apply(task, 'changeset.dependencies.set', 'human', { changesetId: 'a', dependencies: ['b'] }), (error) => error instanceof DomainError && error.code === 'dependency_cycle');
});

test('only agent can split or merge; source identity remains in history and results are visible as active nodes', () => {
  let task = baseTask();
  task = addChange(task, changeset('source'));
  const parts = [changeset('part-a'), changeset('part-b')];
  assert.throws(() => apply(task, 'changeset.split.apply', 'human', { sourceId: 'source', changesets: parts }), (error) => error.code === 'actor_not_allowed');
  task = apply(task, 'changeset.split.apply', 'agent', { sourceId: 'source', changesets: parts });
  assert.equal(task.changesets.find((item) => item.id === 'source').active, false);
  assert.deepEqual(task.changesets.filter((item) => item.active).map((item) => item.id), ['part-a', 'part-b']);
  assert.deepEqual(task.events.at(-1).payload.results.map((item) => item.id), ['part-a', 'part-b']);
});

test('merge records source and result while downstream dependencies point at the merged Changeset', () => {
  let task = baseTask();
  task = addChange(task, changeset('a'));
  task = addChange(task, changeset('b'));
  task = addChange(task, changeset('downstream', ['a', 'b']));
  task = apply(task, 'changeset.merge.apply', 'agent', { sourceIds: ['a', 'b'], result: changeset('merged') });
  assert.deepEqual(task.changesets.find((item) => item.id === 'merged').mergedFrom, ['a', 'b']);
  assert.deepEqual(task.changesets.find((item) => item.id === 'downstream').deps, ['merged']);
});

test('finalization rewrites commit bundle to one commit and keeps approval when patch fingerprint is stable', () => {
  let task = baseTask();
  task = addChange(task, { ...changeset('single'), implementation: { revision: 3, patchFingerprint: 'stable-patch', commitBundle: { revisionId: 'r3', commits: [{ sha: '1', order: 1 }, { sha: '2', order: 2 }] } } });
  task = apply(task, 'changeset.review', 'human', { changesetId: 'single', status: 'approved' });
  task = apply(task, 'implementation.finalize', 'agent', { changesetId: 'single', previousCommitCount: 2, commitBundle: { revisionId: 'merge-ready', commits: [{ sha: 'rewrite-sha', order: 1, subject: 'single logical change' }] } });
  const change = task.changesets.find((item) => item.id === 'single');
  assert.equal(change.implementation.commitBundle.commits.length, 1);
  assert.equal(change.review.status, 'approved');
  assert.equal(task.events.at(-1).payload.patchFingerprintUnchanged, true);
});
