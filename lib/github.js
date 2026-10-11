import { toBase64, fromBase64 } from './util.js';

const API = 'https://api.github.com';
const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');
const repoPath = (cfg) => cfg.repo.split('/').map(encodeURIComponent).join('/');

async function gh(cfg, method, path, body) {
  return fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
}

/** Pull GitHub's error message out of a response, if any. */
async function ghError(res, what) {
  let detail = '';
  try { detail = (await res.json()).message || ''; } catch { /* non-JSON body */ }
  return new Error(`${what} failed (${res.status}${detail ? `: ${detail}` : ''})`);
}

/**
 * Verify the token can push to the repo.
 * @param {{token: string, repo: string}} cfg
 * @returns {Promise<string>} the repo's full name
 */
export async function testConnection(cfg) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(cfg.repo)) throw new Error('Repo must look like owner/name');
  const res = await gh(cfg, 'GET', `/repos/${repoPath(cfg)}`);
  if (res.status === 401) throw new Error('Invalid token');
  if (res.status === 404) throw new Error('Repo not found (check owner/name and token access)');
  if (!res.ok) throw await ghError(res, 'GitHub repo check');
  const j = await res.json();
  if (j.permissions?.push !== true) throw new Error('Token has no write access to this repo');
  return j.full_name;
}

/**
 * Read a file from the configured branch.
 * @param {{token: string, repo: string, branch: string}} cfg
 * @param {string} path repo-relative path
 * @returns {Promise<{sha: string, content: string}|null>} null if the file does not exist
 */
export async function getFile(cfg, path) {
  const res = await gh(cfg, 'GET', `/repos/${repoPath(cfg)}/contents/${encPath(path)}?ref=${encodeURIComponent(cfg.branch)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw await ghError(res, `GitHub GET ${path}`);
  const j = await res.json();
  if (Array.isArray(j)) throw new Error(`${path} is a directory`);
  if (j.encoding === 'none') throw new Error(`${path} is too large for the Contents API (>1 MB)`);
  return { sha: j.sha, content: j.content ? fromBase64(j.content) : '' };
}

/**
 * Create or update a file; skips the commit if content is unchanged.
 * Retries up to 2 times on 409/422 (stale sha), re-fetching the sha each time.
 * @param {{token: string, repo: string, branch: string}} cfg
 * @param {string} path repo-relative path
 * @param {string} content UTF-8 text
 * @param {string} message commit message
 * @returns {Promise<{changed: boolean}>}
 */
export async function putFile(cfg, path, content, message) {
  for (let attempt = 0; ; attempt++) {
    const existing = await getFile(cfg, path);
    if (existing && existing.content === content) return { changed: false };
    const res = await gh(cfg, 'PUT', `/repos/${repoPath(cfg)}/contents/${encPath(path)}`, {
      message, content: toBase64(content), branch: cfg.branch, ...(existing ? { sha: existing.sha } : {}),
    });
    if (res.ok) return { changed: true };
    if ((res.status === 409 || res.status === 422) && attempt < 2) continue;
    throw await ghError(res, `GitHub PUT ${path}`);
  }
}
