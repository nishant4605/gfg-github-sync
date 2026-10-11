import { toBase64, fromBase64 } from './util.js';

const API = 'https://api.github.com';
const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

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
  });
}

export async function testConnection(cfg) {
  const res = await gh(cfg, 'GET', `/repos/${cfg.repo}`);
  if (res.status === 401) throw new Error('Invalid token');
  if (res.status === 404) throw new Error('Repo not found (check owner/name and token access)');
  if (!res.ok) throw new Error(`GitHub error ${res.status}`);
  const j = await res.json();
  if (!j.permissions?.push) throw new Error('Token has no write access to this repo');
  return j.full_name;
}

export async function getFile(cfg, path) {
  const res = await gh(cfg, 'GET', `/repos/${cfg.repo}/contents/${encPath(path)}?ref=${encodeURIComponent(cfg.branch)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET ${path} failed (${res.status})`);
  const j = await res.json();
  return { sha: j.sha, content: j.content ? fromBase64(j.content) : '' };
}

// Create or update a file. Skips the commit if content is unchanged.
export async function putFile(cfg, path, content, message, attempt = 0) {
  const existing = await getFile(cfg, path);
  if (existing && existing.content === content) return { changed: false };
  const res = await gh(cfg, 'PUT', `/repos/${cfg.repo}/contents/${encPath(path)}`, {
    message, content: toBase64(content), branch: cfg.branch, ...(existing ? { sha: existing.sha } : {}),
  });
  if ((res.status === 409 || res.status === 422) && attempt < 2) return putFile(cfg, path, content, message, attempt + 1);
  if (!res.ok) throw new Error(`GitHub PUT ${path} failed (${res.status})`);
  return { changed: true };
}
