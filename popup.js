const $ = (id) => document.getElementById(id);
const FIELDS = ['repo', 'branch', 'handle', 'template'];
const DEFAULTS = { branch: 'main', template: 'Solved: {title} ({difficulty}) - {language}', enabled: true };

function show(msg, ok = true) {
  $('status').textContent = msg;
  $('status').className = 'status ' + (ok ? 'ok' : 'err');
}

/** Accepts "owner/name", "https://github.com/owner/name(.git)(/...)" or "github.com/owner/name". */
function normRepo(v) {
  const m = v.trim().match(/^(?:https?:\/\/)?(?:www\.)?(?:github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#].*)?$/i);
  return m ? `${m[1]}/${m[2]}` : v.trim();
}

/** Render the GitHub connection card from stored state. */
function renderAuth({ auth = {}, token, authMethod }) {
  const connected = auth.state === 'connected' && authMethod === 'oauth' && token;
  $('gh-idle').hidden = connected || auth.state === 'pending';
  $('gh-pending').hidden = auth.state !== 'pending';
  $('gh-connected').hidden = !connected;
  $('usercode').textContent = auth.userCode || '';
  $('login').textContent = auth.login || '';
  $('gh-error').hidden = auth.state !== 'error';
  $('gh-error').textContent = auth.msg || '';
  $('revoke').hidden = !auth.disconnected;
  if (!connected && authMethod !== 'oauth' && token) $('advanced').open = true; // manual token in use
}

async function load() {
  const s = { ...DEFAULTS, ...(await chrome.storage.local.get([...FIELDS, 'enabled', 'queue', 'lastStatus', 'token', 'authMethod', 'auth'])) };
  FIELDS.forEach((f) => ($(f).value = s[f] || ''));
  $('pat').value = s.authMethod === 'oauth' ? '' : s.token || '';
  $('enabled').checked = s.enabled;
  $('qcount').textContent = (s.queue || []).length;
  renderAuth(s);
  if (s.lastStatus) show(`${s.lastStatus.msg} (${new Date(s.lastStatus.time).toLocaleString()})`, s.lastStatus.ok);
  chrome.action.setBadgeText({ text: '' });
}

async function save() {
  const data = { enabled: $('enabled').checked };
  FIELDS.forEach((f) => (data[f] = $(f).value.trim()));
  data.repo = normRepo(data.repo);
  $('repo').value = data.repo;
  const pat = $('pat').value.trim();
  const { authMethod } = await chrome.storage.local.get('authMethod');
  if (pat) Object.assign(data, { token: pat, authMethod: 'pat' });
  else if (authMethod === 'pat') Object.assign(data, { token: '', authMethod: '' }); // PAT field cleared
  await chrome.storage.local.set(data);
  show('Saved');
}

const send = async (type) => {
  try {
    return (await chrome.runtime.sendMessage({ type })) || { ok: false, msg: 'No response from background worker' };
  } catch (err) {
    return { ok: false, msg: err.message };
  }
};

const call = async (type, label) => {
  await save();
  show(label + '...');
  return send(type);
};

$('connect').onclick = async () => {
  show('Contacting GitHub...');
  const r = await send('AUTH_START');
  show(r.ok ? 'Enter the code on GitHub' : r.msg, r.ok);
};
$('open-gh').onclick = async () => {
  const { auth } = await chrome.storage.local.get('auth');
  try { await navigator.clipboard.writeText(auth.userCode); } catch { /* user can type it */ }
  chrome.tabs.create({ url: auth.verificationUri || 'https://github.com/login/device' });
};
$('cancel').onclick = () => send('AUTH_CANCEL');
$('logout').onclick = async () => { await send('LOGOUT'); show('Disconnected from GitHub'); };

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

// Live-update the GitHub card while the background worker polls for the login.
chrome.storage.onChanged.addListener(async (changes) => {
  if (changes.auth || changes.token) renderAuth(await chrome.storage.local.get(['auth', 'token', 'authMethod']));
});

load();
