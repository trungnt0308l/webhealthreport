import { test, expect } from '@playwright/test';

const site = {
  id: 'previously-run', url: 'https://example.com', base_domain: 'example.com',
  emails: '["owner@example.com"]', user_id: 'auth0|owner',
  last_scan_id: 'saved-report', last_scan_status: 'success', last_scan_at: 1700000000,
  next_scan_at: 1800000000, pending_scan_id: null,
};

async function openDashboard(page, role, onDelete) {
  // Keep authentication local while exercising the actual account UI and API client.
  await page.route('**/node_modules/.vite/deps/@auth0_auth0-react.js*', route => route.fulfill({
    contentType: 'application/javascript',
    body: `const auth = { isAuthenticated: true, isLoading: false,
      user: { sub: 'auth0|owner', email: 'owner@example.com', name: 'Owner' },
      getAccessTokenSilently: async () => 'test-user-token', logout() {}, loginWithRedirect() {} };
      export function useAuth0() { return auth; }
      export function Auth0Provider({ children }) { return children; }`,
  }));
  await page.route('**/api/paypal/subscription', route => route.fulfill({ json: { subscription: null } }));
  const path = role === 'admin' ? '/api/monitored-sites' : '/api/user/sites';
  await page.route(`**${path}`, route => route.fulfill({ json: { sites: [site] } }));
  await page.route(`**${path}/${site.id}`, onDelete);
  await page.goto(role === 'admin' ? '/monitor' : '/account');
  if (role === 'admin') {
    await page.getByPlaceholder('Monitor key').fill('test-admin-key');
    await page.getByRole('button', { name: 'Sign in' }).click();
  }
  const row = page.getByRole('row').filter({ hasText: 'example.com' });
  await expect(row).toBeVisible();
  return row;
}

for (const role of ['admin', 'user']) {
  test.describe(`${role} job removal`, () => {
    test('keeps the job visible until deletion succeeds, then removes its row', async ({ page }) => {
      let finish;
      const ready = new Promise(resolve => { finish = resolve; });
      let request;
      const row = await openDashboard(page, role, async route => {
        request = route.request();
        await ready;
        await route.fulfill({ json: { ok: true } });
      });
      page.on('dialog', dialog => dialog.accept());
      await row.getByRole('button', { name: 'Remove' }).click();
      await expect.poll(() => request?.method()).toBe('DELETE');
      expect(request.headers().authorization).toBe(`Bearer ${role === 'admin' ? 'test-admin-key' : 'test-user-token'}`);
      await expect(row).toBeVisible();
      finish();
      await expect(row).toHaveCount(0);
    });

    test('preserves the job and shows an error when deletion fails', async ({ page }) => {
      const row = await openDashboard(page, role, route => route.fulfill({ status: 500, json: { error: 'Database unavailable' } }));
      const alerts = [];
      page.on('dialog', dialog => {
        if (dialog.type() === 'alert') alerts.push(dialog.message());
        return dialog.accept();
      });
      await row.getByRole('button', { name: 'Remove' }).click();
      await expect.poll(() => alerts).toEqual(['Failed to remove site']);
      await expect(row).toBeVisible();
    });

    test('does not delete when confirmation is cancelled', async ({ page }) => {
      let requests = 0;
      const row = await openDashboard(page, role, route => {
        requests++;
        return route.fulfill({ json: { ok: true } });
      });
      page.on('dialog', dialog => dialog.dismiss());
      await row.getByRole('button', { name: 'Remove' }).click();
      await expect(row).toBeVisible();
      expect(requests).toBe(0);
    });
  });
}
