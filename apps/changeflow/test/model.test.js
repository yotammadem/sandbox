import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  applyAgentIteration,
  addComment,
  appendHistoryEvent,
  createInitialState,
  hasCycle,
  loadState,
  saveState,
  STORAGE_KEY,
  splitChangeset,
  mergeChangesets,
  reviewAssumption,
} from '../src/model.js';

test('sample dependency graph is acyclic and detects a cycle', () => {
  const state = createInitialState();
  assert.equal(hasCycle(state.changesets), false);

  const cyclic = state.changesets.map((change) => ({ ...change, deps: [...change.deps] }));
  cyclic.find((change) => change.id === 'CS-01').deps = ['CS-05'];
  assert.equal(hasCycle(cyclic), true);
});

test('approval feedback preserves unchanged revisions and approvals', () => {
  const state = createInitialState();
  state.pending.push({ type: 'review', id: 'CS-01', status: 'approved' });

  const result = applyAgentIteration(state);

  assert.deepEqual(result.updatedIds, []);
  assert.equal(state.changesets.find((change) => change.id === 'CS-01').rev, 1);
  assert.equal(state.changesets.find((change) => change.id === 'CS-01').status, 'approved');
  assert.equal(state.pending.length, 0);
});

test('timeout feedback revises the changeset and invalidates its dependents only', () => {
  const state = createInitialState();
  state.pending.push({ type: 'review', id: 'CS-03', status: 'timeout' });

  const result = applyAgentIteration(state);

  assert.deepEqual(result.updatedIds, ['CS-03', 'CS-05']);
  assert.equal(state.changesets.find((change) => change.id === 'CS-03').status, 'pending');
  assert.equal(state.changesets.find((change) => change.id === 'CS-05').status, 'pending');
  assert.equal(state.changesets.find((change) => change.id === 'CS-01').status, 'approved');
  assert.equal(state.changesets.find((change) => change.id === 'CS-02').status, 'approved');
  assert.equal(state.feedbackHistory[0].items[0].status, 'timeout');
  assert.deepEqual(state.feedbackHistory[0].updatedIds, ['CS-03', 'CS-05']);
});

test('engineering knowledge changes invalidate linked changesets and downstream work', () => {
  const state = createInitialState();
  state.pending.push({ type: 'record', id: 'D-02', ids: ['CS-02', 'CS-03'] });

  const result = applyAgentIteration(state);

  assert.deepEqual(result.updatedIds, ['CS-02', 'CS-03', 'CS-04', 'CS-05']);
  assert.equal(state.changesets.find((change) => change.id === 'CS-01').status, 'approved');
});

test('state persists and invalid stored JSON falls back to the sample', () => {
  const state = createInitialState();
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };

  saveState(state, storage);
  assert.equal(loadState(storage).changesets.length, 5);
  values.set(STORAGE_KEY, '{invalid');
  assert.equal(loadState(storage).iteration, 3);
});

test('legacy saved demo data migrates to English without discarding review state', () => {
  const state = createInitialState();
  state.changesets[0].title = 'הסרת Wrapper מיותר';
  state.changesets[0].description = 'old Hebrew description';
  state.changesets[0].status = 'approved';
  state.changesets[0].history[0].note = 'הצעה מקורית';
  state.decisions[0].title = 'Fallback רק כשהביטוי אינו נתמך';
  state.activity[0].title = 'נדרש תיקון · CS-04';
  state.activity[0].detail = 'סטטוס קודם: אושר';
  state.pending.push({ type: 'review', id: 'CS-04', status: 'changes', detail: 'בקשת תיקון: Timeout Reject ללא נימוק', time: 'היום, 08:10' });
  state.feedbackHistory = [{ iteration: 4, items: [{ id: 'CS-04', detail: 'תלויות עודכנו: CS-02', time: 'לפני 12 דקות' }], updatedIds: ['CS-04'] }];
  const values = new Map([[STORAGE_KEY, JSON.stringify(state)]]);
  const restored = loadState({ getItem: (key) => values.get(key) });

  assert.equal(restored.changesets[0].title, 'Remove a redundant wrapper');
  assert.equal(restored.changesets[0].status, 'approved');
  assert.equal(restored.changesets[0].history[0].note, 'Initial proposal');
  assert.equal(restored.decisions[0].title, 'Use fallback only for unsupported expressions');
  assert.equal(restored.activity[0].title, 'Changes requested · CS-04');
  assert.equal(restored.activity[0].detail, 'Previous status: Approved');
  assert.equal(restored.pending[0].detail, 'Request changes: Timeout reject — no explanation');
  assert.equal(restored.feedbackHistory[0].items[0].detail, 'Dependencies updated: CS-02');
  assert.equal(JSON.stringify(restored).match(/[\u0590-\u05ff]/), null);
});

test('page declares English left-to-right layout', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<html lang="en" dir="ltr">/);
  assert.match(html, /<title>Changeflow — AI Code Review<\/title>/);
  assert.match(html, /href="\/auth\/github\/start"/);
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/);
});

test('shared history links comments to multiple records', () => {
  const state = createInitialState();
  const item = addComment(state, [{ kind: 'changeset', id: 'CS-03' }, { kind: 'assumption', id: 'A-02' }], 'Please verify the legacy path.');
  assert.equal(item.type, 'comment');
  assert.deepEqual(item.targets, [{ kind: 'changeset', id: 'CS-03' }, { kind: 'assumption', id: 'A-02' }]);
  assert.equal(state.eventLog[0].body, 'Please verify the legacy path.');
  assert.equal(appendHistoryEvent(state, { summary: 'Test event', targets: [] }).id, 'EV-0006');
});

test('splitting preserves the original and updates dependents to all results', () => {
  const state = createInitialState();
  const parts = splitChangeset(state, 'CS-03', ['Resolve unsupported expressions', 'Resolve unavailable indexes']);
  assert.deepEqual(parts.map((part) => part.id), ['CS-06', 'CS-07']);
  assert.equal(state.changesets.find((change) => change.id === 'CS-03').active, false);
  assert.deepEqual(state.changesets.find((change) => change.id === 'CS-05').deps, ['CS-06', 'CS-07', 'CS-04']);
  assert.deepEqual(state.eventLog[0].targets.map((target) => target.id), ['CS-03', 'CS-06', 'CS-07']);
  assert.deepEqual(applyAgentIteration(state).updatedIds.sort(), ['CS-05', 'CS-06', 'CS-07']);
});

test('merging preserves source history and creates a result with combined dependencies', () => {
  const state = createInitialState();
  const result = mergeChangesets(state, ['CS-01', 'CS-02'], 'Consolidate baseline setup');
  assert.equal(result.id, 'CS-06');
  assert.equal(result.active, true);
  assert.deepEqual(result.deps, []);
  assert.equal(state.changesets.find((change) => change.id === 'CS-01').mergedInto, 'CS-06');
  assert.deepEqual(state.eventLog[0].targets.map((target) => target.id), ['CS-01', 'CS-02', 'CS-06']);
  assert.deepEqual(applyAgentIteration(state).updatedIds.sort(), ['CS-03', 'CS-04', 'CS-05', 'CS-06']);
});

test('assumptions can be verified or rejected but not canceled; reasonless rejection requests investigation', () => {
  const state = createInitialState();
  const assumption = reviewAssumption(state, 'A-02', 'rejected');
  assert.equal(assumption.needsInvestigation, true);
  assert.match(state.pending[0].detail, /agent should investigate/);
  assert.deepEqual(applyAgentIteration(state).updatedIds, ['CS-03', 'CS-05']);
  assert.throws(() => reviewAssumption(state, 'A-02', 'cancelled'), /not canceled/);
  reviewAssumption(state, 'A-02', 'rejected', 'The legacy client never enters this code path.');
  assert.equal(state.assumptions.find((item) => item.id === 'A-02').needsInvestigation, false);
});
