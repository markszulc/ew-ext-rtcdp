import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { main, resetCache } = require('../app-builder/actions/audiences/index.js');

const fakeJwt = (claims) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;
const CALLER = fakeJwt({ client_id: 'darkalley' });
const PARAMS = {
  AEP_CLIENT_ID: 'svc-id',
  AEP_CLIENT_SECRET: 'svc-secret',
  AEP_ORG_ID: 'ORG@AdobeOrg',
  ALLOWED_SANDBOXES: 'prod,stage',
  __ow_headers: { authorization: `Bearer ${CALLER}`, origin: 'https://tools.example' },
};

let calls;
const realFetch = globalThis.fetch;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  resetCache();
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.includes('/validate_token/')) return json({ valid: true });
    if (u.includes('/ims/token/v3')) return json({ access_token: 'svc-token', expires_in: 86400 });
    if (u.startsWith('https://platform.adobe.io/')) {
      return json({
        children: [{ id: 'a1', name: 'Espresso', secretField: 'x' }],
        _page: { totalCount: 1, next: '' },
      });
    }
    throw new Error(`unexpected ${u}`);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

test('proxies audiences with a service token and trims fields', async () => {
  const res = await main({ ...PARAMS, sandbox: 'stage', limit: '500' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.children.map((c) => c.name), ['Espresso']);
  assert.equal(res.body.children[0].secretField, undefined);
  const aep = calls.find((c) => c.url.startsWith('https://platform.adobe.io/'));
  assert.equal(aep.init.headers.Authorization, 'Bearer svc-token');
  assert.equal(aep.init.headers['x-sandbox-name'], 'stage');
  assert.match(aep.url, /limit=100/);
  await main(PARAMS);
  assert.equal(calls.filter((c) => c.url.includes('/ims/token/v3')).length, 1, 'service token cached');
});

test('rejects missing or invalid caller tokens before calling AEP', async () => {
  const noAuth = await main({ ...PARAMS, __ow_headers: {} });
  assert.equal(noAuth.statusCode, 401);
  globalThis.fetch = async () => json({ valid: false });
  const invalid = await main(PARAMS);
  assert.equal(invalid.statusCode, 401);
});

test('enforces sandbox, client ID and origin allow-lists', async () => {
  assert.equal((await main({ ...PARAMS, sandbox: 'dev' })).statusCode, 403);
  assert.equal((await main({ ...PARAMS, ALLOWED_CLIENT_IDS: 'other' })).statusCode, 401);
  assert.equal((await main({ ...PARAMS, ALLOWED_ORIGINS: 'https://elsewhere' })).statusCode, 403);
  const ok = await main({ ...PARAMS, ALLOWED_ORIGINS: 'https://tools.example' });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.headers['Access-Control-Allow-Origin'], 'https://tools.example');
  assert.ok(!calls.some((c) => c.url.includes('/validate_token/') && c.url.includes('other')));
});
