import { test, expect } from '@playwright/test';
import { API_URL, getAuthHeaders } from './helpers';

// After a reboot the open node page reloads the node's update data by itself: when the node reports
// again (new update list, new boot time), the reboot state poll the page makes anyway notices it and
// "Reboot required" disappears without a manual reload. The Linux node shows its last boot.
test('Node page: "Reboot required" clears when the node reports after a reboot; last boot shown', async ({ page, request }) => {
  test.setTimeout(90_000);  // the page polls every 30 s
  const hostname = `e2e-after-reboot-${Date.now()}`;
  const headers = { ...(await getAuthHeaders()), 'Content-Type': 'application/json' };
  const report = (rebootRequired: boolean, lastBootTime: string) => request.post(`${API_URL}/api/v1/inventory/full`, { headers, data: {
    hostname, nodeId: hostname,
    system: { os: { name: 'Ubuntu 26.04 LTS', lastBootTime, uptimeHours: 240.5, uptimeFormatted: '10d 0h 30m' } },
    updates: { packageManager: 'apt', totalUpdates: 1, securityUpdates: 0, rebootRequired,
      rebootPackages: rebootRequired ? ['linux-image-7.0.0-45-generic'] : [],
      updates: [{ name: 'vim', newVersion: '2:9.1.0-1ubuntu1', repository: 'resolute-updates', security: false }] } } });
  expect((await report(true, '2026-11-14T09:00:00')).ok()).toBeTruthy();

  await page.goto(`/nodes/${hostname}`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('locale', 'en'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  // System info: last boot (UTC from the Linux agent) next to the uptime
  const lastBoot = page.locator('div.flex.justify-between').filter({ hasText: 'Last boot' });
  await expect(lastBoot).toContainText('2026');
  await expect(page.getByText('10d 0h 30m')).toBeVisible();

  // the page's first poll is the baseline; then the node reboots and reports
  const firstPoll = page.waitForResponse((r) => r.url().endsWith(`/reboot`) && r.request().method() === 'GET');
  await page.goto(`/nodes/${hostname}?tab=updates`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Reboot required', { exact: true })).toBeVisible();
  await firstPoll;
  expect((await report(false, '2026-11-25T17:50:40')).ok()).toBeTruthy();
  await expect(page.getByText('Reboot required', { exact: true })).toBeHidden({ timeout: 45_000 });
});
