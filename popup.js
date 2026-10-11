const $ = (id) => document.getElementById(id);
const FIELDS = ['token', 'repo', 'branch', 'handle', 'template'];
const DEFAULTS = { branch: 'main', template: 'Solved: {title} ({difficulty}) - {language}', enabled: true };

function show(msg, ok = true) {
  $('status').textContent = msg;
  $('status').className = 'status ' + (ok ? 'ok' : 'err');
}

async function load() {
  const s = { ...DEFAULTS, ...(await chrome.storage.local.get([...FIELDS, 'enabled', 'queue', 'lastStatus', 'stats'])) };
  FIELDS.forEach((f) => ($(f).value = s[f] || ''));
  $('enabled').checked = s.enabled;
  $('qcount').textContent = (s.queue || []).length;
  if (s.lastStatus) show(`${s.lastStatus.msg} (${new Date(s.lastStatus.time).toLocaleString()})`, s.lastStatus.ok);
  chrome.action.setBadgeText({ text: '' });
}

async function save() {
  const data = { enabled: $('enabled').checked };
  FIELDS.forEach((f) => (data[f] = $(f).value.trim()));
  data.repo = data.repo.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
  $('repo').value = data.repo;
  await chrome.storage.local.set(data);
  show('Saved');
}

const call = async (type, label) => {
  await save();
  show(label + '...');
  try {
    return (await chrome.runtime.sendMessage({ type })) || { ok: false, msg: 'No response from background worker' };
  } catch (err) {
    return { ok: false, msg: err.message };
  }
};

$('save').onclick = save;
$('test').onclick = async () => {
  const r = await call('TEST', 'Testing');
  show(r.ok ? `Connected to ${r.repo}` : r.msg, r.ok);
};
$('stats').onclick = async () => {
  const r = await call('REFRESH_STATS', 'Fetching stats');
  show(r.ok ? `Solved: ${r.stats.solved ?? '?'}, Score: ${r.stats.score ?? '?'}, Rank: ${r.stats.rank ?? '?'}` : r.msg, r.ok);
};
$('retry').onclick = async () => {
  const r = await call('RETRY', 'Retrying');
  const { queue = [] } = await chrome.storage.local.get('queue');
  $('qcount').textContent = queue.length;
  show(r.ok ? `Queue remaining: ${r.remaining}` : r.msg, r.ok);
};

load();
