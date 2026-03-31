import { test, expect } from '@playwright/test';

const SCAN_ID = 'test-scan-123';

function makeScanRoute(page, overrides = {}) {
  const defaults = {
    status: 'running',
    currentStep: 'Crawling pages',
    pagesCrawled: 3,
    linksChecked: 12,
    issuesFound: 2,
    errorsAreLive: true,
    recentChecks: [
      { url: 'https://example.com/about', status: 200, type: 'internal', ms: 145 },
      { url: 'https://example.com/broken', status: 404, type: 'internal', ms: 80 },
      { url: 'https://external.com/img.png', status: 200, type: 'image', ms: 200 },
    ],
    liveErrors: [
      { url: 'https://example.com/broken', type: 'internal', status: 404, sourceUrl: 'https://example.com/' },
      { url: 'https://external.com/gone', type: 'external', status: 410, sourceUrl: 'https://example.com/about' },
    ],
  };
  page.route(`/api/scans/${SCAN_ID}/status`, route =>
    route.fulfill({ status: 200, body: JSON.stringify({ ...defaults, ...overrides }) })
  );
}

test.describe('Scan progress page', () => {
  test('shows spinner and current step', async ({ page }) => {
    makeScanRoute(page);
    await page.goto(`/scan/${SCAN_ID}`);

    await expect(page.getByText('Crawling pages')).toBeVisible();
    // Spinner element
    await expect(page.locator('.animate-spin')).toBeVisible();
  });

  test('shows stats: pages crawled, links checked, issues found', async ({ page }) => {
    makeScanRoute(page);
    await page.goto(`/scan/${SCAN_ID}`);

    await expect(page.getByText('Pages crawled')).toBeVisible();
    await expect(page.getByText('Links checked')).toBeVisible();
    await expect(page.getByText(/Issues found|Errors seen/)).toBeVisible();
  });

  test('shows live checks feed', async ({ page }) => {
    makeScanRoute(page);
    await page.goto(`/scan/${SCAN_ID}`);

    const feed = page.locator('.card', { hasText: 'Live checks' });
    await expect(feed).toBeVisible();
    await expect(feed.getByText(/example\.com\/about/)).toBeVisible();
    await expect(feed.getByText(/example\.com\/broken/)).toBeVisible();
  });

  test('shows status codes with correct colors', async ({ page }) => {
    makeScanRoute(page);
    await page.goto(`/scan/${SCAN_ID}`);

    // 200 status in green, 404 in red
    const green = page.locator('.text-green-600').first();
    const red = page.locator('.text-red-500').first();
    await expect(green).toBeVisible();
    await expect(red).toBeVisible();
  });

  test('shows live errors panel when errors are found', async ({ page }) => {
    makeScanRoute(page);
    await page.goto(`/scan/${SCAN_ID}`);

    const errorPanel = page.locator('.bg-red-50');
    await expect(errorPanel.getByText(/Errors found \(2\)/)).toBeVisible();
    await expect(errorPanel.getByText(/example\.com\/broken/)).toBeVisible();
    await expect(errorPanel.getByText(/external\.com\/gone/)).toBeVisible();
  });

  test('live errors panel shows error status codes', async ({ page }) => {
    makeScanRoute(page);
    await page.goto(`/scan/${SCAN_ID}`);

    const errorPanel = page.locator('.bg-red-50');
    await expect(errorPanel.getByText('404')).toBeVisible();
    await expect(errorPanel.getByText('410')).toBeVisible();
  });

  test('live errors panel shows source URL of most recent error', async ({ page }) => {
    makeScanRoute(page);
    await page.goto(`/scan/${SCAN_ID}`);

    const errorPanel = page.locator('.bg-red-50');
    await expect(errorPanel.getByText(/Most recent found on/)).toBeVisible();
    await expect(errorPanel.getByText('example.com/', { exact: true })).toBeVisible();
  });

  test('does not show errors panel when no errors', async ({ page }) => {
    makeScanRoute(page, { liveErrors: [], issuesFound: 0 });
    await page.goto(`/scan/${SCAN_ID}`);

    await expect(page.getByText(/Errors found/)).not.toBeVisible();
  });

  test('shows error state when API fails', async ({ page }) => {
    await page.route(`/api/scans/${SCAN_ID}/status`, route =>
      route.abort('failed')
    );
    await page.goto(`/scan/${SCAN_ID}`);

    await expect(page.getByText('Scan stopped')).toBeVisible();
    await expect(page.getByText('← Start a new scan')).toBeVisible();
  });

  test('navigates to report when scan completes', async ({ page }) => {
    let callCount = 0;
    await page.route(`/api/scans/${SCAN_ID}/status`, route => {
      callCount++;
      if (callCount === 1) {
        route.fulfill({ status: 200, body: JSON.stringify({ status: 'running', currentStep: 'Crawling pages', pagesCrawled: 5, linksChecked: 20, issuesFound: 0, recentChecks: [] }) });
      } else {
        route.fulfill({ status: 200, body: JSON.stringify({ status: 'complete', currentStep: 'Complete', pagesCrawled: 5, linksChecked: 20, issuesFound: 0, recentChecks: [] }) });
      }
    });

    // Mock the report page so the navigation succeeds
    await page.route(`/api/scans/${SCAN_ID}/report`, route =>
      route.fulfill({ status: 200, body: JSON.stringify(null) })
    );

    await page.goto(`/scan/${SCAN_ID}`);

    // Wait for navigation to report page (scan completes + 800ms delay)
    await expect(page).toHaveURL(`/report/${SCAN_ID}`, { timeout: 10000 });
  });
});
