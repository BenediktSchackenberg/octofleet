import { test, expect } from '@playwright/test';
import { API_URL, getAuthHeaders } from './helpers';

// Linux nodes: each pending update shows whether it needs a reboot, like Windows updates do - the same
// estimate (from the server) as the install dialog and the fleet view
test('Linux updates: reboot marker per update, same as the dialog and the fleet view', async ({ page, request }) => {
  const hostname = `e2e-linux-reboot-${Date.now()}`;
  const headers = { ...(await getAuthHeaders()), 'Content-Type': 'application/json' };
  expect((await request.post(`${API_URL}/api/v1/inventory/full`, { headers, data: {
    hostname, nodeId: hostname, system: { os: { name: 'Ubuntu 26.04 LTS' } },
    updates: { packageManager: 'apt', totalUpdates: 3, securityUpdates: 0, rebootRequired: false, updates: [
      { name: 'linux-image-generic', newVersion: '7.0.0-45.45', repository: 'resolute-updates', security: false },
      { name: 'libc6', newVersion: '2.42-0ubuntu3.1', repository: 'resolute-updates', security: false },
      { name: 'vim', newVersion: '2:9.1.0-1ubuntu1', repository: 'resolute-updates', security: false },
    ] } } })).ok()).toBeTruthy();

  // the API gives each update its estimate
  const linux = await (await request.get(`${API_URL}/api/v1/inventory/linux/${hostname}`, { headers })).json();
  expect(linux.data.updates.updates.map((u: { reboot_behavior: string }) => u.reboot_behavior)).toEqual(['always', 'can', 'never']);

  await page.goto(`/nodes/${hostname}?tab=updates`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('locale', 'en'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  const row = (name: string) => page.getByRole('row').filter({ hasText: name });
  await expect(row('linux-image-generic')).toContainText('Needs a reboot');
  await expect(row('libc6')).toContainText('May need a reboot');
  await expect(row('vim')).not.toContainText('reboot');

  // the install dialog says the same for the kernel
  await page.getByRole('button', { name: /Install updates/ }).click();
  await expect(page.getByRole('dialog')).toContainText('linux-image-generic');

  // the fleet view: "Will need a reboot", the packages as tooltip
  await page.goto(`/patches/updates?q=${hostname}`, { waitUntil: 'domcontentloaded' });
  const badge = page.getByRole('row').filter({ hasText: hostname }).getByText('Will need a reboot');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute('title', 'linux-image-generic, libc6');
});
