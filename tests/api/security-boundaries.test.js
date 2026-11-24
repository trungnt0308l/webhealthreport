import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { before, after, beforeEach, afterEach, describe, it, mock } from 'node:test';
import wrangler from 'wrangler';
import { publicUrl, siteUrl, isPublicAddress, crawlFetch, serviceFetch, opaqueId } from '../../functions/_lib/network.js';
import { verifyAuth0JWT } from '../../functions/_lib/auth.js';
import { validMailDomain } from '../../functions/_lib/mail-domain.js';
import { trustedOrigin, parseJson } from '../../functions/_lib/request.js';
import { getAllowedOrigin } from '../../functions/_lib/cors.js';
import { relativeRedirect, scriptJson } from '../../src/lib/security.js';
import { rateLimit } from '../../functions/_lib/rate-limit.js';
import { deleteMonitoredSite } from '../../functions/_lib/monitored-sites.js';
import { onRequest as middleware } from '../../functions/_middleware.js';
import { onRequestGet as report } from '../../functions/api/scans/[id]/report.js';
import { onRequestGet as status } from '../../functions/api/scans/[id]/status.js';
import { onRequestPost as mail } from '../../functions/api/scans/[id]/email-report.js';
import { onRequestPost as webhook } from '../../functions/api/paypal/webhook.js';
import { onRequestPost as activate } from '../../functions/api/paypal/subscription/activate.js';
import { onRequestPost as startScan } from '../../functions/api/scans/index.js';
import { onRequestPost as captureOrder } from '../../functions/api/paypal/order/capture.js';
import { onRequestDelete as removeUserSite } from '../../functions/api/user/sites/[id].js';
import { onRequestPost as createSubscription, onRequestDelete as cancelSubscription } from '../../functions/api/paypal/subscription/index.js';
import { monitoringAllowed } from '../../functions/_lib/entitlements.js';
import { processBatch } from '../../functions/_lib/scan-engine.js';
import scheduler from '../../scheduler/index.js';
import { approvalUrl } from '../../functions/_lib/paypal.js';
import { crc32 } from '../../functions/_lib/paypal-signature.js';

const origin = 'https://webhealthreport.pages.dev';
let platform, db, env, key, cert, jwk, fetches;
const jwt = (extra = {}) => {
  const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = `${enc({ alg: 'RS256', kid: 'fixture' })}.${enc({ iss: 'https://security-auth.test/', aud: 'test-api', sub: 'owner', exp: Math.floor(Date.now() / 1000) + 3600, ...extra })}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), key).toString('base64url')}`;
};
const ctx = (path, { method = 'GET', token, body, headers = {} } = {}) => ({
  env, data: {}, params: { id: 'private-scan' },
  request: new Request(origin + path, { method, headers: { Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) }),
});
const dns = answers => Response.json({ Status: 0, Answer: answers }, { headers: { 'content-type': 'application/dns-json' } });
function stubFetch(handler) {
  mock.restoreAll();
  mock.method(globalThis, 'fetch', async (value, options = {}) => {
    const url = String(value); fetches.push({ url, options });
    if (url === 'https://security-auth.test/.well-known/jwks.json') return Response.json({ keys: [jwk] });
    if (url.startsWith('https://cloudflare-dns.com/')) {
      const q = new URL(url).searchParams;
      if (q.get('type') === 'AAAA') return dns([]);
      if (q.get('type') === 'MX') return dns([{ type: 15, data: '10 mail.example.com.' }]);
      return dns([{ type: 1, data: '93.184.216.34' }]);
    }
    if (url.includes('/v1/notifications/certs/')) return new Response(cert, { headers: { 'content-type': 'application/x-pem-file' } });
    if (url.endsWith('/v1/oauth2/token')) return Response.json({ access_token: 'dummy-token', expires_in: 3600 });
    if (handler) return handler(url, options);
    throw new Error(`Unexpected fetch ${url}`);
  });
}
function signedEvent(event, bytes = Buffer.from(JSON.stringify(event))) {
  const time = new Date().toISOString(), id = 'fixture-transmission';
  const sig = sign('RSA-SHA256', Buffer.from(`${id}|${time}|fixture-hook|${crc32(bytes)}`), key).toString('base64');
  return ctx('/api/paypal/webhook', { method: 'POST', body: bytes.toString(), headers: {
    'paypal-auth-algo': 'SHA256withRSA', 'paypal-transmission-id': id, 'paypal-transmission-time': time,
    'paypal-transmission-sig': sig, 'paypal-cert-url': 'https://api.paypal.com/v1/notifications/certs/CERT-fixture',
  } });
}
async function seedScan(scope = 'restricted', owner = 'owner', id = 'private-scan') {
  await db.prepare(`INSERT INTO scans (id, url, normalized_start_url, base_domain, status, started_at, access_scope, access_owner_id)
    VALUES (?, 'https://example.com/', 'https://example.com/', 'example.com', 'complete', 1, ?, ?)`).bind(id, scope, owner).run();
  await db.prepare("INSERT INTO reports (scan_id, rendered_summary_json, created_at) VALUES (?, ?, 1)").bind(id, JSON.stringify({ healthScore: 90, sentinel: 'PRIVATE-RECORD' })).run();
}

describe('production security boundaries', () => {
  before(async () => {
    key = createPrivateKey(await readFile('tests/fixtures/webhook-test-key.pem'));
    cert = await readFile('tests/fixtures/webhook-test-cert.pem', 'utf8');
    jwk = { ...createPublicKey(key).export({ format: 'jwk' }), kid: 'fixture', use: 'sig' };
    platform = await wrangler.getPlatformProxy({ configPath: 'wrangler.toml', persist: false, remoteBindings: false, envFiles: [] });
    db = platform.env.DB;
    env = { DB: db, ALLOWED_ORIGIN: origin, AUTH0_DOMAIN: 'security-auth.test', AUTH0_AUDIENCE: 'test-api', MONITOR_SECRET: 'fixture-admin', PAYPAL_WEBHOOK_ID: 'fixture-hook', PAYPAL_BASE_URL: 'https://api-m.sandbox.paypal.com', PAYPAL_CLIENT_ID: 'fixture', PAYPAL_CLIENT_SECRET: 'fixture', PAYPAL_PLAN_ID: 'P-FIXTURE' };
    const schema = (await readFile('schema.sql', 'utf8')).replace('-- ALTER TABLE scans ADD COLUMN site_id TEXT REFERENCES monitored_sites(id);', 'ALTER TABLE scans ADD COLUMN site_id TEXT REFERENCES monitored_sites(id);');
    for (const sql of [schema, ...await Promise.all(['004_subscriptions', '005_report_leads', '006_security_boundaries', '007_billing_entitlements'].map(name => readFile(`migrations/${name}.sql`, 'utf8')))]) {
      await db.batch(wrangler.unstable_splitSqlQuery(sql).map(query => db.prepare(query)));
    }
  });
  beforeEach(async () => {
    fetches = []; stubFetch();
    await db.prepare('DROP TRIGGER IF EXISTS reject_webhook').run();
    await db.prepare('DROP TRIGGER IF EXISTS reject_site').run();
    await db.prepare('UPDATE scans SET site_id = NULL').run();
    await db.prepare('DELETE FROM monitored_sites').run();
    for (const table of ['reports', 'scans', 'user_subscriptions', 'subscription_activations', 'request_limits', 'processed_webhook_events', 'billing_locks', 'paypal_pending_orders']) await db.prepare(`DELETE FROM ${table}`).run();
  });
  afterEach(() => mock.restoreAll());
  after(async () => { await platform?.dispose(); });

  for (const value of ['http://example.com', 'file:///etc/passwd', 'https://localhost', 'https://localhost.evil/', 'https://127.1/', 'https://2130706433/', 'https://0x7f000001/', 'https://[::1]/', 'https://[::ffff:127.0.0.1]/', 'https://169.254.169.254/', 'https://10.0.0.1/', 'https://user:pass@example.com/', 'https://example.com:8443/', 'https://example.com./', 'https://example.com/\u0000', 'https://example.com\\@evil.com/']) {
    // A public-looking name is allowed syntactically but must pass DNS.
    if (value === 'https://localhost.evil/') continue;
    it(`rejects crawler URL ${JSON.stringify(value)}`, () => assert.throws(() => publicUrl(value)));
  }
  it('accepts public hostnames and normalizes bare site names', () => assert.equal(siteUrl('example.com/path'), 'https://example.com/path'));
  for (const address of ['127.0.0.1', '10.1.2.3', '172.31.0.1', '192.168.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '2002:7f00:1::1', '2001:db8::1', '2001::1']) {
    it(`blocks non-public DNS address ${address}`, () => assert.equal(isPublicAddress(address), false));
  }
  it('accepts global unicast addresses', () => { assert.ok(isPublicAddress('8.8.8.8')); assert.ok(isPublicAddress('2606:4700:4700::1111')); });
  it('blocks a private redirect before making the second request', async () => {
    stubFetch(() => new Response(null, { status: 302, headers: { location: 'https://[::ffff:127.0.0.1]/secret' } }));
    await assert.rejects(crawlFetch('https://example.com/'));
    assert.equal(fetches.filter(f => !f.url.includes('dns-query')).length, 1);
  });
  it('refuses mixed public/private DNS records before contacting the destination', async () => {
    mock.restoreAll();
    mock.method(globalThis, 'fetch', async value => {
      const url = String(value); fetches.push({ url });
      if (url.includes('dns-query')) return dns([{ type: 1, data: '8.8.8.8' }, { type: 28, data: '::ffff:a9fe:a9fe' }]);
      throw new Error('Destination must not be contacted');
    });
    await assert.rejects(crawlFetch('https://example.com/'));
    assert.equal(fetches.length, 2);
  });
  it('resolves and checks every redirect host before following the hop', async () => {
    mock.restoreAll();
    const destinations = [];
    mock.method(globalThis, 'fetch', async value => {
      const url = String(value);
      if (url.includes('dns-query')) {
        const query = new URL(url).searchParams;
        return dns(query.get('type') === 'AAAA' ? [] : [{ type: 1, data: query.get('name') === 'redirect.example.com' ? '169.254.169.254' : '8.8.8.8' }]);
      }
      destinations.push(url);
      return new Response(null, { status: 302, headers: { location: 'https://redirect.example.com/private' } });
    });
    await assert.rejects(crawlFetch('https://example.com/'));
    assert.deepEqual(destinations, ['https://example.com/']);
  });
  it('bounds chunked HTML, cancels rejected bodies and discards non-HTML', async () => {
    let cancelled = false;
    stubFetch(() => new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/html' } }));
    await assert.rejects(crawlFetch('https://example.com/'), /too large/);
    assert.ok(cancelled);
    stubFetch(() => new Response('private-binary', { headers: { 'content-type': 'application/octet-stream' } }));
    assert.equal(await (await crawlFetch('https://example.com/')).response.text(), '');
  });
  it('aborts a stalled HTML body', async () => {
    stubFetch(() => new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'text/html' } }));
    await assert.rejects(crawlFetch('https://example.com/', { timeout: 30 }), /timed out/);
  });
  it('refuses credential-bearing service redirects and unsafe path identifiers', async () => {
    stubFetch(() => new Response(null, { status: 302, headers: { location: 'https://evil.com/' } }));
    await assert.rejects(serviceFetch('https://api.resend.com/emails', {}, { hosts: ['api.resend.com'] }), /redirect/);
    for (const id of ['../foo', '%2e%2e', 'I-OK/cancel', 'I-OK?x=1', '\u0000']) assert.throws(() => opaqueId(id));
    assert.equal(opaqueId('I-1234'), 'I-1234');
  });
  for (const claims of [{ exp: undefined }, { exp: '9999999999' }, { exp: Math.floor(Date.now() / 1000) }, { nbf: 9999999999 }, { sub: undefined }, { sub: '' }, { aud: 'wrong' }, { iss: 'https://other.test/' }]) {
    it(`rejects signed JWT claims ${JSON.stringify(claims)}`, async () => assert.rejects(verifyAuth0JWT(jwt(claims), env)));
  }
  it('accepts valid signed JWTs', async () => assert.equal((await verifyAuth0JWT(jwt(), env)).sub, 'owner'));
  it('accepts exact origins and referers, rejects localhost prefixes and open redirects', () => {
    for (const value of ['null', 'https://webhealthreport.pages.dev.evil.com', 'http://localhost.evil.com', 'http://localhost:5173']) {
      const req = new Request(origin, { headers: { Origin: value } });
      assert.equal(trustedOrigin(req, env), false);
      assert.notEqual(getAllowedOrigin(req, env), value);
    }
    assert.ok(trustedOrigin(new Request(origin, { headers: { Referer: origin + '/account' } }), env));
    assert.equal(trustedOrigin(new Request(origin), env), false);
    for (const value of ['//evil.com', '/\\evil.com', 'javascript:alert(1)', '/%2f%2fevil.com', '/\n/evil.com']) assert.equal(relativeRedirect(value), '/account');
    assert.equal(relativeRedirect('/report/abc'), '/report/abc');
    assert.equal(scriptJson({ x: '</script>' }).includes('<'), false);
  });
  it('bounds and validates JSON objects', async () => {
    for (const body of ['null', '[]', '"text"', '{', JSON.stringify({ x: 'x'.repeat(20000) })]) await assert.rejects(parseJson(new Request(origin, { method: 'POST', body })));
  });
  it('fails closed on absent Turnstile configuration and tokens from another hostname', async () => {
    const request = () => ctx('/api/scans', { method: 'POST', body: { url: 'https://example.com/', turnstileToken: 'fixture-token' } });
    assert.equal((await startScan(request())).status, 403);
    stubFetch(() => Response.json({ success: true, hostname: 'other-site.com' }));
    const c = request(); c.env = { ...env, TURNSTILE_SECRET_KEY: 'fixture-secret' };
    assert.equal((await startScan(c)).status, 403);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM scans').first()).n, 0);
  });
  it('authenticates every protected handler before parsing malformed input or reading private data', async () => {
    async function files(dir) { return (await Promise.all((await readdir(dir, { withFileTypes: true })).map(e => e.isDirectory() ? files(`${dir}/${e.name}`) : [`${dir}/${e.name}`]))).flat(); }
    for (const file of await files('functions/api')) {
      const user = file.includes('/user/') || (file.includes('/paypal/') && !file.endsWith('/webhook.js'));
      const admin = file.includes('/monitored-sites/');
      if (!user && !admin) continue;
      const module = await import('../../' + file);
      for (const [name, handler] of Object.entries(module)) {
        if (name === 'onRequestOptions' || !name.startsWith('onRequest')) continue;
        const method = name.slice('onRequest'.length).toUpperCase();
        const c = ctx('/api/test', { method, ...(method === 'GET' ? {} : { body: '{' }) });
        c.env = { ...env, DB: { prepare() { throw new Error('Private DB accessed before auth'); } } };
        assert.equal((await handler(c)).status, user ? 401 : 403, `${file}:${name}`);
      }
    }
  });
  it('returns 404 for private report/status/mail access without disclosing validation rules', async () => {
    await seedScan();
    for (const token of [undefined, 'invalid', jwt({ sub: 'other-owner' })]) {
      for (const handler of [report, status]) {
        const response = await handler(ctx('/api/scans/private-scan/report', { token }));
        assert.equal(response.status, 404); assert.ok(!(await response.text()).includes('PRIVATE-RECORD'));
      }
      assert.equal((await mail(ctx('/api/scans/private-scan/email-report', { method: 'POST', token, body: '{' }))).status, 404);
    }
    assert.equal((await report(ctx('/api/scans/private-scan/report', { token: jwt() }))).status, 200);
    assert.equal((await report(ctx('/api/scans/private-scan/report', { token: 'fixture-admin' }))).status, 200);
  });
  it('retains ownership after monitored-site deletion; public scans remain shareable', async () => {
    await seedScan();
    await db.prepare("INSERT INTO monitored_sites (id, url, base_domain, emails, next_scan_at, created_at, user_id) VALUES ('site', 'https://example.com', 'example.com', '[]', 1, 1, 'owner')").run();
    await db.prepare("UPDATE scans SET site_id = 'site' WHERE id = 'private-scan'").run();
    await deleteMonitoredSite(db, 'site', { userId: 'owner' });
    assert.equal((await report(ctx('/api/scans/private-scan/report'))).status, 404);
    assert.equal((await report(ctx('/api/scans/private-scan/report', { token: jwt() }))).status, 200);
    await seedScan('public', null, 'public-scan');
    const c = ctx('/api/scans/public-scan/report'); c.params.id = 'public-scan';
    const response = await report(c); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  });
  it('rate-limits atomically across concurrent requests', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => rateLimit(new Request(origin), env, 'fixture', 5)));
    assert.equal(results.filter(Boolean).length, 5);
  });
  it('returns a plain 429 with Retry-After once the admin request limit is reached', async () => {
    let response;
    for (let i = 0; i < 31; i++) {
      const c = ctx('/api/monitored-sites'); c.next = async () => Response.json({ error: 'Access denied' }, { status: 403 });
      response = await middleware(c);
    }
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), '60');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
  it('rejects Null MX and nonexistent domains; uses A fallback and a short cache', async () => {
    mock.restoreAll();
    mock.method(globalThis, 'fetch', async value => {
      const q = new URL(value).searchParams; fetches.push({ url: String(value) });
      if (q.get('name') === 'null-mail.com') return dns([{ type: 15, data: '0 .' }]);
      if (q.get('name') === 'absent-mail.com') return Response.json({ Status: 3 }, { headers: { 'content-type': 'application/dns-json' } });
      return dns(q.get('type') === 'MX' ? [] : [{ type: 1, data: '8.8.8.8' }]);
    });
    assert.equal(await validMailDomain('a@null-mail.com'), false);
    assert.equal(await validMailDomain('a@absent-mail.com'), false);
    assert.equal(await validMailDomain('a@fallback-mail.com'), true);
    const count = fetches.length; assert.equal(await validMailDomain('b@FALLBACK-mail.com'), true); assert.equal(fetches.length, count);
  });
  it('bounds DNS stalls to two seconds without caching a transient failure', async () => {
    mock.restoreAll();
    mock.method(globalThis, 'fetch', (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('DNS timeout')), { once: true })));
    const started = Date.now();
    await assert.rejects(validMailDomain('owner@timeout-mail.com'), /DNS timeout/);
    assert.ok(Date.now() - started < 2500);
    stubFetch();
    assert.equal(await validMailDomain('owner@timeout-mail.com'), true);
  });
  it('verifies webhook signatures over original bytes and rejects certificate SSRF', async () => {
    const event = { id: 'WH-fixture', event_type: 'UNKNOWN' };
    const c = signedEvent(event);
    assert.equal((await webhook(c)).status, 200);
    const altered = signedEvent(event); altered.request = new Request(altered.request.url, { method: 'POST', headers: altered.request.headers, body: JSON.stringify(event) + ' ' });
    assert.equal((await webhook(altered)).status, 401);
    const ssrf = signedEvent(event); ssrf.request.headers.set('paypal-cert-url', 'https://127.0.0.1/cert');
    assert.equal((await webhook(ssrf)).status, 401);
    assert.equal((await webhook(ctx('/api/paypal/webhook', { method: 'POST', body: '{}' }))).status, 401);
  });
  it('rolls webhook state back on marker failure and handles concurrent replay atomically', async () => {
    await db.prepare("INSERT INTO user_subscriptions (user_id, paypal_subscription_id, status, created_at, updated_at) VALUES ('owner', 'I-FIXTURE', 'active', 1, 1)").run();
    await db.prepare("CREATE TRIGGER reject_webhook BEFORE INSERT ON processed_webhook_events BEGIN SELECT RAISE(ABORT, 'fixture failure'); END").run();
    const event = { id: 'WH-payment', event_type: 'BILLING.SUBSCRIPTION.PAYMENT.FAILED', create_time: new Date().toISOString(), resource: { id: 'I-FIXTURE' } };
    assert.equal((await webhook(signedEvent(event))).status, 503);
    assert.equal((await db.prepare('SELECT status FROM user_subscriptions').first()).status, 'active');
    await db.prepare('DROP TRIGGER reject_webhook').run();
    const retried = (await Promise.all([webhook(signedEvent(event)), webhook(signedEvent(event))])).map(r => r.status).sort();
    assert.deepEqual(retried, [200, 503]);
    assert.equal((await webhook(signedEvent(event))).status, 200);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM processed_webhook_events').first()).n, 1);
  });
  it('creates exactly one paid site on concurrent activation and never accepts pending approval', async () => {
    let state = 'APPROVAL_PENDING';
    stubFetch(() => Response.json({ id: 'I-FIXTURE', status: state, custom_id: 'owner', plan_id: 'P-FIXTURE' }));
    const request = () => ctx('/api/paypal/subscription/activate', { method: 'POST', token: jwt(), body: { subscriptionId: 'I-FIXTURE', url: 'https://example.com', emails: ['owner@example.com'] } });
    assert.equal((await activate(request())).status, 400);
    state = 'ACTIVE';
    const responses = await Promise.all([activate(request()), activate(request())]);
    assert.ok(responses.every(r => [200, 201, 409].includes(r.status)));
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM monitored_sites').first()).n, 1);
    assert.equal((await db.prepare('SELECT site_count FROM user_subscriptions').first()).site_count, 1);
    assert.equal((await activate(request())).status, 200);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM monitored_sites').first()).n, 1);
  });
  it('rolls back all activation writes when site insertion fails', async () => {
    stubFetch(() => Response.json({ status: 'ACTIVE', custom_id: 'owner', plan_id: 'P-FIXTURE' }));
    await db.prepare("CREATE TRIGGER reject_site BEFORE INSERT ON monitored_sites BEGIN SELECT RAISE(ABORT, 'fixture failure'); END").run();
    await assert.rejects(activate(ctx('/api/paypal/subscription/activate', { method: 'POST', token: jwt(), body: { subscriptionId: 'I-FIXTURE', url: 'https://example.com', emails: ['owner@example.com'] } })));
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM subscription_activations').first()).n, 0);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM user_subscriptions').first()).n, 0);
  });
  async function paidFixture(status = 'active', count = 1, grace = null, user = 'owner') {
    await db.prepare(`INSERT INTO user_subscriptions (user_id, paypal_subscription_id, status, site_count, grace_period_ends_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, 1)`).bind(user, `I-${user}`, status, count, grace).run();
    for (let i = 0; i < count; i++) await db.prepare(`INSERT INTO monitored_sites (id, url, base_domain, emails, next_scan_at, created_at, user_id)
      VALUES (?, 'https://example.com/', 'example.com', '[]', ?, 1, ?)`).bind(`${user}-${i}`, Math.floor(Date.now() / 1000) + 86400, user).run();
  }
  async function pendingOrder(id = 'ORDER-ONE') {
    await db.prepare(`INSERT INTO paypal_pending_orders (order_id, user_id, amount, site_url, site_emails, created_at, activation_state)
      VALUES (?, 'owner', '1.00', 'https://example.com/added', '["owner@example.com"]', 1, 'pending')`).bind(id).run();
  }
  const captureRequest = (id = 'ORDER-ONE') => ctx('/api/paypal/order/capture', { method: 'POST', token: jwt(), body: { orderId: id } });
  function paymentProvider({ quantity = 1, beforeCapture } = {}) {
    const state = { quantity, captures: 0, revisions: 0, ids: [] };
    stubFetch(async (url, options) => {
      if (url.endsWith('/capture')) {
        state.captures++; state.ids.push(options.headers['PayPal-Request-Id']);
        await beforeCapture?.();
        return Response.json({ status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ status: 'COMPLETED', amount: { currency_code: 'USD', value: '1.00' } }] } }] });
      }
      if (url.endsWith('/revise')) {
        state.revisions++;
        return Response.json({ links: [{ rel: 'approve', href: 'https://www.sandbox.paypal.com/approve-fixture' }] });
      }
      if (url.endsWith('/cancel')) return new Response(null, { status: 204 });
      return Response.json({ status: 'ACTIVE', quantity: String(state.quantity), custom_id: 'owner', plan_id: 'P-FIXTURE' });
    });
    return state;
  }
  it('blocks cancelled/suspended monitoring before the cron pause pass and on direct scan processing', async () => {
    const now = Math.floor(Date.now() / 1000);
    for (const state of ['cancelled', 'suspended', 'grace_period']) {
      await paidFixture(state, 1, now - 60, state);
      assert.equal(await monitoringAllowed(db, `${state}-0`), false);
    }
    await paidFixture('cancelled', 1, now + 60, 'future');
    assert.equal(await monitoringAllowed(db, 'future-0'), true);
    await seedScan('restricted', 'cancelled');
    await db.prepare("UPDATE scans SET site_id = 'cancelled-0', status = 'running' WHERE id = 'private-scan'").run();
    assert.equal((await processBatch(env, 'private-scan')).status, 'failed');
    assert.equal(fetches.length, 0);
    await db.prepare("UPDATE monitored_sites SET next_scan_at = 0 WHERE user_id IN ('cancelled', 'suspended', 'grace_period')").run();
    const work = [];
    await scheduler.scheduled({}, env, { waitUntil: p => work.push(p) }); await Promise.all(work);
    for (const state of ['cancelled', 'suspended', 'grace_period']) assert.equal((await db.prepare('SELECT paused FROM monitored_sites WHERE id = ?').bind(`${state}-0`).first()).paused, 1);
    assert.equal((await db.prepare("SELECT paused FROM monitored_sites WHERE id = 'future-0'").first()).paused, 0);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM scans').first()).n, 1);
  });
  it('prevents retained sites from entering a new one-site subscription', async () => {
    await paidFixture('cancelled', 2, 1);
    const provider = paymentProvider();
    assert.equal((await createSubscription(ctx('/api/paypal/subscription', { method: 'POST', token: jwt() }))).status, 409);
    assert.equal(fetches.filter(f => !f.url.includes('jwks')).length, 0);
    assert.equal((await activate(ctx('/api/paypal/subscription/activate', { method: 'POST', token: jwt(), body: { subscriptionId: 'I-NEW', url: 'https://example.com/new', emails: ['owner@example.com'] } }))).status, 409);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM monitored_sites').first()).n, 2);
    assert.equal(provider.captures, 0);
  });
  it('preserves completed reports when an expired subscriber polls an old scan', async () => {
    await paidFixture('cancelled', 1, 1);
    await seedScan();
    await db.prepare("UPDATE scans SET site_id = 'owner-0' WHERE id = 'private-scan'").run();
    assert.equal((await processBatch(env, 'private-scan')).status, 'complete');
    assert.equal((await db.prepare("SELECT status FROM scans WHERE id = 'private-scan'").first()).status, 'complete');
    assert.equal((await report(ctx('/api/scans/private-scan/report', { token: jwt() }))).status, 200);
  });
  it('keeps captured additions pending until the approved provider quantity is effective, then activates exactly once', async () => {
    await paidFixture(); await pendingOrder();
    const provider = paymentProvider();
    const first = await captureOrder(captureRequest());
    assert.equal(first.status, 202); assert.equal((await first.json()).pendingApproval, true);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM monitored_sites').first()).n, 1);
    assert.equal((await db.prepare('SELECT site_count FROM user_subscriptions').first()).site_count, 1);
    assert.equal((await captureOrder(captureRequest())).status, 202);
    assert.equal(provider.captures, 1); assert.equal(provider.revisions, 1);
    provider.quantity = 2;
    assert.equal((await captureOrder(captureRequest())).status, 201);
    assert.equal((await captureOrder(captureRequest())).status, 200);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM monitored_sites').first()).n, 2);
    assert.equal((await db.prepare('SELECT site_count FROM user_subscriptions').first()).site_count, 2);
    assert.equal(provider.captures, 1);
  });
  it('serializes distinct captured orders for one account and preserves the second payment until pending approval completes', async () => {
    await paidFixture(); await pendingOrder(); await pendingOrder('ORDER-TWO');
    let entered, finish;
    const ready = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { finish = resolve; });
    const provider = paymentProvider({ beforeCapture: async () => { entered(); await gate; } });
    const first = captureOrder(captureRequest()); await ready;
    assert.equal((await captureOrder(captureRequest('ORDER-TWO'))).status, 409);
    finish(); assert.equal((await first).status, 202);
    assert.equal((await captureOrder(captureRequest('ORDER-TWO'))).status, 409);
    assert.equal(provider.captures, 1);
    assert.equal((await db.prepare('SELECT site_count FROM user_subscriptions').first()).site_count, 1);
  });
  it('keeps a paid pending order resumable after activation transaction failure', async () => {
    await paidFixture(); await pendingOrder();
    const provider = paymentProvider({ quantity: 2 });
    await db.prepare("CREATE TRIGGER reject_site BEFORE INSERT ON monitored_sites BEGIN SELECT RAISE(ABORT, 'fixture failure'); END").run();
    await assert.rejects(captureOrder(captureRequest()));
    assert.equal((await db.prepare('SELECT activation_state FROM paypal_pending_orders').first()).activation_state, 'pending');
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM monitored_sites').first()).n, 1);
    await db.prepare('DROP TRIGGER reject_site').run();
    assert.equal((await captureOrder(captureRequest())).status, 201);
    assert.equal(provider.captures, 1);
  });
  it('uses a stable provider idempotency key when capture confirmation is retried', async () => {
    await paidFixture(); await pendingOrder();
    let calls = 0;
    const provider = paymentProvider({ beforeCapture: async () => { if (++calls === 1) throw new Error('uncertain response'); } });
    assert.equal((await captureOrder(captureRequest())).status, 502);
    assert.equal((await captureOrder(captureRequest())).status, 202);
    assert.equal(provider.ids.length, 2); assert.ok(provider.ids[0]); assert.equal(provider.ids[0], provider.ids[1]);
  });
  it('makes cancellation idempotent and refuses stale activation events after cancellation', async () => {
    await paidFixture(); paymentProvider();
    const cancel = () => cancelSubscription(ctx('/api/paypal/subscription', { method: 'DELETE', token: jwt() }));
    assert.equal((await cancel()).status, 200);
    const deadline = (await db.prepare('SELECT grace_period_ends_at FROM user_subscriptions').first()).grace_period_ends_at;
    assert.equal((await cancel()).status, 200);
    assert.equal((await db.prepare('SELECT grace_period_ends_at FROM user_subscriptions').first()).grace_period_ends_at, deadline);
    const stale = { id: 'WH-stale', create_time: new Date(Date.now() - 3600000).toISOString(), event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', resource: { id: 'I-owner' } };
    assert.equal((await webhook(signedEvent(stale))).status, 200);
    assert.equal((await db.prepare('SELECT status FROM user_subscriptions').first()).status, 'cancelled');
  });
  it('does not unpause retained sites beyond the provider-approved recurring quantity', async () => {
    await paidFixture('active', 2); paymentProvider({ quantity: 1 });
    await db.prepare('UPDATE monitored_sites SET paused = 1').run();
    const event = { id: 'WH-underfunded', create_time: new Date().toISOString(), event_type: 'PAYMENT.SALE.COMPLETED', resource: { billing_agreement_id: 'I-owner' } };
    assert.equal((await webhook(signedEvent(event))).status, 200);
    assert.equal((await db.prepare('SELECT status FROM user_subscriptions').first()).status, 'suspended');
    assert.equal((await db.prepare('SELECT SUM(paused) AS n FROM monitored_sites').first()).n, 2);
    assert.equal(await monitoringAllowed(db, 'owner-0'), false);
  });
  it('allows approval navigation only to exact HTTPS PayPal hosts', () => {
    for (const href of ['http://www.paypal.com/', 'https://www.paypal.com.evil.com/', 'https://user:pass@www.paypal.com/', '//www.paypal.com/']) {
      assert.throws(() => approvalUrl({ links: [{ rel: 'approve', href }] }));
    }
    assert.equal(approvalUrl({ links: [{ rel: 'approve', href: 'https://www.sandbox.paypal.com/approve' }] }), 'https://www.sandbox.paypal.com/approve');
  });
  it('persists buyer-required reductions and blocks overlapping changes until confirmed', async () => {
    await paidFixture('active', 2);
    const provider = paymentProvider({ quantity: 2 });
    const remove = id => { const c = ctx(`/api/user/sites/${id}`, { method: 'DELETE', token: jwt() }); c.params.id = id; return removeUserSite(c); };
    assert.equal((await remove('owner-0')).status, 200);
    let row = await db.prepare('SELECT site_count, pending_quantity, pending_approval_url FROM user_subscriptions').first();
    assert.equal(row.site_count, 1); assert.equal(row.pending_quantity, 1); assert.ok(row.pending_approval_url);
    assert.equal((await remove('owner-1')).status, 409);
    const resume = () => createSubscription(ctx('/api/paypal/subscription', { method: 'POST', token: jwt() }));
    assert.equal((await (await resume()).json()).pendingApproval, true);
    provider.quantity = 1;
    assert.equal((await (await resume()).json()).confirmed, true);
    row = await db.prepare('SELECT pending_quantity, pending_approval_url FROM user_subscriptions').first();
    assert.deepEqual(row, { pending_quantity: null, pending_approval_url: null });
    assert.equal((await remove('owner-1')).status, 200);
  });
  it('centralizes no-store and clean errors across aliases, retired routes and unsupported methods', async () => {
    for (const path of ['/api/debug/check-url', '/api/monitored-sites/scan', '/api/auth/admin', '/api/internal/cron', '/api//user/sites', '/%61pi/user/sites', '/api/user/sites/%252e%252e', '/api/user/sites/']) {
      const c = ctx(path); c.next = async () => new Response('PRIVATE-RECORD', { headers: { 'content-type': 'text/html' } });
      const response = await middleware(c);
      assert.equal(response.status, 404, path); assert.ok(!(await response.text()).includes('PRIVATE-RECORD'));
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    const c = ctx('/api/user/sites', { method: 'POST', body: '{}' }); c.next = () => { throw new Error('Do not reach'); };
    assert.equal((await middleware(c)).status, 405);
    const failed = ctx('/api/user/sites'); failed.next = () => { throw new Error('PRIVATE-RECORD'); };
    const response = await middleware(failed); assert.equal(response.status, 500); assert.ok(!(await response.text()).includes('PRIVATE-RECORD'));
  });
  it('applies private-shell policy to case and trailing-slash aliases matched by React Router', async () => {
    for (const path of ['/account/', '/ACCOUNT', '/MONITOR/', '/REPORT/abc', '/SCAN/abc', '/REGISTER']) {
      const c = ctx(path); c.next = async () => new Response('<html>public shell</html>', { headers: { 'content-type': 'text/html' } });
      const response = await middleware(c);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
    }
  });
});
