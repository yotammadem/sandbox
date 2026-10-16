const initialState = {
  iteration:3,selected:'CS-03',page:'graph',pending:[],feedbackHistory:[],
  changesets:[
    {id:'CS-01',title:'הסרת Wrapper מיותר',description:'פונקציית מעטפת שהעבירה את כל הפרמטרים ללא שינוי הוסרה. הקריאות משתמשות כעת בפונקציה המקורית.',status:'approved',deps:[],rev:1,hash:'8c1e0f2',files:['BaselineLookup.cs'],stats:'−24 / +7',diff:['- return ResolveBaselineWrapper(request);','+ return ResolveBaseline(request);'],history:[{rev:1,hash:'8c1e0f2',note:'הצעה מקורית'}]},
    {id:'CS-02',title:'פישוט בחירת Baseline',description:'איחוד התנאים לבחירת baseline לפי revision, בלי לשנות סדר חיפוש או תוצאות.',status:'approved',deps:[],rev:2,hash:'d50a3bd',files:['BaselineResolver.cs'],stats:'−31 / +15',diff:['- if (revision != null) {','-   return ResolveAtRevision(revision);','- }','- return ResolveLatest();','+ return Resolve(revision);'],history:[{rev:1,hash:'b19f2a1',note:'הצעה מקורית'},{rev:2,hash:'d50a3bd',note:'פישוט לאחר ביקורת'}]},
    {id:'CS-03',title:'צמצום מסלולי Fallback',description:'איחוד זרימות fallback שמחזירות את אותה תוצאה. הסוקר סימן Timeout: קשה לאמת שכל מקרי הקצה נשמרו.',status:'timeout',deps:['CS-01'],rev:3,hash:'c72e18a',files:['QueryTranslator.cs','FallbackResolver.cs'],stats:'−62 / +28',diff:['- if (isUnsupported) {','-   return FetchAndFilter(query);','- }','- if (!canTranslate) {','-   return FetchAndFilter(query);','- }','+ if (isUnsupported || !canTranslate) {','+   return FetchAndFilter(query);','+ }'],history:[{rev:1,hash:'a83f21c',note:'ניסיון ראשון — Timeout'},{rev:2,hash:'b91c420',note:'פוצל ונשלח שוב'},{rev:3,hash:'c72e18a',note:'הגרסה הנוכחית'}]},
    {id:'CS-04',title:'הסרת State שאינו נחוץ',description:'החלפת state מקומי בחישוב ישיר. המפתח ביקש לשמר את אירועי ה־telemetry.',status:'changes',deps:['CS-02'],rev:2,hash:'e9b13f0',files:['LookupSession.cs'],stats:'−19 / +4',diff:['- var wasResolved = false;','- wasResolved = Resolve(session);','- return wasResolved;','+ return Resolve(session);'],history:[{rev:1,hash:'0ae433e',note:'הצעה מקורית'},{rev:2,hash:'e9b13f0',note:'שינוי מבנה'}]},
    {id:'CS-05',title:'איחוד עיבוד התוצאה',description:'שכבת mapping אחידה לשני המסלולים, תוך שמירה על מבנה התגובה החיצוני.',status:'pending',deps:['CS-03','CS-04'],rev:1,hash:'f31d920',files:['LookupResultMapper.cs'],stats:'−42 / +18',diff:['- return MapLegacyResult(result);','- return MapIndexedResult(result);','+ return MapResult(result);'],history:[{rev:1,hash:'f31d920',note:'הצעה מקורית'}]}
  ],
  decisions:[
    {id:'D-01',title:'Fallback רק כשהביטוי אינו נתמך',status:'accepted',links:['CS-03']},
    {id:'D-02',title:'כישלון Retry נשמר לכל Baseline Revision',status:'accepted',links:['CS-02','CS-03']},
    {id:'D-03',title:'לא להוסיף Cache גלובלי לתוצאות Lookup',status:'rejected',links:['CS-04']},
    {id:'D-04',title:'לשמר את סדר התוצאות ואת חוזה ה־API',status:'accepted',links:['CS-05']}
  ],
  assumptions:[
    {id:'A-01',title:'Partition key ידוע בכל קריאת Lookup',status:'verified',links:['CS-02']},
    {id:'A-02',title:'מסלול Legacy אינו מפעיל את ה־Fallback החדש',status:'unverified',links:['CS-03']},
    {id:'A-03',title:'הסרת State לא משנה אירועי Telemetry',status:'unverified',links:['CS-04']}
  ],
  activity:[
    {title:'Timeout Reject ב־CS-03',detail:'נדרשת גרסה שקל יותר לאמת בשלוש דקות.',time:'לפני 12 דקות'},
    {title:'Request Changes ב־CS-04',detail:'לוודא שאירועי telemetry נשמרים.',time:'לפני 28 דקות'},
    {title:'CS-01 ו־CS-02 אושרו',detail:'שני מסלולים עצמאיים קיבלו אישור.',time:'היום, 08:10'},
    {title:'סבב 3 נפתח',detail:'הסוכן הכין חמישה Changesets לביקורת.',time:'היום, 07:45'}
  ]
};

export const STORAGE_KEY = 'changeflow-demo-v1';

export function createInitialState() {
  return structuredClone(initialState);
}

export function loadState(storage = globalThis.localStorage) {
  try {
    const saved = storage?.getItem(STORAGE_KEY);
    const state = saved ? JSON.parse(saved) : createInitialState();
    state.feedbackHistory ||= [];
    return state;
  } catch {
    return createInitialState();
  }
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
    if (!affected.has(change.id)) continue;
    change.rev += 1;
    change.hash = simulatedHash(change.id, change.rev, state.iteration);
    change.history.push({ rev: change.rev, hash: change.hash, note: 'סימולציה: גרסה חדשה אחרי פידבק' });
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
