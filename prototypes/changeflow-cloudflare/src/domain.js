export const SCHEMA_VERSION = 1;
export const MAX_DOCUMENT_BYTES = 1_500_000;

const validKinds = new Set(['task', 'changeset', 'decision', 'assumption', 'request']);
const reviewStatuses = new Set(['pending', 'approved', 'changes', 'timeout', 'recheck']);

export class DomainError extends Error {
  constructor(message, status = 400, code = 'invalid_command') {
    super(message);
    this.name = 'DomainError';
    this.status = status;
    this.code = code;
  }
}

export function createTaskDocument({ taskId, title, description = '' }, now = new Date().toISOString(), eventId = crypto.randomUUID()) {
  const task = {
    schemaVersion: SCHEMA_VERSION,
    taskId,
    revision: 1,
    iteration: 1,
    title: cleanText(title, 'title', 200),
    description: cleanText(description, 'description', 8_000, true),
    status: 'review',
    changesets: [],
    decisions: [],
    assumptions: [],
    requests: [],
    feedbackPackages: [],
    events: [],
    createdAt: now,
    updatedAt: now,
  };
  appendEvent(task, { id: eventId, type: 'task.created', actor: 'human', targets: [{ kind: 'task', id: taskId }], payload: { title: task.title }, at: now });
  return task;
}

export function applyCommand(current, command, { now = new Date().toISOString(), eventId = crypto.randomUUID() } = {}) {
  if (!current || current.schemaVersion !== SCHEMA_VERSION) throw new DomainError('Unsupported task document schema.', 409, 'schema_mismatch');
  const task = structuredClone(current);
  const { type, actor, payload = {}, commandId, commandHash } = command;
  if (!['human', 'agent', 'system'].includes(actor)) throw new DomainError('actor must be human, agent, or system.');

  const targets = [];
  let eventType = type;
  let eventPayload = {};
  let summary = '';

  switch (type) {
    case 'comment.add': {
      const body = cleanText(payload.body, 'comment', 8_000);
      const linked = normalizeTargets(task, payload.targets);
      targets.push(...linked);
      eventType = 'comment.added';
      eventPayload = { body };
      summary = 'Comment added';
      break;
    }
    case 'request.create': {
      if (actor !== 'human') throw new DomainError('Only a human can create an agent request.', 403, 'actor_not_allowed');
      const requestId = cleanId(payload.requestId, 'requestId');
      if (task.requests.some((request) => request.id === requestId)) throw new DomainError(`Request ${requestId} already exists.`, 409, 'duplicate_request');
      const scope = normalizeTargets(task, payload.targets);
      const instruction = cleanText(payload.instruction, 'instruction', 8_000);
      const request = {
        id: requestId,
        status: 'submitted',
        targets: scope,
        category: payload.category ? cleanText(payload.category, 'category', 80) : 'general',
        messages: [{ id: commandId, actor: 'human', body: instruction, at: now }],
        createdAt: now,
        updatedAt: now,
      };
      task.requests.push(request);
      targets.push({ kind: 'request', id: requestId }, ...scope);
      eventType = 'request.created';
      eventPayload = { requestId, category: request.category, instruction };
      summary = `Request ${requestId} submitted`;
      break;
    }
    case 'request.message.add': {
      const request = task.requests.find((item) => item.id === payload.requestId);
      if (!request) throw new DomainError(`Request ${payload.requestId} was not found.`, 404, 'request_not_found');
      const body = cleanText(payload.body, 'message', 8_000);
      const message = { id: commandId, actor, body, at: now };
      request.messages.push(message);
      if (payload.status) {
        if (!['submitted', 'working', 'needs-human', 'proposed', 'completed', 'declined'].includes(payload.status)) throw new DomainError('Invalid request status.');
        request.status = payload.status;
      }
      request.updatedAt = now;
      targets.push({ kind: 'request', id: request.id }, ...request.targets);
      eventType = 'request.message.added';
      eventPayload = { requestId: request.id, message, status: request.status };
      summary = `${actor === 'agent' ? 'Agent' : 'Human'} replied to ${request.id}`;
      break;
    }
    case 'feedback.submit': {
      if (actor !== 'human') throw new DomainError('Only a human can submit a review feedback package.', 403, 'actor_not_allowed');
      const afterRevision = payload.afterRevision ?? 0;
      if (!Number.isInteger(afterRevision) || afterRevision < 0 || afterRevision > current.revision) throw new DomainError('afterRevision must reference a revision in this Task.');
      const packageId = cleanId(payload.packageId, 'feedback package ID');
      if (task.feedbackPackages.some((item) => item.id === packageId)) throw new DomainError(`Feedback package ${packageId} already exists.`, 409, 'duplicate_feedback_package');
      const includedEvents = current.events.filter((event) => event.revision > afterRevision);
      const packageRecord = {
        id: packageId,
        iteration: task.iteration,
        afterRevision,
        throughRevision: current.revision,
        eventIds: includedEvents.map((event) => event.id),
        reviewOutcomes: task.changesets.filter((item) => item.active !== false).map((item) => ({ changesetId: item.id, status: item.review?.status || 'pending', feedback: item.review?.feedback || '' })),
        knowledge: [
          ...task.decisions.map((item) => ({ kind: 'decision', id: item.id, revision: item.revision, status: item.status })),
          ...task.assumptions.map((item) => ({ kind: 'assumption', id: item.id, revision: item.revision, status: item.status, needsInvestigation: item.needsInvestigation })),
        ],
        submittedAt: now,
      };
      task.feedbackPackages.push(packageRecord);
      task.status = 'agent';
      task.iteration += 1;
      targets.push({ kind: 'task', id: task.taskId });
      eventType = 'feedback.submitted';
      eventPayload = packageRecord;
      summary = `Feedback package ${packageId} sent to agent`;
      break;
    }
    case 'iteration.complete': {
      requireAgent(actor);
      if (task.status !== 'agent') throw new DomainError('There is no submitted feedback package awaiting agent preparation.', 409, 'iteration_not_in_agent_state');
      task.status = 'review';
      targets.push({ kind: 'task', id: task.taskId });
      eventType = 'iteration.prepared';
      eventPayload = { iteration: task.iteration, summary: cleanText(payload.summary || '', 'iteration summary', 4_000, true) };
      summary = `Agent prepared iteration ${task.iteration} for review`;
      break;
    }
    case 'knowledge.upsert': {
      const kind = payload.kind;
      if (!['decision', 'assumption'].includes(kind)) throw new DomainError('Knowledge kind must be decision or assumption.');
      const collection = kind === 'decision' ? task.decisions : task.assumptions;
      const id = cleanId(payload.id, 'knowledge id');
      const title = cleanText(payload.title, 'knowledge title', 2_000);
      const links = normalizeChangeLinks(task, payload.links);
      const previous = collection.find((item) => item.id === id);
      const status = String(payload.status || previous?.status || (kind === 'decision' ? 'active' : 'unverified'));
      if (kind === 'assumption' && !['unverified', 'verified', 'rejected'].includes(status)) throw new DomainError('Assumptions can be unverified, verified, or rejected; they cannot be canceled.');
      if (kind === 'decision' && !['active', 'rejected', 'cancelled'].includes(status)) throw new DomainError('Invalid decision status.');
      const reason = status === 'rejected' ? cleanText(payload.rejectionReason || '', 'rejection reason', 4_000, true) : '';
      const record = {
        id, title, status, links,
        revision: (previous?.revision || 0) + 1,
        ...(kind === 'assumption' ? { rejectionReason: reason, needsInvestigation: status === 'rejected' && !reason } : {}),
        updatedAt: now,
      };
      if (previous) Object.assign(previous, record); else collection.push(record);
      targets.push({ kind, id }, ...[...new Set([...(previous?.links || []), ...links])].map((changesetId) => ({ kind: 'changeset', id: changesetId })));
      eventType = `${kind}.${previous ? 'updated' : 'created'}`;
      eventPayload = { ...record };
      summary = `${kind === 'decision' ? 'Decision' : 'Assumption'} ${id} ${previous ? 'updated' : 'added'}`;
      break;
    }
    case 'changeset.upsert': {
      const change = normalizeChangeset(task, payload.changeset);
      const previous = task.changesets.find((item) => item.id === change.id);
      if (previous) {
        const preservedReview = previous.review;
        Object.assign(previous, change);
        previous.implementationHistory ||= [];
        const latestImplementation = previous.implementationHistory.at(-1);
        if (latestImplementation?.revision !== change.implementation.revision || latestImplementation?.patchFingerprint !== change.implementation.patchFingerprint) previous.implementationHistory.push(structuredClone(change.implementation));
        previous.review = preservedReview;
      } else {
        task.changesets.push({ ...change, review: { status: 'pending', basis: null }, implementationHistory: [structuredClone(change.implementation)], active: true });
      }
      assertAcyclic(task);
      targets.push({ kind: 'changeset', id: change.id }, ...change.deps.map((id) => ({ kind: 'changeset', id })));
      eventType = `changeset.${previous ? 'implementation.updated' : 'created'}`;
      eventPayload = { changeset: change };
      summary = `Changeset ${change.id} ${previous ? 'implementation updated' : 'created'}`;
      break;
    }
    case 'changeset.dependencies.set': {
      const change = activeChangeset(task, payload.changesetId);
      const dependencies = [...new Set((payload.dependencies || []).map((id) => cleanId(id, 'dependency id')))];
      if (dependencies.includes(change.id)) throw new DomainError('A Changeset cannot depend on itself.');
      for (const id of dependencies) activeChangeset(task, id);
      const oldDeps = change.deps;
      change.deps = dependencies;
      if (hasCycle(task.changesets.filter((item) => item.active !== false))) {
        change.deps = oldDeps;
        throw new DomainError('These dependencies would create a cycle.', 409, 'dependency_cycle');
      }
      targets.push({ kind: 'changeset', id: change.id }, ...[...new Set([...oldDeps, ...dependencies])].map((id) => ({ kind: 'changeset', id })));
      eventType = 'changeset.dependencies.updated';
      eventPayload = { changesetId: change.id, previous: oldDeps, dependencies };
      summary = `Dependencies for ${change.id} updated`;
      break;
    }
    case 'changeset.review': {
      const change = activeChangeset(task, payload.changesetId);
      const status = payload.status;
      if (!reviewStatuses.has(status)) throw new DomainError('Invalid Changeset review status.');
      const feedback = status === 'changes' ? cleanText(payload.feedback, 'feedback', 8_000) : '';
      const previousStatus = change.review?.status || 'pending';
      change.review = { status, feedback, basis: status === 'approved' ? approvalBasis(task, change) : null, updatedAt: now };
      targets.push({ kind: 'changeset', id: change.id });
      eventType = 'changeset.reviewed';
      eventPayload = { changesetId: change.id, previousStatus, status, feedback };
      summary = `${change.id} ${status === 'changes' ? 'needs changes' : status}`;
      break;
    }
    case 'changeset.split.apply': {
      requireAgent(actor);
      const source = activeChangeset(task, payload.sourceId);
      const parts = payload.changesets;
      if (!Array.isArray(parts) || parts.length < 2) throw new DomainError('A split requires at least two resulting Changesets.');
      const children = parts.map((item) => normalizeChangeset(task, { ...item, deps: [...(item.deps || source.deps)] }));
      if (children.some((child) => task.changesets.some((existing) => existing.id === child.id) || children.filter((candidate) => candidate.id === child.id).length > 1)) throw new DomainError('Split result IDs must be unique and new.');
      source.active = false; source.review = { ...source.review, status: 'split', updatedAt: now }; source.splitInto = children.map((child) => child.id);
      for (const child of children) task.changesets.push({ ...child, active: true, splitFrom: source.id, review: { status: 'pending', basis: null }, implementationHistory: [structuredClone(child.implementation)] });
      for (const item of task.changesets.filter((candidate) => candidate.active !== false && !children.some((child) => child.id === candidate.id))) {
        if (item.deps.includes(source.id)) item.deps = [...new Set(item.deps.flatMap((id) => id === source.id ? children.map((child) => child.id) : [id]))];
      }
      assertAcyclic(task);
      targets.push({ kind: 'changeset', id: source.id }, ...children.map((child) => ({ kind: 'changeset', id: child.id })));
      eventType = 'changeset.split';
      eventPayload = { sourceId: source.id, results: children.map(({ id, title }) => ({ id, title })) };
      summary = `${source.id} split into ${children.map((child) => child.id).join(', ')}`;
      break;
    }
    case 'changeset.merge.apply': {
      requireAgent(actor);
      const sources = [...new Set(payload.sourceIds || [])].map((id) => activeChangeset(task, id));
      if (sources.length < 2) throw new DomainError('A merge requires at least two active Changesets.');
      const merged = normalizeChangeset(task, { ...payload.result, deps: [...new Set(sources.flatMap((item) => item.deps).filter((id) => !sources.some((source) => source.id === id)))] });
      if (task.changesets.some((item) => item.id === merged.id)) throw new DomainError(`Changeset ${merged.id} already exists.`, 409, 'duplicate_changeset');
      for (const source of sources) { source.active = false; source.mergedInto = merged.id; source.review = { ...source.review, status: 'merged', updatedAt: now }; }
      task.changesets.push({ ...merged, active: true, mergedFrom: sources.map((item) => item.id), review: { status: 'pending', basis: null }, implementationHistory: [structuredClone(merged.implementation)] });
      for (const item of task.changesets.filter((candidate) => candidate.active !== false && candidate.id !== merged.id)) {
        if (item.deps.some((id) => sources.some((source) => source.id === id))) item.deps = [...new Set(item.deps.map((id) => sources.some((source) => source.id === id) ? merged.id : id))];
      }
      assertAcyclic(task);
      targets.push(...sources.map((source) => ({ kind: 'changeset', id: source.id })), { kind: 'changeset', id: merged.id });
      eventType = 'changeset.merged';
      eventPayload = { sourceIds: sources.map((item) => item.id), result: { id: merged.id, title: merged.title } };
      summary = `${sources.map((item) => item.id).join(', ')} merged into ${merged.id}`;
      break;
    }
    case 'implementation.finalize': {
      requireAgent(actor);
      const change = activeChangeset(task, payload.changesetId);
      const before = change.implementation.patchFingerprint;
      const bundle = payload.commitBundle;
      if (!bundle || !Array.isArray(bundle.commits) || bundle.commits.length !== 1) throw new DomainError('Finalization must produce exactly one commit for a Changeset.');
      const next = normalizeCommitBundle(bundle);
      change.implementationHistory.push({ ...structuredClone(change.implementation), supersededAt: now, note: 'Before prepare-for-merge history rewrite' });
      change.implementation = { ...change.implementation, commitBundle: next };
      if (payload.patchFingerprint && payload.patchFingerprint !== before) change.implementation.patchFingerprint = cleanText(payload.patchFingerprint, 'patch fingerprint', 200);
      change.implementationHistory.push(structuredClone(change.implementation));
      if (change.implementation.patchFingerprint !== before) invalidateApproval(change, 'Patch content changed during finalization.');
      targets.push({ kind: 'changeset', id: change.id });
      eventType = 'implementation.history.rewritten';
      eventPayload = { changesetId: change.id, previousCommitCount: payload.previousCommitCount ?? null, currentCommitCount: 1, patchFingerprintUnchanged: change.implementation.patchFingerprint === before, commitBundle: next };
      summary = `Finalized ${change.id} to one commit`;
      break;
    }
    default:
      throw new DomainError(`Unsupported command: ${type}`);
  }

  task.revision = current.revision + 1;
  task.updatedAt = now;
  appendEvent(task, { id: eventId, commandId, commandHash, revision: task.revision, type: eventType, actor, targets: uniqueTargets(targets.length ? targets : [{ kind: 'task', id: task.taskId }]), payload: eventPayload, summary, at: now });
  const invalidated = revalidateApprovals(task, now);
  if (invalidated.length) appendEvent(task, { id: `${eventId}:approvals`, commandId, revision: task.revision, type: 'approvals.invalidated', actor: 'system', targets: invalidated.map((id) => ({ kind: 'changeset', id })), payload: { changesetIds: invalidated, reason: 'Implementation, dependency, or linked engineering knowledge changed.' }, summary: `${invalidated.length} approval(s) need another review`, at: now });
  return task;
}

export function documentSize(document) {
  return new TextEncoder().encode(JSON.stringify(document)).byteLength;
}

export function validateTaskDocument(document) {
  if (!document || document.schemaVersion !== SCHEMA_VERSION || typeof document.taskId !== 'string' || !Number.isInteger(document.revision) || document.revision < 1 || !Array.isArray(document.events)) {
    throw new DomainError('Task document is invalid or uses an unsupported schema.');
  }
  const bytes = documentSize(document);
  if (bytes > MAX_DOCUMENT_BYTES) throw new DomainError(`Task document is ${bytes} bytes; the configured limit is ${MAX_DOCUMENT_BYTES}.`, 413, 'document_too_large');
  return bytes;
}

function cleanText(value, name, max, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > max) throw new DomainError(`${name} must be ${allowEmpty ? 'a string' : 'non-empty text'} up to ${max} characters.`);
  return value.trim();
}

function cleanId(value, name) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(value)) throw new DomainError(`${name} is invalid.`);
  return value;
}

function normalizeTargets(task, targets) {
  if (targets == null || targets.length === 0) return [{ kind: 'task', id: task.taskId }];
  if (!Array.isArray(targets)) throw new DomainError('targets must be an array.');
  const normalized = targets.map(({ kind, id }) => {
    if (!validKinds.has(kind) || typeof id !== 'string') throw new DomainError('Every target needs a supported kind and ID.');
    if (kind === 'task' && id === task.taskId) return { kind, id };
    const collection = kind === 'changeset' ? task.changesets : kind === 'decision' ? task.decisions : kind === 'assumption' ? task.assumptions : kind === 'request' ? task.requests : [];
    if (!collection.some((item) => item.id === id)) throw new DomainError(`Target ${kind}:${id} was not found.`, 404, 'target_not_found');
    return { kind, id };
  });
  return uniqueTargets(normalized);
}

function normalizeChangeLinks(task, links) {
  if (links == null) return [];
  if (!Array.isArray(links)) throw new DomainError('Knowledge links must be an array of Changeset IDs.');
  const ids = [...new Set(links.map((id) => cleanId(id, 'knowledge Changeset link')))];
  for (const id of ids) activeChangeset(task, id);
  return ids;
}

function normalizeChangeset(task, value) {
  if (!value || typeof value !== 'object') throw new DomainError('changeset is required.');
  const id = cleanId(value.id, 'Changeset ID');
  const deps = [...new Set((value.deps || []).map((dep) => cleanId(dep, 'dependency ID')))];
  for (const dep of deps) if (dep !== id) activeChangeset(task, dep);
  const implementation = value.implementation || {};
  if (!implementation.patchFingerprint) throw new DomainError('A Changeset implementation requires a patchFingerprint.');
  const normalized = {
    id,
    title: cleanText(value.title, 'Changeset title', 200),
    intent: cleanText(value.intent || '', 'Changeset intent', 4_000, true),
    deps,
    implementation: {
      revision: Number.isInteger(implementation.revision) ? implementation.revision : 1,
      patchFingerprint: cleanText(implementation.patchFingerprint, 'patch fingerprint', 200),
      commitBundle: normalizeCommitBundle(implementation.commitBundle),
    },
    knowledgeLinks: {
      decisions: normalizeKnowledgeIds(value.knowledgeLinks?.decisions, 'decision link'),
      assumptions: normalizeKnowledgeIds(value.knowledgeLinks?.assumptions, 'assumption link'),
    },
    status: value.status || 'pending',
  };
  if (normalized.deps.includes(id)) throw new DomainError('A Changeset cannot depend on itself.');
  for (const knowledgeId of normalized.knowledgeLinks.decisions) if (!task.decisions.some((item) => item.id === knowledgeId)) throw new DomainError(`Decision ${knowledgeId} was not found.`, 404, 'target_not_found');
  for (const knowledgeId of normalized.knowledgeLinks.assumptions) if (!task.assumptions.some((item) => item.id === knowledgeId)) throw new DomainError(`Assumption ${knowledgeId} was not found.`, 404, 'target_not_found');
  return normalized;
}

function normalizeKnowledgeIds(ids, name) {
  if (ids == null) return [];
  if (!Array.isArray(ids)) throw new DomainError(`${name}s must be an array of stable IDs.`);
  return [...new Set(ids.map((id) => cleanId(id, name)))];
}

function normalizeCommitBundle(bundle = {}) {
  if (!Array.isArray(bundle.commits) || bundle.commits.length < 1 || bundle.commits.length > 20) throw new DomainError('A commit bundle must contain between one and 20 commits.');
  return {
    revisionId: cleanText(bundle.revisionId || 'revision-1', 'revision ID', 100),
    commits: bundle.commits.map((commit, index) => ({
      sha: cleanText(commit.sha, 'commit SHA', 100),
      order: Number.isInteger(commit.order) ? commit.order : index + 1,
      subject: cleanText(commit.subject || '', 'commit subject', 200, true),
    })),
  };
}

function approvalBasis(task, change) {
  const knowledge = [
    ...change.knowledgeLinks.decisions.map((id) => task.decisions.find((item) => item.id === id)),
    ...change.knowledgeLinks.assumptions.map((id) => task.assumptions.find((item) => item.id === id)),
  ].filter(Boolean).map(({ id, revision, status, title, rejectionReason }) => ({ id, revision, status, title, rejectionReason })).sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify({
    patchFingerprint: change.implementation.patchFingerprint,
    dependencies: dependencyBasis(task, change, new Set()),
    knowledge,
  });
}

function dependencyBasis(task, change, seen) {
  if (seen.has(change.id)) return [];
  const nextSeen = new Set(seen).add(change.id);
  return [...change.deps].sort().map((id) => {
    const dependency = task.changesets.find((item) => item.id === id && item.active !== false);
    if (!dependency) return { id, missing: true };
    return {
      id,
      patchFingerprint: dependency.implementation.patchFingerprint,
      knowledge: linkedKnowledge(task, dependency),
      downstream: dependencyBasis(task, dependency, nextSeen),
    };
  });
}

function linkedKnowledge(task, change) {
  return [
    ...change.knowledgeLinks.decisions.map((id) => task.decisions.find((item) => item.id === id)),
    ...change.knowledgeLinks.assumptions.map((id) => task.assumptions.find((item) => item.id === id)),
  ].filter(Boolean)
    .map(({ id, revision, status, title, rejectionReason }) => ({ id, revision, status, title, rejectionReason }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function revalidateApprovals(task, now) {
  const invalidated = [];
  for (const change of task.changesets.filter((item) => item.active !== false && item.review?.status === 'approved')) {
    if (change.review.basis !== approvalBasis(task, change)) {
      invalidateApproval(change, 'Implementation, dependency, or linked engineering knowledge changed.', now);
      invalidated.push(change.id);
    }
  }
  return invalidated;
}

function invalidateApproval(change, reason, now = new Date().toISOString()) {
  change.review = { ...change.review, status: 'recheck', invalidationReason: reason, updatedAt: now };
}

function activeChangeset(task, id) {
  const change = task.changesets.find((item) => item.id === id && item.active !== false);
  if (!change) throw new DomainError(`Active Changeset ${id} was not found.`, 404, 'changeset_not_found');
  return change;
}

function requireAgent(actor) {
  if (actor !== 'agent') throw new DomainError('This operation must be proposed by the agent.', 403, 'actor_not_allowed');
}

function appendEvent(task, event) {
  task.events.push({
    id: event.id,
    commandId: event.commandId || null,
    commandHash: event.commandHash || null,
    revision: event.revision || task.revision,
    ordinal: task.events.filter((item) => item.revision === (event.revision || task.revision)).length + 1,
    type: event.type,
    actor: event.actor,
    targets: uniqueTargets(event.targets),
    payload: event.payload || {},
    summary: event.summary || event.type,
    at: event.at,
  });
}

function uniqueTargets(targets) {
  const map = new Map(targets.map((target) => [`${target.kind}:${target.id}`, target]));
  return [...map.values()];
}

function hasCycle(changesets) {
  const map = new Map(changesets.map((item) => [item.id, item.deps || []]));
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of map.get(id) || []) if (map.has(dependency) && visit(dependency)) return true;
    visiting.delete(id); visited.add(id); return false;
  }
  return [...map.keys()].some(visit);
}

function assertAcyclic(task) {
  if (hasCycle(task.changesets.filter((item) => item.active !== false))) throw new DomainError('These dependencies would create a cycle.', 409, 'dependency_cycle');
}
