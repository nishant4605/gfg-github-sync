import { putFile, getFile, testConnection } from './lib/github.js';
import { rootReadme, problemReadme } from './lib/readme.js';
import { normLang, localDate, fetchGfgStats } from './lib/util.js';
import { emptyIndex, resolveTarget, commitMessage, upsertEntry } from './lib/sync.js';

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

  await putFile(cfg, `${base}/solution.${lang.ext}`, sub.code, msg);

  const today = localDate(new Date(sub.solvedAt));
  const { entry } = upsertEntry(index, { ...sub, difficulty }, lang, base, today);

  await putFile(cfg, `${base}/README.md`, problemReadme(entry), `Update README: ${sub.title}`);
  await putFile(cfg, 'problems.json', JSON.stringify(index, null, 2) + '\n', `Update index: ${sub.title}`);
  await putFile(cfg, 'README.md', rootReadme(index), 'Update stats README');
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
    await syncSubmission(cfg, sub);
    await setStatus(true, `Synced: ${sub.title}`);
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

const HANDLERS = {
  SUBMISSION: (msg) => handleSubmission(msg.payload),
  TEST: async () => ({ ok: true, repo: await testConnection(await getCfg()) }),
  REFRESH_STATS: async () => ({ ok: true, stats: await refreshStats() }),
  RETRY: async () => ({ ok: true, ...(await retryQueue()) }),
};

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
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
