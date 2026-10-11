import { putFile, getFile, testConnection } from './lib/github.js';
import { rootReadme, problemReadme } from './lib/readme.js';
import { normLang, slugify, localDate, fetchGfgStats } from './lib/util.js';

const DEFAULTS = { token: '', repo: '', branch: 'main', handle: '', enabled: true, template: 'Solved: {title} ({difficulty}) - {language}' };
const MAX_QUEUE = 50;

const getCfg = async () => ({ ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) });

async function setStatus(ok, msg) {
  await chrome.storage.local.set({ lastStatus: { ok, msg, time: new Date().toISOString() } });
  chrome.action.setBadgeText({ text: ok ? '✓' : '!' });
  chrome.action.setBadgeBackgroundColor({ color: ok ? '#2e7d32' : '#c62828' });
}

// Serialize all syncs so concurrent submissions never race on problems.json
let chain = Promise.resolve();
const enqueue = (fn) => (chain = chain.then(fn, fn));

async function loadIndex(cfg) {
  const f = await getFile(cfg, 'problems.json');
  return f ? JSON.parse(f.content) : { problems: {}, dates: [], stats: null };
}

async function syncSubmission(cfg, sub) {
  const lang = normLang(sub.language, sub.code);
  const diff = sub.difficulty || 'Unknown';
  const base = sub.contest
    ? `Contests/${slugify(sub.contest)}/${sub.slug}`
    : `Problems/${diff}/${sub.slug}`;
  const msg = cfg.template
    .replace('{title}', sub.title).replace('{difficulty}', diff)
    .replace('{language}', lang.name).replace('{slug}', sub.slug);

  await putFile(cfg, `${base}/solution.${lang.ext}`, sub.code, msg);

  const index = await loadIndex(cfg);
  const key = `${sub.contest || 'practice'}/${sub.slug}`;
  const today = localDate(new Date(sub.solvedAt));
  const e = index.problems[key] || {
    slug: sub.slug, title: sub.title, difficulty: diff, contest: sub.contest, tags: sub.tags || [],
    languages: [], firstSolved: today, link: sub.link,
  };
  e.lastSolved = today;
  e.path = base;
  if (diff !== 'Unknown') e.difficulty = diff;
  if (sub.tags?.length) e.tags = sub.tags;
  if (!e.languages.includes(lang.name)) e.languages.push(lang.name);
  index.problems[key] = e;
  index.dates = [...new Set([...(index.dates || []), today])].sort();

  await putFile(cfg, `${base}/README.md`, problemReadme(e), `Update README: ${sub.title}`);
  await putFile(cfg, 'problems.json', JSON.stringify(index, null, 2), `Update index: ${sub.title}`);
  await putFile(cfg, 'README.md', rootReadme(index), 'Update stats README');
  return index;
}

async function handleSubmission(sub, fromQueue = false) {
  const cfg = await getCfg();
  if (!cfg.enabled) return { ok: false, msg: 'Sync disabled' };
  if (!cfg.token || !cfg.repo) { await setStatus(false, 'Set token and repo in the popup'); return { ok: false }; }
  try {
    await syncSubmission(cfg, sub);
    await setStatus(true, `Synced: ${sub.title}`);
    return { ok: true };
  } catch (err) {
    await setStatus(false, err.message);
    if (!fromQueue) {
      const { queue = [] } = await chrome.storage.local.get('queue');
      queue.push(sub);
      await chrome.storage.local.set({ queue: queue.slice(-MAX_QUEUE) });
    }
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
  const index = await loadIndex(cfg);
  index.stats = stats;
  await putFile(cfg, 'problems.json', JSON.stringify(index, null, 2), 'Update GFG stats');
  await putFile(cfg, 'README.md', rootReadme(index), 'Update stats README');
  await chrome.storage.local.set({ stats });
  return stats;
}

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  const run = async () => {
    try {
      if (msg.type === 'SUBMISSION') return await handleSubmission(msg.payload);
      if (msg.type === 'TEST') return { ok: true, repo: await testConnection(await getCfg()) };
      if (msg.type === 'REFRESH_STATS') return { ok: true, stats: await refreshStats() };
      if (msg.type === 'RETRY') return { ok: true, ...(await retryQueue()) };
    } catch (err) {
      return { ok: false, msg: err.message };
    }
  };
  enqueue(run).then(send);
  return true;
});

chrome.runtime.onInstalled.addListener(() => chrome.alarms.create('retry', { periodInMinutes: 5 }));
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'retry') enqueue(retryQueue); });
