import { test, expect } from '@playwright/test';

const report = { scanId: 'private-scan', url: 'https://example.com/', baseDomain: 'example.com', healthScore: 90, grade: 'A', pagesChecked: 1, linksChecked: 0, totalIssues: 0, criticalCount: 0, importantCount: 0, minorCount: 0, issues: [], pages: [] };
async function auth(page, authenticated = true) {
  await page.route('**/node_modules/.vite/deps/@auth0_auth0-react.js*', route => route.fulfill({ contentType: 'application/javascript', body: `const auth = { isAuthenticated: ${authenticated}, isLoading: false, user: { sub: 'owner', name: 'Owner', email: 'owner@example.com' }, getAccessTokenSilently: async () => 'fixture-owner', loginWithRedirect() {}, logout() {} }; export function useAuth0() { return auth; } export function Auth0Provider({children}) { return children; }` }));
}

test('owner report requests carry authentication and private reports hide the email form', async ({ page }) => {
  await auth(page);
  let authorization;
  await page.route('**/api/scans/private-scan/report', route => { authorization = route.request().headers().authorization; return route.fulfill({ json: { ...report, siteId: 'owned-site' } }); });
  await page.goto('/report/private-scan');
  await expect(page.getByText('example.com', { exact: true }).first()).toBeVisible();
  expect(authorization).toBe('Bearer fixture-owner');
  await expect(page.getByText('Email this report to yourself')).toHaveCount(0);
});

test('anonymous private reports show a clean sign-in flow without records', async ({ page }) => {
  await auth(page, false);
  await page.route('**/api/scans/private-scan/report', route => route.fulfill({ status: 404, json: { error: 'Not found' } }));
  await page.goto('/report/private-scan');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByText('example.com')).toHaveCount(0);
});

test('admin navigation retains its in-memory authorization and removes diagnostic tooling', async ({ page }) => {
  await auth(page, false);
  await page.route('**/api/monitored-sites', route => route.fulfill({ json: { sites: [{ id: 'site', url: 'https://example.com', base_domain: 'example.com', emails: '[]', last_scan_id: 'private-scan', last_scan_at: 1700000000 }] } }));
  let authorization;
  await page.route('**/api/scans/private-scan/report', route => { authorization = route.request().headers().authorization; return route.fulfill({ json: { ...report, siteId: 'site' } }); });
  await page.goto('/monitor');
  await page.getByPlaceholder('Monitor key').fill('fixture-admin');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('URL checker', { exact: true })).toHaveCount(0);
  await page.locator('a[href="/report/private-scan"]').click();
  await expect(page.getByText('example.com', { exact: true }).first()).toBeVisible();
  expect(authorization).toBe('Bearer fixture-admin');
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
});

test('private progress polling carries owner authentication', async ({ page }) => {
  await auth(page);
  let authorization;
  await page.route('**/api/scans/private-scan/status', route => { authorization = route.request().headers().authorization; return route.fulfill({ json: { scanId: 'private-scan', status: 'running', url: 'https://example.com', pagesCrawled: 2, linksChecked: 3, recentChecks: [] } }); });
  await page.goto('/scan/private-scan');
  await expect.poll(() => authorization).toBe('Bearer fixture-owner');
});

test('paid additions stay pending until server-confirmed approval and can resume after a reload', async ({ page }) => {
  await auth(page);
  let approved = false, captures = 0;
  await page.route('**/api/user/sites', route => route.fulfill({ json: { sites: [] } }));
  await page.route('**/api/paypal/subscription', route => route.fulfill({ json: {
    subscription: { status: 'active', site_count: 1 }, pendingOrder: approved ? null : 'ORDER-ONE',
  } }));
  await page.route('**/api/paypal/order/capture', route => {
    captures++;
    expect(route.request().headers().authorization).toBe('Bearer fixture-owner');
    return route.fulfill({ status: approved ? 201 : 202, json: approved ? { ok: true, siteId: 'new-site' } : { pendingApproval: true, approveUrl: null } });
  });
  await page.goto('/account?paypal_capture=1&order_id=ORDER-ONE');
  await expect(page.getByText('Your payment was received.', { exact: false })).toBeVisible();
  await expect(page.getByText('Site added successfully!', { exact: false })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Complete billing approval' })).toBeVisible();
  approved = true;
  await page.getByRole('button', { name: 'Complete billing approval' }).click();
  await expect(page.getByText('Site added successfully!', { exact: false })).toBeVisible();
  expect(captures).toBe(2);
});

test('buyer-required quantity changes navigate to the returned PayPal approval URL', async ({ page }) => {
  await auth(page);
  await page.route('**/api/user/sites', route => route.fulfill({ json: { sites: [] } }));
  await page.route('**/api/paypal/subscription', route => route.fulfill({ json: { subscription: { status: 'active', site_count: 1 }, pendingOrder: 'ORDER-ONE' } }));
  await page.route('**/api/paypal/order/capture', route => route.fulfill({ status: 202, json: { pendingApproval: true, approveUrl: 'https://www.sandbox.paypal.com/approval-fixture' } }));
  await page.route('https://www.sandbox.paypal.com/approval-fixture', route => route.fulfill({ contentType: 'text/html', body: '<p>Controlled buyer approval fixture</p>' }));
  await page.goto('/account');
  await page.getByRole('button', { name: 'Complete billing approval' }).click();
  await expect(page).toHaveURL('https://www.sandbox.paypal.com/approval-fixture');
});
