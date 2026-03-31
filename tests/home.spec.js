import { test, expect } from '@playwright/test';

test.describe('Home page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('renders header and branding', async ({ page }) => {
    await expect(page.locator('header')).toBeVisible();
    await expect(page.locator('header').getByText('Website Health Report')).toBeVisible();
  });

  test('renders hero heading', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Scan your website');
  });

  test('renders URL input and submit button', async ({ page }) => {
    const input = page.getByPlaceholder('https://yourwebsite.com');
    const button = page.getByRole('button', { name: /scan my site/i });
    await expect(input).toBeVisible();
    await expect(button).toBeVisible();
  });

  test('submit button is disabled when input is empty', async ({ page }) => {
    const button = page.getByRole('button', { name: /scan my site/i });
    await expect(button).toBeDisabled();
  });

  test('submit button enables when URL is typed', async ({ page }) => {
    const input = page.getByPlaceholder('https://yourwebsite.com');
    const button = page.getByRole('button', { name: /scan my site/i });
    await input.fill('https://example.com');
    await expect(button).toBeEnabled();
  });

  test('renders three feature cards', async ({ page }) => {
    await expect(page.getByText('Live scan progress')).toBeVisible();
    await expect(page.getByText('Clear report')).toBeVisible();
    await expect(page.getByText('Instant results')).toBeVisible();
  });

  test('renders footer text', async ({ page }) => {
    await expect(page.locator('footer')).toContainText('checks up to 1,000 pages per scan');
  });

  test('shows error when API call fails', async ({ page }) => {
    // Intercept the API call and simulate failure
    await page.route('/api/scans', route =>
      route.fulfill({ status: 500, body: '{}' })
    );

    const input = page.getByPlaceholder('https://yourwebsite.com');
    await input.fill('https://example.com');
    await page.getByRole('button', { name: /scan my site/i }).click();

    await expect(page.getByText('Failed to start scan')).toBeVisible();
  });

  test('button shows "Starting…" while loading', async ({ page }) => {
    // Delay the API response so we can catch the loading state
    await page.route('/api/scans', async route => {
      await new Promise(r => setTimeout(r, 2000));
      route.fulfill({ status: 500, body: '{}' });
    });

    const input = page.getByPlaceholder('https://yourwebsite.com');
    await input.fill('https://example.com');
    await page.getByRole('button', { name: /scan my site/i }).click();

    await expect(page.getByRole('button', { name: /starting/i })).toBeVisible();
  });
});
