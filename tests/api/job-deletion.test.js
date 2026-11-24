import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import wrangler from 'wrangler';
import { onRequestDelete as deleteAdminSite } from '../../functions/api/monitored-sites/[id].js';
import { onRequestDelete as deleteUserSite } from '../../functions/api/user/sites/[id].js';
import { onRequestGet as getReport } from '../../functions/api/scans/[id]/report.js';
import scheduler from '../../scheduler/index.js';
import { deleteMonitoredSite } from '../../functions/_lib/monitored-sites.js';
import { processBatch } from '../../functions/_lib/scan-engine.js';

const { getPlatformProxy, unstable_splitSqlQuery: splitSqlQuery } = wrangler;

let platform, db, env, token, jwk;
let paypalCalls = [];
let paypalFails = false;
let paypalQuantity = 2;
const userId = 'auth0|owner';

async function sql(query, ...values) {
  return db.prepare(query).bind(...values).run();
}

async function seedSite(id = 'site', owner = userId, withScans = true) {
  await sql(`INSERT INTO monitored_sites (id, url, base_domain, emails, next_scan_at, created_at, user_id)
    VALUES (?, 'https://example.com', 'example.com', '["owner@example.com"]', 9999999999, 1, ?)`, id, owner);
  if (!withScans) return;
  for (const [suffix, status] of [['old', 'complete'], ['last', 'complete'], ['pending', 'running']]) {
    const scanId = `${id}-${suffix}`;
    await sql(`INSERT INTO scans (id, url, normalized_start_url, base_domain, site_id, status, started_at)
      VALUES (?, 'https://example.com', 'https://example.com/', 'example.com', ?, ?, unixepoch())`, scanId, id, status);
    await sql(`INSERT INTO pages (scan_id, url, normalized_url, status_code, content_type, title, text_length, response_ms)
      VALUES (?, 'https://example.com/', 'https://example.com/', 200, 'text/html', '', 1000, 10)`, scanId);
    await sql(`INSERT INTO crawl_queue (scan_id, url, normalized_url, url_type, status)
      VALUES (?, 'https://example.com/', 'https://example.com/', 'internal', 'done')`, scanId);
    await sql(`INSERT INTO link_checks (scan_id, source_url, target_url, normalized_target_url, target_type, response_status)
      VALUES (?, 'https://example.com/', 'https://example.com/broken', 'https://example.com/broken', 'internal', 404)`, scanId);
    await sql(`INSERT INTO issues (scan_id, issue_type, severity, fingerprint, title, explanation, recommended_action)
      VALUES (?, 'missing_title', 'minor', ?, 'Missing title', 'No title', 'Add title')`, scanId, scanId);
  }
  await sql('UPDATE monitored_sites SET last_scan_id = ?, pending_scan_id = ? WHERE id = ?', `${id}-last`, `${id}-pending`, id);
  await sql(`INSERT INTO suppressed_issues (site_id, issue_type, suppressed_at) VALUES (?, 'missing_title', 1)`, id);
  await sql(`INSERT INTO issue_history (site_id, issue_type, first_detected_at) VALUES (?, 'missing_title', 1)`, id);
  await sql(`INSERT INTO report_leads (scan_id, email, sent_at) VALUES (?, 'owner@example.com', 1)`, `${id}-last`);
  await sql(`INSERT INTO reports (scan_id, rendered_summary_json, created_at) VALUES (?, ?, 1)`, `${id}-last`, JSON.stringify({ scanId: `${id}-last`, healthScore: 90 }));
}

function context(id, bearer = 'admin-key') {
  return {
    params: { id }, env, data: {},
    request: new Request(`https://example.test/api/sites/${id}`, {
      method: 'DELETE', headers: { Origin: 'https://webhealthreport.pages.dev', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    }),
  };
}

async function subscription(count = 2) {
  await sql(`INSERT INTO user_subscriptions (user_id, paypal_subscription_id, status, site_count, created_at, updated_at)
    VALUES (?, 'I-TEST', 'active', ?, 1, 1)`, userId, count);
}

describe('monitoring job deletion with local D1 foreign keys', () => {
  before(async () => {
    platform = await getPlatformProxy({ configPath: 'wrangler.toml', persist: false, remoteBindings: false, envFiles: [] });
    db = platform.env.DB;
    env = { DB: db, MONITOR_SECRET: 'admin-key', AUTH0_DOMAIN: 'auth.test', AUTH0_AUDIENCE: 'test-api',
      PAYPAL_BASE_URL: 'https://api-m.sandbox.paypal.com', PAYPAL_CLIENT_ID: 'test', PAYPAL_CLIENT_SECRET: 'test' };
    // schema.sql is a current snapshot, but documents site_id as a separate ALTER.
    const schema = (await readFile('schema.sql', 'utf8')).replace(
      '-- ALTER TABLE scans ADD COLUMN site_id TEXT REFERENCES monitored_sites(id);',
      'ALTER TABLE scans ADD COLUMN site_id TEXT REFERENCES monitored_sites(id);');
    for (const source of [schema, await readFile('migrations/004_subscriptions.sql', 'utf8'), await readFile('migrations/005_report_leads.sql', 'utf8'), await readFile('migrations/006_security_boundaries.sql', 'utf8'), await readFile('migrations/007_billing_entitlements.sql', 'utf8')]) {
      await db.batch(splitSqlQuery(source).map(query => db.prepare(query)));
    }
    const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    jwk = { ...await crypto.subtle.exportKey('jwk', keys.publicKey), kid: 'test-key', use: 'sig' };
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const input = `${encode({ alg: 'RS256', kid: jwk.kid })}.${encode({ sub: userId, iss: 'https://auth.test/', aud: 'test-api', exp: Math.floor(Date.now() / 1000) + 3600 })}`;
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(input));
    token = `${input}.${Buffer.from(signature).toString('base64url')}`;
  });

  after(async () => { mock.restoreAll(); await platform?.dispose(); });

  beforeEach(async () => {
    mock.restoreAll();
    paypalCalls = [];
    paypalFails = false;
    paypalQuantity = 2;
    mock.method(globalThis, 'fetch', async (url, options = {}) => {
      if (url === 'https://auth.test/.well-known/jwks.json') return Response.json({ keys: [jwk] });
      if (url === 'https://api-m.sandbox.paypal.com/v1/oauth2/token') return Response.json({ access_token: 'test-token', expires_in: 3600 });
      if (String(url).startsWith('https://api-m.sandbox.paypal.com/v1/billing/')) {
        if (!options.method || options.method === 'GET') return Response.json({ status: 'ACTIVE', quantity: String(paypalQuantity) });
        paypalCalls.push({ url, ...options });
        if (String(url).endsWith('/revise') && !paypalFails) paypalQuantity = Number(JSON.parse(options.body).quantity);
        return paypalFails ? Response.json({ error: 'unavailable' }, { status: 503 }) : new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected external fetch: ${url}`);
    });
    await sql('DROP TRIGGER IF EXISTS block_deletion');
    await sql('UPDATE scans SET site_id = NULL');
    await sql('DELETE FROM monitored_sites');
    for (const table of ['reports', 'report_leads', 'issues', 'pages', 'link_checks', 'crawl_queue', 'scans', 'user_subscriptions', 'billing_locks']) await sql(`DELETE FROM ${table}`);
  });

  for (const role of ['admin', 'user']) {
    const remove = id => role === 'admin' ? deleteAdminSite(context(id)) : deleteUserSite(context(id, token));

    it(`${role}: removes a job with multiple prior scans and a pending scan, preserving reports`, async () => {
      await seedSite();
      await seedSite('other', 'auth0|other');
      const response = await remove('site');
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true });
      assert.equal(await db.prepare('SELECT * FROM monitored_sites WHERE id = ?').bind('site').first(), null);
      const scans = await db.prepare('SELECT site_id FROM scans WHERE id LIKE ?').bind('site-%').all();
      assert.equal(scans.results.length, 3);
      assert.ok(scans.results.every(scan => scan.site_id === null));
      for (const table of ['suppressed_issues', 'issue_history']) {
        assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE site_id = 'site'`).first()).n, 0);
        assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE site_id = 'other'`).first()).n, 1);
      }
      for (const table of ['pages', 'link_checks', 'issues', 'crawl_queue']) {
        assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE scan_id LIKE 'site-%'`).first()).n, 3);
      }
      assert.equal((await db.prepare('SELECT site_id FROM scans WHERE id = ?').bind('other-last').first()).site_id, 'other');
      assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM report_leads').first()).n, 2);
      const report = await getReport(context('site-last'));
      assert.equal(report.status, 200);
      assert.equal((await report.json()).healthScore, 90);
      assert.equal((await remove('site')).status, 404);
      assert.equal((await db.prepare('PRAGMA foreign_key_check').all()).results.length, 0);
    });

    it(`${role}: removes a job that has never run and returns 404 for missing jobs`, async () => {
      await seedSite('new', userId, false);
      assert.equal((await remove('new')).status, 200);
      assert.equal((await remove('missing')).status, 404);
    });

    it(`${role}: rolls back scan detachment if deletion fails`, async () => {
      await seedSite();
      await subscription();
      await sql(`CREATE TRIGGER block_deletion BEFORE DELETE ON monitored_sites BEGIN SELECT RAISE(ABORT, 'forced delete failure'); END`);
      await assert.rejects(remove('site'), /forced delete failure/);
      assert.equal((await db.prepare('SELECT site_id FROM scans WHERE id = ?').bind('site-last').first()).site_id, 'site');
      assert.equal((await db.prepare('SELECT pending_scan_id FROM monitored_sites WHERE id = ?').bind('site').first()).pending_scan_id, 'site-pending');
      assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM suppressed_issues').first()).n, 1);
      assert.equal(paypalCalls.length, 0);
      assert.equal((await db.prepare('SELECT site_count FROM user_subscriptions').first()).site_count, 2);
    });
  }

  it('rejects unauthenticated and foreign-owned deletion without changing any data', async () => {
    await seedSite('foreign', 'auth0|other');
    assert.equal((await deleteAdminSite(context('foreign', 'wrong-key'))).status, 403);
    assert.equal((await deleteUserSite(context('foreign', ''))).status, 401);
    assert.equal((await deleteUserSite(context('foreign', 'invalid-token'))).status, 401);
    assert.equal((await deleteUserSite(context('foreign', token))).status, 404);
    assert.equal((await db.prepare('SELECT site_id FROM scans WHERE id = ?').bind('foreign-last').first()).site_id, 'foreign');
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM issue_history').first()).n, 1);
    assert.equal(paypalCalls.length, 0);
  });

  it('never treats a missing user identity as administrator scope', async () => {
    await seedSite();
    await assert.rejects(deleteMonitoredSite(db, 'site', { userId: undefined }));
    assert.equal((await db.prepare('SELECT site_id FROM scans WHERE id = ?').bind('site-last').first()).site_id, 'site');
  });

  it('only the winning concurrent user deletion changes subscription quantity', async () => {
    await seedSite();
    await seedSite('remaining', userId, false);
    await subscription(2);
    const results = await Promise.all([deleteUserSite(context('site', token)), deleteUserSite(context('site', token))]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    assert.equal((await deleteUserSite(context('site', token))).status, 404);
    assert.equal(paypalCalls.length, 1);
    assert.equal(JSON.parse(paypalCalls[0].body).quantity, '1');
    assert.equal((await db.prepare('SELECT site_count FROM user_subscriptions').first()).site_count, 1);
  });

  it('cancels billing when the user removes their last site', async () => {
    await seedSite();
    await subscription(1);
    assert.equal((await deleteUserSite(context('site', token))).status, 200);
    assert.ok(paypalCalls[0].url.endsWith('/I-TEST/cancel'));
    assert.deepEqual(await db.prepare('SELECT site_count, status FROM user_subscriptions').first(), { site_count: 0, status: 'cancelled' });
  });

  it('still completes user deletion when PayPal fails', async () => {
    await seedSite();
    await subscription(2);
    paypalFails = true;
    const log = mock.method(console, 'error', () => {});
    assert.equal((await deleteUserSite(context('site', token))).status, 200);
    assert.equal(log.mock.callCount(), 1);
    assert.equal(await db.prepare('SELECT * FROM monitored_sites').first(), null);
  });

  it('a queued scan finishes safely after its site was removed', async () => {
    await seedSite();
    await deleteUserSite(context('site', token));
    const message = { body: { scanId: 'site-pending', siteId: 'site' }, ack: mock.fn(), retry: mock.fn() };
    const log = mock.method(console, 'error', () => {});
    await scheduler.queue({ messages: [message] }, env);
    assert.equal(message.ack.mock.callCount(), 1);
    assert.equal(message.retry.mock.callCount(), 0);
    assert.equal(log.mock.callCount(), 0);
    assert.equal((await db.prepare('SELECT status FROM scans WHERE id = ?').bind('site-pending').first()).status, 'complete');
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM issue_history').first()).n, 0);
    const report = await getReport(context('site-pending'));
    assert.equal(report.status, 200);
    assert.equal((await report.json()).scanId, 'site-pending');
  });

  it('scan completion still records history for a site that remains monitored', async () => {
    await seedSite();
    await subscription(1);
    const result = await processBatch(env, 'site-pending', 'site');
    assert.equal(result.status, 'complete');
    const history = await db.prepare('SELECT issue_type FROM issue_history WHERE site_id = ?').bind('site').all();
    assert.ok(history.results.some(issue => issue.issue_type === 'broken_internal_link'));
    assert.equal((await db.prepare('PRAGMA foreign_key_check').all()).results.length, 0);
  });

  it('scheduled expiration removes scanned sites without losing report data', async () => {
    await seedSite();
    await subscription(1);
    await sql(`UPDATE user_subscriptions SET status = 'suspended', payment_failed_at = 1`);
    const work = [];
    await scheduler.scheduled({}, env, { waitUntil: promise => work.push(promise) });
    await Promise.all(work);
    assert.equal(await db.prepare('SELECT * FROM monitored_sites').first(), null);
    assert.equal(await db.prepare('SELECT * FROM user_subscriptions').first(), null);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM scans').first()).n, 3);
    assert.equal((await db.prepare('PRAGMA foreign_key_check').all()).results.length, 0);
  });
});
