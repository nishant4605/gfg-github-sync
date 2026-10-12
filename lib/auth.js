// GitHub OAuth Device Flow: no client secret and no server needed.
// https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow

// ===== AUTH CONFIG =====
// Public Client ID of the "GFG GitHub Sync" OAuth App (safe to commit; it is not a secret).
// Register at https://github.com/settings/applications/new with "Enable Device Flow" ticked.
export const GITHUB_CLIENT_ID = '';
// `repo` lets the extension write to public and private repos the user picks.
export const GITHUB_SCOPE = 'repo';
// ===== end AUTH CONFIG =====

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';

async function postForm(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  let json = null;
  try { json = await res.json(); } catch { /* handled below */ }
  if (!res.ok || !json) throw new Error(`GitHub login request failed (${res.status})`);
  return json;
}

/**
 * Start the device flow.
 * @param {string} [clientId]
 * @returns {Promise<{deviceCode: string, userCode: string, verificationUri: string, interval: number, expiresAt: number}>}
 */
export async function requestDeviceCode(clientId = GITHUB_CLIENT_ID) {
  if (!clientId) throw new Error('GitHub login is not configured (missing Client ID)');
  const j = await postForm(DEVICE_CODE_URL, { client_id: clientId, scope: GITHUB_SCOPE });
  if (j.error) throw new Error(j.error_description || j.error);
  return {
    deviceCode: j.device_code,
    userCode: j.user_code,
    verificationUri: j.verification_uri,
    interval: j.interval || 5,
    expiresAt: Date.now() + (j.expires_in || 900) * 1000,
  };
}

/**
 * Poll once for the access token.
 * @param {string} deviceCode
 * @param {string} [clientId]
 * @returns {Promise<{token?: string, pending?: boolean, slowDown?: boolean}>} throws on denial/expiry
 */
export async function pollToken(deviceCode, clientId = GITHUB_CLIENT_ID) {
  const j = await postForm(TOKEN_URL, {
    client_id: clientId, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
  if (j.access_token) return { token: j.access_token };
  if (j.error === 'authorization_pending') return { pending: true };
  if (j.error === 'slow_down') return { pending: true, slowDown: true };
  if (j.error === 'expired_token') throw new Error('Login code expired. Click Connect GitHub again.');
  if (j.error === 'access_denied') throw new Error('GitHub login was cancelled.');
  throw new Error(j.error_description || j.error || 'GitHub login failed');
}

/**
 * Poll until the user authorizes, the code expires, or `shouldStop()` returns true.
 * Each wait goes through `sleep`, so callers can keep an MV3 service worker alive.
 * @param {{deviceCode: string, interval: number, expiresAt: number}} flow
 * @param {{sleep?: (ms: number) => Promise<void>, shouldStop?: () => Promise<boolean>|boolean, clientId?: string}} [opts]
 * @returns {Promise<string|null>} token, or null if stopped
 */
export async function waitForToken(flow, { sleep = (ms) => new Promise((r) => setTimeout(r, ms)), shouldStop = () => false, clientId } = {}) {
  let interval = flow.interval;
  while (Date.now() < flow.expiresAt) {
    await sleep(interval * 1000);
    if (await shouldStop()) return null;
    const r = await pollToken(flow.deviceCode, clientId);
    if (r.token) return r.token;
    if (r.slowDown) interval += 5;
  }
  throw new Error('Login code expired. Click Connect GitHub again.');
}

/**
 * Fetch the signed-in GitHub user's login name.
 * @param {string} token
 * @returns {Promise<string>}
 */
export async function getLogin(token) {
  const res = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!res.ok) throw new Error(`Could not read GitHub user (${res.status})`);
  return (await res.json()).login;
}
