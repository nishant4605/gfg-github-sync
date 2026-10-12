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

// ----- Single-commit writes via the Git Data API -----

/**
 * Git blob SHA-1 of UTF-8 text, exactly as git/GitHub compute it.
 * @param {string} text
 * @returns {Promise<string>} 40-char hex sha
 */
export async function gitBlobSha(text) {
  const body = new TextEncoder().encode(text);
  const header = new TextEncoder().encode(`blob ${body.length}\0`);
  const buf = new Uint8Array(header.length + body.length);
  buf.set(header);
  buf.set(body, header.length);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', buf));
  return [...hash].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function ghJson(cfg, method, path, body, what) {
  const res = await gh(cfg, method, path, body);
  if (!res.ok) throw Object.assign(await ghError(res, what), { status: res.status });
  return res.json();
}

/** Branch head snapshot with readers bound to that exact commit; null for an empty repo / missing branch. */
async function readSnapshot(cfg) {
  const r = repoPath(cfg);
  const refRes = await gh(cfg, 'GET', `/repos/${r}/git/ref/heads/${encPath(cfg.branch)}`);
  if (refRes.status === 404 || refRes.status === 409) return null;
  if (!refRes.ok) throw await ghError(refRes, 'GitHub read branch');
  const commitSha = (await refRes.json()).object.sha;
  const commit = await ghJson(cfg, 'GET', `/repos/${r}/git/commits/${commitSha}`, undefined, 'GitHub read commit');
  const tree = await ghJson(cfg, 'GET', `/repos/${r}/git/trees/${commit.tree.sha}?recursive=1`, undefined, 'GitHub read tree');
  const shas = new Map(tree.tree.filter((t) => t.type === 'blob').map((t) => [t.path, t.sha]));

  const shaOf = async (path) => {
    if (shas.has(path) || !tree.truncated) return shas.get(path) ?? null;
    // Very large repo: the recursive listing was truncated, so look this one path up directly.
    const res = await gh(cfg, 'GET', `/repos/${r}/contents/${encPath(path)}?ref=${commitSha}`);
    if (res.status === 404) return null;
    if (!res.ok) throw await ghError(res, `GitHub GET ${path}`);
    return (await res.json()).sha;
  };
  const read = async (path) => {
    const sha = await shaOf(path);
    if (!sha) return null;
    const blob = await ghJson(cfg, 'GET', `/repos/${r}/git/blobs/${sha}`, undefined, `GitHub read ${path}`);
    return fromBase64(blob.content);
  };
  return { commitSha, treeSha: commit.tree.sha, shaOf, read };
}

/** Empty repo: the Git Data API can't create the first commit, the Contents API can (one commit per file). */
async function commitViaContents(cfg, build) {
  const { files, message } = await build(async (path) => (await getFile(cfg, path))?.content ?? null);
  const msg = typeof message === 'function' ? message(Object.keys(files)) : message;
  const changed = [];
  for (const [path, content] of Object.entries(files)) {
    if ((await putFile(cfg, path, content, msg)).changed) changed.push(path);
  }
  return { changed };
}

/**
 * Write several files in ONE commit. Files whose content is unchanged are skipped; if nothing
 * changed, no commit is made. `build` reads from the same snapshot it commits on top of, and the
 * whole read-build-commit cycle is retried (up to 2 times) if the branch moved in between.
 * @param {{token: string, repo: string, branch: string}} cfg
 * @param {(read: (path: string) => Promise<string|null>) => Promise<{files: Record<string, string>, message: string | ((changed: string[]) => string)}>} build
 * @returns {Promise<{changed: string[]}>} paths that were written
 */
export async function commitChanges(cfg, build) {
  const r = repoPath(cfg);
  for (let attempt = 0; ; attempt++) {
    const snap = await readSnapshot(cfg);
    if (!snap) return commitViaContents(cfg, build);
    const { files, message } = await build(snap.read);

    const changed = [];
    for (const [path, content] of Object.entries(files)) {
      if ((await snap.shaOf(path)) !== (await gitBlobSha(content))) changed.push(path);
    }
    if (!changed.length) return { changed };

    try {
      const tree = await ghJson(cfg, 'POST', `/repos/${r}/git/trees`, {
        base_tree: snap.treeSha,
        tree: changed.map((path) => ({ path, mode: '100644', type: 'blob', content: files[path] })),
      }, 'GitHub create tree');
      const commit = await ghJson(cfg, 'POST', `/repos/${r}/git/commits`, {
        message: typeof message === 'function' ? message(changed) : message, tree: tree.sha, parents: [snap.commitSha],
      }, 'GitHub create commit');
      await ghJson(cfg, 'PATCH', `/repos/${r}/git/refs/heads/${encPath(cfg.branch)}`, { sha: commit.sha }, 'GitHub update branch');
      return { changed };
    } catch (err) {
      if ((err.status === 409 || err.status === 422) && attempt < 2) continue; // branch moved: redo on new head
      throw err;
    }
  }
}
