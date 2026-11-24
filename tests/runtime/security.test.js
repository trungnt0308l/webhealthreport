import assert from 'node:assert/strict';
import { before, after, it } from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { sign } from 'node:crypto';
import { Miniflare } from 'miniflare';
import { MockAgent } from 'undici';
import { crc32 } from '../../functions/_lib/paypal-signature.js';

let runtime;
const origin = 'https://webhealthreport.pages.dev';
before(async () => {
  const buildEnv = Object.fromEntries(['PATH', 'SystemRoot', 'TEMP', 'TMP'].filter(name => process.env[name]).map(name => [name, process.env[name]]));
  execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'pages', 'functions', 'build', '--compatibility-date=2024-09-23', '--compatibility-flags=nodejs_compat', '--outdir=.wrangler/security-runtime-build'], { env: { ...buildEnv, WRANGLER_LOG_PATH: '.wrangler/logs', WRANGLER_SEND_METRICS: 'false' }, timeout: 30000 });
  const cert = await readFile('tests/fixtures/webhook-test-cert.pem', 'utf8');
  const agent = new MockAgent();
  agent.disableNetConnect();
  agent.get('https://api.paypal.com').intercept({ path: '/v1/notifications/certs/CERT-runtime' }).reply(200, cert, { headers: { 'content-type': 'application/x-pem-file' } }).persist();
  runtime = new Miniflare({
    modules: true, scriptPath: '.wrangler/security-runtime-build/index.js',
    compatibilityDate: '2024-09-23', compatibilityFlags: ['nodejs_compat'],
    bindings: { ALLOWED_ORIGIN: origin, MONITOR_SECRET: 'fixture-admin', PAYPAL_WEBHOOK_ID: 'fixture-hook' },
    d1Databases: { DB: 'security-runtime' },
    serviceBindings: { ASSETS: () => new Response('<html>public app shell</html>', { headers: { 'content-type': 'text/html' } }) },
    fetchMock: agent,
  });
  const db = await runtime.getD1Database('DB');
  await db.exec('CREATE TABLE request_limits (key TEXT PRIMARY KEY, window_start INTEGER, count INTEGER); CREATE TABLE processed_webhook_events (event_id TEXT PRIMARY KEY, processed_at INTEGER);');
});
after(async () => { await runtime?.dispose(); });

it('runs Pages routing, direct auth, aliases and response policy inside workerd', async () => {
  for (const [path, expected] of [['/api/user/sites', 401], ['/api/user/sites/', 401], ['/api/monitored-sites', 403], ['/api/debug/check-url', 404], ['/api/monitored-sites/scan', 404], ['/api/%75ser/sites', 404], ['/api//user/sites', 404], ['/api/user/sites/%252f', 404]]) {
    const response = await runtime.dispatchFetch(origin + path);
    assert.equal(response.status, expected, path);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(typeof (await response.json()).error, 'string');
  }
});

it('executes raw-byte PayPal RSA certificate verification inside workerd', async () => {
  const bytes = Buffer.from('{ "id":"WH-runtime", "event_type":"UNKNOWN" }');
  const time = new Date().toISOString(), id = 'runtime-transmission';
  const signature = sign('RSA-SHA256', Buffer.from(`${id}|${time}|fixture-hook|${crc32(bytes)}`), await readFile('tests/fixtures/webhook-test-key.pem')).toString('base64');
  const headers = { 'paypal-auth-algo': 'SHA256withRSA', 'paypal-transmission-id': id, 'paypal-transmission-time': time, 'paypal-transmission-sig': signature, 'paypal-cert-url': 'https://api.paypal.com/v1/notifications/certs/CERT-runtime' };
  const response = await runtime.dispatchFetch(origin + '/api/paypal/webhook', { method: 'POST', credentials: 'omit', headers: { ...headers }, body: bytes.toString() });
  assert.equal(response.status, 200, await response.text());
  assert.equal((await runtime.dispatchFetch(origin + '/api/paypal/webhook', { method: 'POST', credentials: 'omit', headers: { ...headers }, body: bytes.toString() + ' ' })).status, 401);
});
