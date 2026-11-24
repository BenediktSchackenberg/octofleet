import { test, expect } from '@playwright/test';
import { API_URL, getAuthHeaders } from './helpers';

// Dashboard cards link to what they count: Jobs (24h) opens the filtered Jobs page and shows the
// same numbers as that page's counts (jobs, failed by failure time)
test('Dashboard: Jobs (24h) counts like the Jobs page and links to it', async ({ page, request }) => {
  const headers = await getAuthHeaders();
  const api = await request.get(`${API_URL}/api/v1/jobs?since_hours=24&limit=1`, { headers });
  expect(api.ok()).toBeTruthy();
  const counts = (await api.json()).counts as { success: number; failed: number };

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('locale', 'en'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  const success = page.locator('a[href="/jobs?status=success&range=24h"]');
  const failed = page.locator('a[href="/jobs?status=failed&range=24h"]');
  await expect(success).toContainText(String(counts.success));
  await expect(failed).toContainText(String(counts.failed));

  // The card's header opens all jobs of the last 24 hours (no status filter)
  await expect(page.getByRole('link', { name: 'Show jobs →' })).toHaveAttribute('href', '/jobs?range=24h');

  await failed.click();
  await expect(page).toHaveURL(/\/jobs\?status=failed&range=24h/);
});
