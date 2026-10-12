import { putFile, getFile, testConnection } from './lib/github.js';
import { rootReadme, problemReadme } from './lib/readme.js';
import { normLang, localDate, fetchGfgStats } from './lib/util.js';
import { emptyIndex, resolveTarget, commitMessage, upsertEntry } from './lib/sync.js';
import { requestDeviceCode, waitForToken, getLogin } from './lib/auth.js';

const DEFAULTS = { token: '', repo: '', branch: 'main', handle: '', enabled: true, template: 'Solved: {title} ({difficulty}) - {language}' };
const MAX_QUEUE = 50;
const RETRY_ALARM = 'retry';

async function getCfg() {
  const cfg = { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
  cfg.branch ||= DEFAULTS.branch;
  cfg.template ||= DEFAULTS.template;
  return cfg;
}

async function setStatus(ok, msg) {
  await chrome.storage.local.set({ lastStatus: { ok, msg, time: new Date().toISOString() } });
  await chrome.action.setBadgeText({ text: ok ? '✓' : '!' });
  await chrome.action.setBadgeBackgroundColor({ color: ok ? '#2e7d32' : '#c62828' });
}

// Serialize all work so concurrent submissions never race on problems.json
let chain = Promise.resolve();
const enqueue = (fn) => (chain = chain.then(fn, fn));

async function loadIndex(cfg) {
  const f = await getFile(cfg, 'problems.json');
  if (!f) return emptyIndex();
  try {
    return { ...emptyIndex(), ...JSON.parse(f.content) };
  } catch {
    throw new Error('problems.json in the repo is not valid JSON; fix or delete it');
  }
}

async function syncSubmission(cfg, sub) {
  const lang = normLang(sub.language, sub.code);
  const index = await loadIndex(cfg);
  const { base, difficulty } = resolveTarget(index, sub);
  const msg = commitMessage(cfg.template, { title: sub.title, difficulty, language: lang.name, slug: sub.slug });

  const solution = await putFile(cfg, `${base}/solution.${lang.ext}`, sub.code, msg);

  const today = localDate(new Date(sub.solvedAt));
  const { entry } = upsertEntry(index, { ...sub, difficulty }, lang, base, today);

  await putFile(cfg, `${base}/README.md`, problemReadme(entry), `Update README: ${sub.title}`);
  await putFile(cfg, 'problems.json', JSON.stringify(index, null, 2) + '\n', `Update index: ${sub.title}`);
  await putFile(cfg, 'README.md', rootReadme(index), 'Update stats README');
  return { changed: solution.changed };
}

async function pushToQueue(sub) {
  const { queue = [] } = await chrome.storage.local.get('queue');
  queue.push(sub);
  await chrome.storage.local.set({ queue: queue.slice(-MAX_QUEUE) });
}

async function handleSubmission(sub, fromQueue = false) {
  const cfg = await getCfg();
  if (!cfg.enabled) return { ok: false, msg: 'Sync disabled' };
  if (!cfg.token || !cfg.repo) {
    await setStatus(false, 'Set token and repo in the popup');
    return { ok: false, msg: 'Not configured' };
  }
  try {
    const { changed } = await syncSubmission(cfg, sub);
    await setStatus(true, changed ? `Synced: ${sub.title}` : `Already up to date (same code): ${sub.title}`);
    return { ok: true };
  } catch (err) {
    console.error('[GFG Sync] sync failed:', err);
    await setStatus(false, `${sub.title}: ${err.message}`);
    if (!fromQueue) await pushToQueue(sub);
    return { ok: false, msg: err.message };
  }
}

async function retryQueue() {
  const { queue = [] } = await chrome.storage.local.get('queue');
  if (!queue.length) return { remaining: 0 };
  const remaining = [];
  for (const sub of queue) {
    const r = await handleSubmission(sub, true);
    if (!r.ok) remaining.push(sub);
  }
  await chrome.storage.local.set({ queue: remaining });
  return { remaining: remaining.length };
}

async function refreshStats() {
  const cfg = await getCfg();
  if (!cfg.handle) throw new Error('Set your GFG username first');
  const stats = await fetchGfgStats(cfg.handle);
  await chrome.storage.local.set({ stats });
  if (cfg.token && cfg.repo) {
    const index = await loadIndex(cfg);
    index.stats = stats;
    await putFile(cfg, 'problems.json', JSON.stringify(index, null, 2) + '\n', 'Update GFG stats');
    await putFile(cfg, 'README.md', rootReadme(index), 'Update stats README');
  }
  return stats;
}

// ----- GitHub login (device flow). Runs outside the sync chain so it never blocks submissions. -----
const setAuth = (auth) => chrome.storage.local.set({ auth });

async function startLogin() {
  const flow = await requestDeviceCode();
  const auth = { state: 'pending', userCode: flow.userCode, verificationUri: flow.verificationUri, expiresAt: flow.expiresAt };
  await setAuth(auth);
  pollLogin(flow); // continues in the background; popup watches storage
  return { ok: true, auth };
}

async function pollLogin(flow) {
  // Reading storage each round is an extension API call, which also keeps the MV3 worker alive.
  const shouldStop = async () => (await chrome.storage.local.get('auth')).auth?.userCode !== flow.userCode;
  try {
    const token = await waitForToken(flow, { shouldStop });
    if (!token) return;
    const login = await getLogin(token);
    await chrome.storage.local.set({ token, authMethod: 'oauth' });
    await setAuth({ state: 'connected', login });
    await setStatus(true, `Connected to GitHub as ${login}`);
  } catch (err) {
    await setAuth({ state: 'error', msg: err.message });
  }
}

async function logout() {
  await chrome.storage.local.set({ token: '', authMethod: '', auth: { state: 'idle' } });
  return { ok: true };
}

// Not serialized: these don't touch the repo.
const DIRECT_HANDLERS = {
  AUTH_START: startLogin,
  AUTH_CANCEL: async () => { await setAuth({ state: 'idle' }); return { ok: true }; },
  LOGOUT: logout,
};

const HANDLERS = {
  SUBMISSION: (msg) => handleSubmission(msg.payload),
  TEST: async () => ({ ok: true, repo: await testConnection(await getCfg()) }),
  REFRESH_STATS: async () => ({ ok: true, stats: await refreshStats() }),
  RETRY: async () => ({ ok: true, ...(await retryQueue()) }),
};

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  const direct = DIRECT_HANDLERS[msg?.type];
  if (direct) {
    direct(msg).then(send, (err) => send({ ok: false, msg: err.message }));
    return true;
  }
  const handler = HANDLERS[msg?.type];
  if (!handler) return false;
  enqueue(async () => {
    try {
      send(await handler(msg));
    } catch (err) {
      send({ ok: false, msg: err.message });
    }
  });
  return true;
});

// Alarms can be cleared on browser restart, so (re)create on both events.
const ensureAlarm = async () => {
  if (!(await chrome.alarms.get(RETRY_ALARM))) chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 5 });
};
chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);
chrome.alarms.onAlarm.addListener((a) => { if (a.name === RETRY_ALARM) enqueue(retryQueue); });
