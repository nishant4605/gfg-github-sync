import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { putFile, getFile, testConnection } from '../lib/github.js';
import { toBase64 } from '../lib/util.js';

const cfg = { token: 'secret', repo: 'me/gfg', branch: 'main' };
const realFetch = globalThis.fetch;
let calls, responses;

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  calls = [];
  responses = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected fetch ${init.method} ${url}`);
    return next();
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

test('getFile: 404 => null; decodes UTF-8 content; sends auth headers and ref', async () => {
  responses.push(() => json(404, { message: 'Not Found' }));
  assert.equal(await getFile(cfg, 'a.md'), null);

  responses.push(() => json(200, { sha: 's1', content: toBase64('héllo 🚀').replace(/(.{4})/g, '$1\n') }));
  assert.deepEqual(await getFile(cfg, 'Problems/Easy/x y/README.md'), { sha: 's1', content: 'héllo 🚀' });
  assert.equal(calls[1].url, 'https://api.github.com/repos/me/gfg/contents/Problems/Easy/x%20y/README.md?ref=main');
  assert.equal(calls[1].headers.Authorization, 'Bearer secret');
  assert.equal(calls[1].headers['X-GitHub-Api-Version'], '2022-11-28');
});

test('putFile: new file => PUT without sha', async () => {
  responses.push(() => json(404, {}), () => json(201, {}));
  assert.deepEqual(await putFile(cfg, 'a.cpp', 'int main(){}', 'msg'), { changed: true });
  assert.equal(calls[1].method, 'PUT');
  assert.deepEqual(calls[1].body, { message: 'msg', content: toBase64('int main(){}'), branch: 'main' });
});

test('putFile: unchanged content => no PUT', async () => {
  responses.push(() => json(200, { sha: 's1', content: toBase64('same') }));
  assert.deepEqual(await putFile(cfg, 'a.cpp', 'same', 'msg'), { changed: false });
  assert.equal(calls.length, 1);
});

test('putFile: existing file => PUT with sha', async () => {
  responses.push(() => json(200, { sha: 's1', content: toBase64('old') }), () => json(200, {}));
  assert.deepEqual(await putFile(cfg, 'a.cpp', 'new', 'msg'), { changed: true });
  assert.equal(calls[1].body.sha, 's1');
});

test('putFile: 409 retries with a fresh sha', async () => {
  responses.push(
    () => json(200, { sha: 's1', content: toBase64('old') }), () => json(409, { message: 'conflict' }),
    () => json(200, { sha: 's2', content: toBase64('older') }), () => json(200, {}),
  );
  assert.deepEqual(await putFile(cfg, 'a.cpp', 'new', 'msg'), { changed: true });
  assert.equal(calls.length, 4);
  assert.equal(calls[3].body.sha, 's2');
});

test('putFile: gives up after 3 attempts with GitHub message', async () => {
  for (let i = 0; i < 3; i++) responses.push(() => json(404, {}), () => json(422, { message: 'sha wasn\'t supplied' }));
  await assert.rejects(putFile(cfg, 'a.cpp', 'x', 'msg'), /GitHub PUT a\.cpp failed \(422: sha wasn't supplied\)/);
  assert.equal(calls.length, 6);
});

test('putFile: non-retryable error throws immediately', async () => {
  responses.push(() => json(404, {}), () => json(403, { message: 'Resource not accessible' }));
  await assert.rejects(putFile(cfg, 'a.cpp', 'x', 'msg'), /403: Resource not accessible/);
});

test('testConnection: status mapping and push permission', async () => {
  responses.push(() => json(401, {}));
  await assert.rejects(testConnection(cfg), /Invalid token/);
  responses.push(() => json(404, {}));
  await assert.rejects(testConnection(cfg), /Repo not found/);
  responses.push(() => json(200, { full_name: 'me/gfg', permissions: { push: false } }));
  await assert.rejects(testConnection(cfg), /no write access/);
  responses.push(() => json(200, { full_name: 'me/gfg', permissions: { push: true } }));
  assert.equal(await testConnection(cfg), 'me/gfg');
  await assert.rejects(testConnection({ ...cfg, repo: 'https://github.com/me/gfg' }), /owner\/name/);
});
