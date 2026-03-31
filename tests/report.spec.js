import { test, expect } from '@playwright/test';

const REPORT_ID = 'test-report-456';

const MOCK_REPORT = {
  url: 'https://example.com',
  baseDomain: 'example.com',
  scannedAt: Math.floor(Date.now() / 1000),
  healthScore: 72,
  grade: 'C',
  pagesChecked: 8,
  linksChecked: 34,
  totalIssues: 3,
  criticalCount: 1,
  importantCount: 1,
  minorCount: 1,
  issues: [
    {
      id: 'i1',
      severity: 'critical',
      title: 'Broken internal links',
      explanation: 'Some pages return 404.',
      recommendedAction: 'Fix or redirect the broken URLs.',
      affectedCount: 2,
      type: 'broken_internal',
      example: { url: 'https://example.com/missing', sources: ['https://example.com/'] },
    },
    {
      id: 'i2',
      severity: 'important',
      title: 'Missing page titles',
      explanation: 'Pages without titles hurt SEO.',
      recommendedAction: 'Add unique <title> tags to each page.',
      affectedCount: 1,
      type: 'missing_title',
      example: { url: 'https://example.com/about', sources: [] },
    },
    {
      id: 'i3',
      severity: 'minor',
      title: 'Slow external link',
      explanation: 'An external link responded slowly.',
      recommendedAction: 'Monitor or replace the link.',
      affectedCount: 1,
      type: 'slow_link',
      example: { url: 'https://slow.example.org/', sources: ['https://example.com/contact'] },
    },
  ],
  pages: [
    { url: 'https://example.com/', statusCode: 200, title: 'Home', responseMs: 120 },
    { url: 'https://example.com/about', statusCode: 200, title: 'About', responseMs: 95 },
  ],
};

test.describe('Report page', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(`/api/scans/${REPORT_ID}/report`, route =>
      route.fulfill({ status: 200, body: JSON.stringify(MOCK_REPORT) })
    );
    await page.goto(`/report/${REPORT_ID}`);
  });

  test('shows domain and health score', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'example.com' })).toBeVisible();
    await expect(page.getByText('72')).toBeVisible();
  });

  test('shows grade and description', async ({ page }) => {
    await expect(page.getByText(/Grade C/)).toBeVisible();
  });

  test('shows summary stats', async ({ page }) => {
    await expect(page.getByText(/8 page/)).toBeVisible();
    await expect(page.getByText(/34 link/)).toBeVisible();
    await expect(page.getByText(/3 issue/)).toBeVisible();
  });

  test('shows issue severity counts', async ({ page }) => {
    // The summary grid shows uppercase labels below each count
    await expect(page.locator('.uppercase').getByText('Critical')).toBeVisible();
    await expect(page.locator('.uppercase').getByText('Important')).toBeVisible();
    await expect(page.locator('.uppercase').getByText('Minor')).toBeVisible();
  });

  test('critical issues section is open by default', async ({ page }) => {
    await expect(page.getByText('Broken internal links')).toBeVisible();
  });

  test('can expand issue details', async ({ page }) => {
    await page.getByRole('button', { name: /Details/i }).first().click();
    await expect(page.getByText('Some pages return 404.')).toBeVisible();
    await expect(page.getByText('Fix or redirect the broken URLs.')).toBeVisible();
  });

  test('can collapse expanded issue', async ({ page }) => {
    const btn = page.getByRole('button', { name: /Details/i }).first();
    await btn.click();
    await expect(page.getByText('Some pages return 404.')).toBeVisible();
    await page.getByRole('button', { name: /Less/i }).first().click();
    await expect(page.getByText('Some pages return 404.')).not.toBeVisible();
  });

  test('pages crawled section expands on click', async ({ page }) => {
    await page.getByRole('button', { name: /Pages crawled/i }).click();
    await expect(page.getByRole('cell', { name: 'https://example.com/', exact: true })).toBeVisible();
  });

  test('weekly monitoring CTA is visible', async ({ page }) => {
    await expect(page.getByText('Get this report automatically every week')).toBeVisible();
    await expect(page.getByRole('button', { name: /weekly monitoring/i })).toBeVisible();
  });

  test('weekly monitoring button shows alert', async ({ page }) => {
    page.on('dialog', async dialog => {
      expect(dialog.message()).toContain('coming soon');
      await dialog.accept();
    });
    await page.getByRole('button', { name: /weekly monitoring/i }).click();
  });

  test('new scan link navigates to home', async ({ page }) => {
    await page.getByRole('link', { name: /new scan/i }).click();
    await expect(page).toHaveURL('/');
  });

  test('shows loading state before report loads', async ({ page }) => {
    // Navigate without the route mock to see loading state briefly
    await page.route(`/api/scans/loading-test/report`, async route => {
      await new Promise(r => setTimeout(r, 500));
      route.fulfill({ status: 200, body: JSON.stringify(MOCK_REPORT) });
    });
    await page.goto(`/report/loading-test`);
    await expect(page.getByText('Loading report…')).toBeVisible();
  });

  test('shows error state when report fetch fails', async ({ page }) => {
    await page.route(`/api/scans/fail-test/report`, route =>
      route.abort('failed')
    );
    await page.goto(`/report/fail-test`);
    await expect(page.getByText('Could not load report.')).toBeVisible();
    await expect(page.getByText('← Start a new scan')).toBeVisible();
  });
});

test.describe('Report page — no issues', () => {
  test('shows green all-clear banner when no issues', async ({ page }) => {
    const cleanReport = { ...MOCK_REPORT, totalIssues: 0, criticalCount: 0, importantCount: 0, minorCount: 0, issues: [], healthScore: 100, grade: 'A' };
    await page.route(`/api/scans/clean/report`, route =>
      route.fulfill({ status: 200, body: JSON.stringify(cleanReport) })
    );
    await page.goto(`/report/clean`);
    await expect(page.getByText('No issues found')).toBeVisible();
  });
});
