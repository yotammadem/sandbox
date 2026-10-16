const initialState = {
  iteration:3,selected:'CS-03',page:'graph',pending:[],feedbackHistory:[],
  changesets:[
    {id:'CS-01',title:'Remove a redundant wrapper',description:'Removed a pass-through wrapper. Call sites now use the original function directly.',status:'approved',deps:[],rev:1,hash:'8c1e0f2',files:['BaselineLookup.cs'],stats:'−24 / +7',diff:['- return ResolveBaselineWrapper(request);','+ return ResolveBaseline(request);'],history:[{rev:1,hash:'8c1e0f2',note:'Initial proposal'}]},
    {id:'CS-02',title:'Simplify baseline selection',description:'Consolidate baseline selection by revision without changing search order or results.',status:'approved',deps:[],rev:2,hash:'d50a3bd',files:['BaselineResolver.cs'],stats:'−31 / +15',diff:['- if (revision != null) {','-   return ResolveAtRevision(revision);','- }','- return ResolveLatest();','+ return Resolve(revision);'],history:[{rev:1,hash:'b19f2a1',note:'Initial proposal'},{rev:2,hash:'d50a3bd',note:'Simplified after review'}]},
    {id:'CS-03',title:'Reduce fallback paths',description:'Consolidate fallback paths that return the same result. The reviewer timed out because it was difficult to verify every edge case.',status:'timeout',deps:['CS-01'],rev:3,hash:'c72e18a',files:['QueryTranslator.cs','FallbackResolver.cs'],stats:'−62 / +28',diff:['- if (isUnsupported) {','-   return FetchAndFilter(query);','- }','- if (!canTranslate) {','-   return FetchAndFilter(query);','- }','+ if (isUnsupported || !canTranslate) {','+   return FetchAndFilter(query);','+ }'],history:[{rev:1,hash:'a83f21c',note:'First attempt — timed out'},{rev:2,hash:'b91c420',note:'Split and resubmitted'},{rev:3,hash:'c72e18a',note:'Current revision'}]},
    {id:'CS-04',title:'Remove unnecessary state',description:'Replace local state with a direct computation. The reviewer asked to preserve telemetry events.',status:'changes',deps:['CS-02'],rev:2,hash:'e9b13f0',files:['LookupSession.cs'],stats:'−19 / +4',diff:['- var wasResolved = false;','- wasResolved = Resolve(session);','- return wasResolved;','+ return Resolve(session);'],history:[{rev:1,hash:'0ae433e',note:'Initial proposal'},{rev:2,hash:'e9b13f0',note:'Restructured'}]},
    {id:'CS-05',title:'Unify result mapping',description:'Use one mapping layer for both paths while preserving the external response shape.',status:'pending',deps:['CS-03','CS-04'],rev:1,hash:'f31d920',files:['LookupResultMapper.cs'],stats:'−42 / +18',diff:['- return MapLegacyResult(result);','- return MapIndexedResult(result);','+ return MapResult(result);'],history:[{rev:1,hash:'f31d920',note:'Initial proposal'}]}
  ],
  decisions:[
    {id:'D-01',title:'Use fallback only for unsupported expressions',status:'accepted',links:['CS-03']},
    {id:'D-02',title:'Cache retry failure per baseline revision',status:'accepted',links:['CS-02','CS-03']},
    {id:'D-03',title:'Do not add a global lookup cache',status:'rejected',links:['CS-04']},
    {id:'D-04',title:'Preserve result ordering and the API contract',status:'accepted',links:['CS-05']},
    {id:'D-05',title:'Use temporary shared lookup state',status:'cancelled',links:['CS-04']}
  ],
  assumptions:[
    {id:'A-01',title:'The partition key is known for every lookup',status:'verified',links:['CS-02']},
    {id:'A-02',title:'The legacy path does not use the new fallback',status:'unverified',links:['CS-03']},
    {id:'A-03',title:'Removing state does not change telemetry events',status:'unverified',links:['CS-04']}
  ],
  activity:[
    {title:'Timeout rejection on CS-03',detail:'Prepare a revision that is easier to verify within three minutes.',time:'12 minutes ago'},
    {title:'Changes requested on CS-04',detail:'Verify that telemetry events are preserved.',time:'28 minutes ago'},
    {title:'CS-01 and CS-02 approved',detail:'Two independent workstreams were approved.',time:'Today, 08:10'},
    {title:'Iteration 3 started',detail:'The agent prepared five Changesets for review.',time:'Today, 07:45'}
  ]
};

export const STORAGE_KEY = 'changeflow-demo-v1';

export function createInitialState() {
  const state = structuredClone(initialState);
  state.changesets.forEach((change) => { change.active = true; });
  state.eventLog = state.activity.map((item, index) => ({
    id: `EV-${String(index + 1).padStart(4, '0')}`, type: 'action', action: 'legacy',
    summary: item.title, body: item.detail, at: item.time,
    targets: [...new Set([...(item.title.match(/CS-\d+/g) || []), ...(item.detail.match(/CS-\d+/g) || [])])].map((id) => ({ kind: 'changeset', id })),
  }));
  return state;
}

const legacyText = new Map([
  ['Fallback רק כשהביטוי אינו נתמך', 'Use fallback only for unsupported expressions'],
  ['כישלון Retry נשמר לכל Baseline Revision', 'Cache retry failure per baseline revision'],
  ['לא להוסיף Cache גלובלי לתוצאות Lookup', 'Do not add a global lookup cache'],
  ['לשמר את סדר התוצאות ואת חוזה ה־API', 'Preserve result ordering and the API contract'],
  ['Partition key ידוע בכל קריאת Lookup', 'The partition key is known for every lookup'],
  ['מסלול Legacy אינו מפעיל את ה־Fallback החדש', 'The legacy path does not use the new fallback'],
  ['הסרת State לא משנה אירועי Telemetry', 'Removing state does not change telemetry events'],
  ['הצעה מקורית', 'Initial proposal'],
  ['פישוט לאחר ביקורת', 'Simplified after review'],
  ['ניסיון ראשון — Timeout', 'First attempt — timed out'],
  ['פוצל ונשלח שוב', 'Split and resubmitted'],
  ['הגרסה הנוכחית', 'Current revision'],
  ['שינוי מבנה', 'Restructured'],
  ['סימולציה: גרסה חדשה אחרי פידבק', 'Simulated revision after feedback'],
  ['Timeout Reject ב־CS-03', 'Timeout rejection on CS-03'],
  ['Request Changes ב־CS-04', 'Changes requested on CS-04'],
  ['CS-01 ו־CS-02 אושרו', 'CS-01 and CS-02 approved'],
  ['סבב 3 נפתח', 'Iteration 3 started'],
  ['היום, 07:45', 'Today, 07:45'],
  ['היום, 08:10', 'Today, 08:10'],
  ['לפני 12 דקות', '12 minutes ago'],
  ['לפני 28 דקות', '28 minutes ago'],
  ['אושר', 'Approved'],
  ['נדרש תיקון', 'Changes requested'],
  ['ממתין', 'Pending'],
  ['אישור', 'Approve'],
  ['ללא נימוק', 'No explanation'],
  ['ללא פירוט', 'No details provided'],
  ['תלויות עודכנו:', 'Dependencies updated:'],
  ['נדרשת גרסה שקל יותר לאמת בשלוש דקות.', 'Prepare a revision that is easier to verify within three minutes.'],
  ['לוודא שאירועי telemetry נשמרים.', 'Verify that telemetry events are preserved.'],
  ['שני מסלולים עצמאיים קיבלו אישור.', 'Two independent workstreams were approved.'],
  ['הסוכן הכין חמישה Changesets לביקורת.', 'The agent prepared five Changesets for review.'],
  ['Timeout Reject ללא נימוק', 'Timeout reject — no explanation'],
  ['דחיית Timeout ללא נימוק', 'Timeout reject — no explanation'],
  ['תלויות חדשות:', 'New dependencies:'],
]);

function translateLegacyText(value) {
  let translated = legacyText.get(value) || value;
  const replacements = [
    [/^סבב (\d+) הוכן \(סימולציה\)$/, 'Iteration $1 prepared (simulation)'],
    [/^תלויות של (CS-\d+) עודכנו$/, 'Dependencies for $1 updated'],
    [/^תלויות עודכנו: (.*)$/, 'Dependencies updated: $1'],
    [/^תלויות חדשות: (.*)$/, 'New dependencies: $1'],
    [/^בקשת תיקון: ?/, 'Request changes: '],
    [/^סטטוס קודם: ?/, 'Previous status: '],
    [/^נוספה החלטה (D-\d+)$/, 'Added decision $1'],
    [/^עודכנה החלטה (D-\d+)$/, 'Updated decision $1'],
    [/^נוספה הנחה (A-\d+)$/, 'Added assumption $1'],
    [/^עודכנה הנחה (A-\d+)$/, 'Updated assumption $1'],
    [/^אושר · (CS-\d+)$/, 'Approved · $1'],
    [/^נדרש תיקון · (CS-\d+)$/, 'Changes requested · $1'],
    [/^ממתין · (CS-\d+)$/, 'Pending · $1'],
  ];
  for (const [pattern, replacement] of replacements) {
    if (pattern.test(translated)) {
      translated = translated.replace(pattern, replacement);
      break;
    }
  }
  for (const [oldText, newText] of [...legacyText].sort(([left], [right]) => right.length - left.length)) {
    if (translated.includes(oldText)) translated = translated.replaceAll(oldText, newText);
  }
  return translated;
}

function migrateLegacyState(state) {
  const english = createInitialState();
  const englishChangesets = new Map(english.changesets.map((change) => [change.id, change]));
  for (const change of state.changesets || []) {
    const seed = englishChangesets.get(change.id);
    if (!seed) continue;
    change.title = seed.title;
    change.description = seed.description;
    change.history = (change.history || []).map((revision) => ({
      ...revision,
      note: translateLegacyText(revision.note),
    }));
  }
  for (const record of [...(state.decisions || []), ...(state.assumptions || [])]) {
    record.title = translateLegacyText(record.title);
  }
  state.activity = (state.activity || []).map((item) => ({
    ...item,
    title: translateLegacyText(item.title),
    detail: translateLegacyText(item.detail),
    time: translateLegacyText(item.time),
  }));
  for (const item of state.pending || []) {
    item.detail = translateLegacyText(item.detail);
    item.time = translateLegacyText(item.time);
  }
  for (const batch of state.feedbackHistory || []) {
    batch.items = (batch.items || []).map((item) => ({
      ...item,
      detail: translateLegacyText(item.detail),
      time: translateLegacyText(item.time),
    }));
  }
  return state;
}

export function loadState(storage = globalThis.localStorage) {
  try {
    const saved = storage?.getItem(STORAGE_KEY);
    const state = saved ? migrateLegacyState(JSON.parse(saved)) : createInitialState();
    state.feedbackHistory ||= [];
    state.eventLog ||= createInitialState().eventLog;
    state.changesets.forEach((change) => { change.active ??= true; });
    return state;
  } catch {
    return createInitialState();
  }
}

export function appendHistoryEvent(state, event) {
  state.eventLog ||= [];
  const sequence = state.eventLog.reduce((max, item) => Math.max(max, Number(item.id?.replace('EV-', '')) || 0), 0) + 1;
  const entry = {
    id: `EV-${String(sequence).padStart(4, '0')}`,
    type: event.type || 'action', action: event.action || 'update',
    summary: event.summary, body: event.body || '', at: event.at || new Date().toISOString(),
    targets: [...new Map((event.targets || []).map((target) => [`${target.kind}:${target.id}`, target])).values()],
  };
  state.eventLog.unshift(entry);
  state.eventLog = state.eventLog.slice(0, 300);
  return entry;
}

export function addComment(state, targets, body) {
  const text = String(body || '').trim();
  if (!text) throw new Error('A comment cannot be empty.');
  return appendHistoryEvent(state, { type: 'comment', action: 'comment', summary: 'Comment added', body: text, targets });
}

function nextChangesetId(state) {
  const max = state.changesets.reduce((n, c) => Math.max(n, Number(c.id.match(/\d+/)?.[0]) || 0), 0) + 1;
  return `CS-${String(max).padStart(2, '0')}`;
}

function replaceDependencies(state, removedIds, replacementId) {
  for (const change of state.changesets) {
    if (change.active === false || removedIds.includes(change.id)) continue;
    const had = (change.deps || []).some((id) => removedIds.includes(id));
    if (had) change.deps = [...new Set(change.deps.flatMap((id) => removedIds.includes(id) ? [replacementId] : [id]))];
  }
}

function queueStructure(state, type, ids, detail) {
  state.pending.push({ type: 'structure', id: ids[0], ids, detail, time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) });
}

export function splitChangeset(state, sourceId, titles) {
  const source = state.changesets.find((c) => c.id === sourceId && c.active !== false);
  const parts = (titles || []).map((title) => String(title).trim()).filter(Boolean);
  if (!source || parts.length < 2) throw new Error('Choose an active Changeset and at least two named results.');
  const children = parts.map((title) => {
    const id = nextChangesetId(state);
    const child = { ...structuredClone(source), id, title, description: `Split from ${source.id}. The agent will prepare this focused implementation in the next simulated iteration.`, status: 'pending', active: true, splitFrom: source.id, deps: [...source.deps], rev: 1, hash: simulatedHash(id, 1, state.iteration + 1), files: [...source.files], stats: 'pending agent revision', diff: [`# Simulated split result from ${source.id}`, `# ${title}`], history: [{ rev: 1, hash: simulatedHash(id, 1, state.iteration + 1), note: `Created by splitting ${source.id}` }] };
    state.changesets.push(child);
    return child;
  });
  source.active = false; source.status = 'split'; source.splitInto = children.map((c) => c.id);
  replaceDependencies(state, [source.id], children[0].id);
  for (const change of state.changesets) if (change.active !== false && change.deps.includes(children[0].id)) change.deps = [...new Set(change.deps.flatMap((id) => id === children[0].id ? children.map((c) => c.id) : [id]))];
  const ids = [source.id, ...children.map((c) => c.id)];
  queueStructure(state, 'split', children.map((c) => c.id), `Split ${source.id} into ${children.map((c) => c.id).join(', ')}`);
  appendHistoryEvent(state, { action: 'split', summary: `${source.id} split into ${children.map((c) => c.id).join(' and ')}`, body: `Resulting Changesets: ${children.map((c) => c.title).join('; ')}`, targets: ids.map((id) => ({ kind: 'changeset', id })) });
  return children;
}

export function mergeChangesets(state, ids, title) {
  const sources = [...new Set(ids)].map((id) => state.changesets.find((c) => c.id === id && c.active !== false));
  const name = String(title || '').trim();
  if (sources.length < 2 || sources.some((c) => !c) || !name) throw new Error('Choose at least two active Changesets and name the result.');
  const sourceIds = sources.map((c) => c.id), id = nextChangesetId(state);
  const child = { ...structuredClone(sources[0]), id, title: name, description: `Merged from ${sourceIds.join(', ')}. The agent will prepare this combined implementation in the next simulated iteration.`, status: 'pending', active: true, mergedFrom: sourceIds, deps: [...new Set(sources.flatMap((c) => c.deps).filter((dep) => !sourceIds.includes(dep)))], rev: 1, hash: simulatedHash(id, 1, state.iteration + 1), files: [...new Set(sources.flatMap((c) => c.files))], stats: 'pending agent revision', diff: [`# Simulated merge result from ${sourceIds.join(', ')}`, `# ${name}`], history: [{ rev: 1, hash: simulatedHash(id, 1, state.iteration + 1), note: `Created by merging ${sourceIds.join(', ')}` }] };
  state.changesets.push(child);
  sources.forEach((c) => { c.active = false; c.status = 'merged'; c.mergedInto = id; });
  replaceDependencies(state, sourceIds, id);
  queueStructure(state, 'merge', [id], `Merged ${sourceIds.join(', ')} into ${id}`);
  appendHistoryEvent(state, { action: 'merge', summary: `${sourceIds.join(' and ')} merged into ${id}`, body: `Resulting Changeset: ${name}`, targets: [...sourceIds, id].map((targetId) => ({ kind: 'changeset', id: targetId })) });
  return child;
}

export function reviewAssumption(state, id, status, reason = '') {
  const assumption = state.assumptions.find((item) => item.id === id);
  if (!assumption || !['verified', 'rejected', 'unverified'].includes(status)) throw new Error('Assumptions can be verified or rejected, not canceled.');
  assumption.status = status;
  assumption.rejectionReason = status === 'rejected' ? String(reason).trim() : '';
  assumption.needsInvestigation = status === 'rejected' && !assumption.rejectionReason;
  const detail = status === 'rejected' ? (assumption.rejectionReason || 'No reason provided; the agent should investigate why this assumption is false.') : `Assumption marked ${status}.`;
  state.pending.push({ type: 'assumption', id, detail: `Assumption ${id} ${status}: ${detail}`, time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) });
  appendHistoryEvent(state, { action: status, summary: `Assumption ${id} ${status}`, body: detail, targets: [{ kind: 'assumption', id }, ...assumption.links.map((targetId) => ({ kind: 'changeset', id: targetId }))] });
  return assumption;
}

export function saveState(state, storage = globalThis.localStorage) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage can be disabled or full; the in-memory demo remains usable.
  }
}

export function hasCycle(changesets) {
  const map = new Map(changesets.map((change) => [change.id, change.deps || []]));
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of map.get(id) || []) {
      if (visit(dependency)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  }
  return [...map.keys()].some(visit);
}

function feedbackRoots(state) {
  const affected = new Set();
  for (const item of state.pending) {
    // An approval records a human decision, but does not ask the agent to rewrite code.
    if (item.type === 'review' && item.status !== 'approved') affected.add(item.id);
    if (item.type === 'deps') affected.add(item.id);
    if (item.type === 'structure') item.ids?.forEach((id) => affected.add(id));
    if (item.type === 'assumption') {
      const assumption = state.assumptions.find((record) => record.id === item.id);
      assumption?.links.forEach((id) => affected.add(id));
    }
    if (item.type === 'record') {
      const records = item.id.startsWith('D-') ? state.decisions : state.assumptions;
      records.find((record) => record.id === item.id)?.links.forEach((id) => affected.add(id));
      item.ids?.forEach((id) => affected.add(id));
    }
  }
  return affected;
}

function includeDependents(changesets, roots) {
  const affected = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const change of changesets) {
      if (change.active === false) continue;
      if (!affected.has(change.id) && (change.deps || []).some((id) => affected.has(id))) {
        affected.add(change.id);
        changed = true;
      }
    }
  }
  return affected;
}

function simulatedHash(id, revision, iteration) {
  let value = 0x9e3779b1;
  for (const character of `${id}:${revision}:${iteration}`) {
    value = (Math.imul(value, 33) ^ character.charCodeAt(0)) >>> 0;
  }
  return value.toString(16).padStart(8, '0').slice(0, 7);
}

export function applyAgentIteration(state) {
  if (!state.pending.length) return { iteration: state.iteration, feedbackCount: 0, updatedIds: [] };

  const roots = feedbackRoots(state);
  const affected = includeDependents(state.changesets, roots);
  state.iteration += 1;
  const updatedIds = [];

  for (const change of state.changesets) {
    if (change.active === false) continue;
    if (!affected.has(change.id)) continue;
    change.rev += 1;
    change.hash = simulatedHash(change.id, change.rev, state.iteration);
    change.history.push({ rev: change.rev, hash: change.hash, note: 'Simulated revision after feedback' });
    change.status = 'pending';
    updatedIds.push(change.id);
  }

  const feedbackCount = state.pending.length;
  state.feedbackHistory ||= [];
  state.feedbackHistory.unshift({
    iteration: state.iteration,
    submittedAt: new Date().toISOString(),
    items: structuredClone(state.pending),
    updatedIds,
  });
  state.pending = [];
  return { iteration: state.iteration, feedbackCount, updatedIds };
}
