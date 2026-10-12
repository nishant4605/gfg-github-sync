import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { commitChanges, gitBlobSha } from '../lib/github.js';
import { toBase64, fromBase64 } from '../lib/util.js';

const cfg = { token: 't', repo: 'me/sol', branch: 'main' };
const realFetch = globalThis.fetch;
const json = (status, body) => new Response(JSON.stringify(body), { status });

/** Minimal in-memory GitHub Git Data API: commits hold a full {path: content} snapshot. */
function fakeGitHub({ files = {}, empty = false } = {}) {
  const gh = { commits: {}, head: null, calls: [], failPatchOnce: null, contentsPuts: [] };
  let n = 0;
  const id = (p) => `${p}${++n}`.padEnd(40, '0');
  const blobs = {};
  const addCommit = async (snapshot, message, parent) => {
    for (const c of Object.values(snapshot)) blobs[await gitBlobSha(c)] = c;
    const sha = id('c');
    gh.commits[sha] = { snapshot, message, parent, tree: sha.replace(/^c/, 't') };
    return sha;
  };
  gh.commitTo = async (extra, message) => { gh.head = await addCommit({ ...gh.commits[gh.head].snapshot, ...extra }, message, gh.head); };
  gh.log = () => { const out = []; for (let s = gh.head; s; s = gh.commits[s].parent) out.push(gh.commits[s].message); return out; };
  gh.file = (p) => gh.commits[gh.head].snapshot[p];
  const treeOf = (tsha) => Object.values(gh.commits).find((c) => c.tree === tsha);
  const pendingTrees = {};

  gh.ready = (async () => { if (!empty) gh.head = await addCommit(files, 'Initial commit', null); })();

  gh.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    const p = u.pathname.replace('/repos/me/sol', '');
    gh.calls.push(`${method} ${p}`);

    if (method === 'GET' && p === '/git/ref/heads/main') return gh.head ? json(200, { object: { sha: gh.head } }) : json(409, { message: 'Git Repository is empty.' });
    if (method === 'GET' && p.startsWith('/git/commits/')) { const c = gh.commits[p.split('/').pop()]; return json(200, { tree: { sha: c.tree } }); }
    if (method === 'GET' && p.startsWith('/git/trees/')) {
      const c = treeOf(p.split('/').pop());
      const tree = await Promise.all(Object.entries(c.snapshot).map(async ([path, content]) => ({ path, type: 'blob', sha: await gitBlobSha(content) })));
      return json(200, { tree, truncated: false });
    }
    if (method === 'GET' && p.startsWith('/git/blobs/')) return json(200, { content: toBase64(blobs[p.split('/').pop()]), encoding: 'base64' });
    if (method === 'POST' && p === '/git/trees') {
      const base = treeOf(body.base_tree).snapshot;
      const snapshot = { ...base, ...Object.fromEntries(body.tree.map((t) => [t.path, t.content])) };
      const tsha = id('pt'); pendingTrees[tsha] = snapshot;
      return json(201, { sha: tsha });
    }
    if (method === 'POST' && p === '/git/commits') {
      const sha = await addCommit(pendingTrees[body.tree], body.message, body.parents[0]);
      return json(201, { sha });
    }
    if (method === 'PATCH' && p === '/git/refs/heads/main') {
      if (gh.failPatchOnce) { const f = gh.failPatchOnce; gh.failPatchOnce = null; await f(); return json(422, { message: 'Update is not a fast forward' }); }
      if (gh.commits[body.sha].parent !== gh.head) return json(422, { message: 'Update is not a fast forward' });
      gh.head = body.sha;
      return json(200, {});
    }
    // Contents API (empty-repo fallback)
    if (p.startsWith('/contents/')) {
      const path = decodeURIComponent(p.slice('/contents/'.length));
      if (method === 'GET') return json(404, {});
      if (method === 'PUT') {
        gh.contentsPuts.push(path);
        const snap = { ...(gh.head ? gh.commits[gh.head].snapshot : {}), [path]: fromBase64(body.content) };
        gh.head = await addCommit(snap, body.message, gh.head);
        return json(201, {});
      }
    }
    throw new Error(`fake GitHub: unhandled ${method} ${p}`);
  };
  return gh;
}

let gh;
beforeEach(() => { globalThis.fetch = (...a) => gh.fetch(...a); });
afterEach(() => { globalThis.fetch = realFetch; });

test('gitBlobSha matches git hash-object', async () => {
  assert.equal(await gitBlobSha(''), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  assert.equal(await gitBlobSha('hello\n'), 'ce013625030ba8dba906f756967f9e9ca394464a');
});

test('writes all files in exactly one commit', async () => {
  gh = fakeGitHub({ files: { 'README.md': '# hi\n' } });
  await gh.ready;
  const r = await commitChanges(cfg, async (read) => {
    assert.equal(await read('README.md'), '# hi\n');
    assert.equal(await read('problems.json'), null);
    return { files: { 'a/solution.cpp': 'int main(){}', 'a/README.md': '# A', 'problems.json': '{}', 'README.md': '# stats' }, message: 'Solved: A' };
  });
  assert.deepEqual(r.changed.sort(), ['README.md', 'a/README.md', 'a/solution.cpp', 'problems.json']);
  assert.deepEqual(gh.log(), ['Solved: A', 'Initial commit']);
  assert.equal(gh.file('a/solution.cpp'), 'int main(){}');
  assert.equal(gh.calls.filter((c) => c.startsWith('PATCH')).length, 1);
});

test('skips unchanged files and makes no commit when nothing changed', async () => {
  gh = fakeGitHub({ files: { 'x.cpp': 'same', 'README.md': 'old' } });
  await gh.ready;
  let r = await commitChanges(cfg, async () => ({ files: { 'x.cpp': 'same', 'README.md': 'new' }, message: (c) => `changed ${c.join(',')}` }));
  assert.deepEqual(r.changed, ['README.md']);
  assert.equal(gh.log()[0], 'changed README.md');

  const before = gh.log().length;
  gh.calls = [];
  r = await commitChanges(cfg, async () => ({ files: { 'x.cpp': 'same', 'README.md': 'new' }, message: 'nope' }));
  assert.deepEqual(r.changed, []);
  assert.equal(gh.log().length, before);
  assert.deepEqual(gh.calls.filter((c) => !c.startsWith('GET')), []); // no writes at all
});

test('handles Unicode content end-to-end', async () => {
  gh = fakeGitHub({ files: { 'n.md': 'नमस्ते 🚀' } });
  await gh.ready;
  const r = await commitChanges(cfg, async (read) => ({ files: { 'n.md': (await read('n.md')) + '!' }, message: 'm' }));
  assert.deepEqual(r.changed, ['n.md']);
  assert.equal(gh.file('n.md'), 'नमस्ते 🚀!');
});

test('retries on a fresh snapshot when the branch moved meanwhile (no lost update)', async () => {
  gh = fakeGitHub({ files: { 'problems.json': '{"n":1}' } });
  await gh.ready;
  gh.failPatchOnce = () => gh.commitTo({ 'problems.json': '{"n":2}', 'other.txt': 'x' }, 'Concurrent commit');
  let builds = 0;
  await commitChanges(cfg, async (read) => {
    builds++;
    const idx = JSON.parse(await read('problems.json'));
    return { files: { 'problems.json': JSON.stringify({ n: idx.n + 10 }) }, message: 'Mine' };
  });
  assert.equal(builds, 2);
  assert.equal(gh.file('problems.json'), '{"n":12}'); // built on top of the concurrent change
  assert.equal(gh.file('other.txt'), 'x');
  assert.deepEqual(gh.log(), ['Mine', 'Concurrent commit', 'Initial commit']);
});

test('empty repo falls back to the Contents API', async () => {
  gh = fakeGitHub({ empty: true });
  await gh.ready;
  const r = await commitChanges(cfg, async (read) => {
    assert.equal(await read('problems.json'), null);
    return { files: { 's.py': 'print(1)', 'README.md': '# r' }, message: (c) => `first ${c.length}` };
  });
  assert.deepEqual(r.changed, ['s.py', 'README.md']);
  assert.deepEqual(gh.contentsPuts, ['s.py', 'README.md']);
  assert.equal(gh.file('s.py'), 'print(1)');
});
