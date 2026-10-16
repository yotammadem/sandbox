import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAgentIteration,
  createInitialState,
  hasCycle,
  loadState,
  saveState,
  STORAGE_KEY,
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
