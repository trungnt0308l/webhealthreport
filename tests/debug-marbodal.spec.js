import { test, expect } from '@playwright/test';

const SITE = 'https://webhealthreport.pages.dev';
const TARGET = 'marbodal.se';

test('debug: inspect raw liveErrors from backend for marbodal.se', async ({ page }) => {
  const apiResponses = [];

  // Capture every /status API response
  page.on('response', async response => {
    if (response.url().includes('/status')) {
      try {
        const body = await response.json();
        if (body.liveErrors?.length > 0) {
          apiResponses.push({
            url: response.url(),
            liveErrors: body.liveErrors,
          });
        }
      } catch {}
    }
  });

  await page.goto(SITE);
  await page.fill('input[type="url"], input[placeholder*="http"], input[name="url"], input', TARGET);
  await page.click('button[type="submit"], button:has-text("Scan"), button:has-text("Check")');

  // Wait up to 60s for scan to accumulate some errors
  await page.waitForTimeout(30000);

  // Print all captured liveErrors
  console.log('\n=== RAW liveErrors from backend ===');
  for (const r of apiResponses) {
    console.log(r.url);
    for (const e of r.liveErrors) {
      console.log(`  ${e.status} ${e.type} ${e.url}`);
    }
  }

  // Check if any bot-blocked codes slipped through
  const BOT_BLOCKED = new Set([403, 426, 429, 526, 530, 999]);
  const leaked = apiResponses.flatMap(r =>
    r.liveErrors.filter(e => e.type !== 'internal' && BOT_BLOCKED.has(e.status))
  );

  if (leaked.length > 0) {
    console.log('\n=== BOT-BLOCKED STATUSES LEAKING THROUGH ===');
    for (const e of leaked) {
      console.log(`  ${e.status} ${e.type} ${e.url}`);
    }
  }

  expect(leaked, 'Bot-blocked statuses should not appear in liveErrors').toHaveLength(0);
});
