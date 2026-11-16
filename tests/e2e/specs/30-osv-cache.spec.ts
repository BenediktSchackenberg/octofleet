import { test, expect } from '@playwright/test';

// The OSV advisory cache card on the scan history tab of /vulnerabilities.
test('the scan history shows the OSV cache with its actions', async ({ page }) => {
  await page.goto('/vulnerabilities?tab=scans', { waitUntil: 'domcontentloaded' });
  const card = page.getByTestId('osv-cache');
  await expect(card).toBeVisible({ timeout: 15000 });
  await expect(card).toContainText('OSV advisory cache');
  await expect(card).toContainText('Entries');
  await expect(card.getByRole('button', { name: 'Full scan without cache' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Verify (50 random)' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Clear cache' })).toBeVisible();
});
