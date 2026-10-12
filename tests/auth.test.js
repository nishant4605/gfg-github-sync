import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { requestDeviceCode, pollToken, waitForToken } from '../lib/auth.js';

const realFetch = globalThis.fetch;
let calls, responses;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  calls = [];
  responses = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, body: Object.fromEntries(new URLSearchParams(init.body)) });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected fetch ${url}`);
    return next();
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

test('requestDeviceCode requires a client id', async () => {
  await assert.rejects(requestDeviceCode(''), /not configured/);
});

test('requestDeviceCode maps the response', async () => {
  responses.push(() => json({ device_code: 'dc', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 }));
  const flow = await requestDeviceCode('cid');
  assert.equal(calls[0].url, 'https://github.com/login/device/code');
  assert.deepEqual(calls[0].body, { client_id: 'cid', scope: 'repo' });
  assert.equal(flow.userCode, 'ABCD-1234');
  assert.equal(flow.interval, 5);
  assert.ok(flow.expiresAt > Date.now());
});

test('pollToken states', async () => {
  responses.push(() => json({ error: 'authorization_pending' }));
  assert.deepEqual(await pollToken('dc', 'cid'), { pending: true });
  assert.equal(calls[0].body.grant_type, 'urn:ietf:params:oauth:grant-type:device_code');

  responses.push(() => json({ error: 'slow_down', interval: 10 }));
  assert.deepEqual(await pollToken('dc', 'cid'), { pending: true, slowDown: true });

  responses.push(() => json({ access_token: 'gho_x', token_type: 'bearer', scope: 'repo' }));
  assert.deepEqual(await pollToken('dc', 'cid'), { token: 'gho_x' });

  responses.push(() => json({ error: 'access_denied' }));
  await assert.rejects(pollToken('dc', 'cid'), /cancelled/);

  responses.push(() => json({ error: 'expired_token' }));
  await assert.rejects(pollToken('dc', 'cid'), /expired/);
});

test('waitForToken polls until authorized and backs off on slow_down', async () => {
  const waits = [];
  responses.push(() => json({ error: 'authorization_pending' }), () => json({ error: 'slow_down' }), () => json({ access_token: 'gho_ok' }));
  const token = await waitForToken({ deviceCode: 'dc', interval: 5, expiresAt: Date.now() + 60_000 },
    { clientId: 'cid', sleep: async (ms) => { waits.push(ms); } });
  assert.equal(token, 'gho_ok');
  assert.deepEqual(waits, [5000, 5000, 10000]);
});

test('waitForToken stops when cancelled', async () => {
  const token = await waitForToken({ deviceCode: 'dc', interval: 5, expiresAt: Date.now() + 60_000 },
    { clientId: 'cid', sleep: async () => {}, shouldStop: () => true });
  assert.equal(token, null);
  assert.equal(calls.length, 0);
});

test('waitForToken throws once the code has expired', async () => {
  await assert.rejects(waitForToken({ deviceCode: 'dc', interval: 5, expiresAt: Date.now() - 1 }, { clientId: 'cid' }), /expired/);
});
