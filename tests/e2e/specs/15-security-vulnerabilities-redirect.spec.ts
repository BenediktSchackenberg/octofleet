import { test, expect } from '@playwright/test';

// The old Security Center vulnerabilities page leads to the vulnerability dashboard.
test('security vulnerabilities page redirects to the vulnerability dashboard', async ({ page }) => {
  await page.goto('/security/vulnerabilities', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/vulnerabilities$/);
});
