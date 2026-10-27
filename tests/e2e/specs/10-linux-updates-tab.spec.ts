import { test, expect } from '@playwright/test';
import { API_URL, getAuthHeaders } from './helpers';

// A Linux node reports its package updates with the inventory; the node page's
// Updates tab must show them (it used to show an empty "Windows Updates (0)").
test('Updates tab of a Linux node shows its package updates', async ({ page, request }) => {
  const hostname = `e2e-linux-updates-${Date.now()}`;
  const response = await request.post(`${API_URL}/api/v1/inventory/full`, {
    headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
    data: {
      hostname,
      nodeId: hostname,
      updates: {
        packageManager: 'apt',
        totalUpdates: 2,
        securityUpdates: 1,
        updates: [
          { name: 'systemd', newVersion: '259.2-1ubuntu3.1', repository: 'resolute-updates', security: false },
          { name: 'openssl', newVersion: '3.5.1-1ubuntu2.1', repository: 'resolute-security', security: true },
        ],
      },
    },
  });
  expect(response.ok()).toBeTruthy();

  await page.goto(`/nodes/${hostname}`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('locale', 'en'));
  await page.reload({ waitUntil: 'domcontentloaded' });

  const updatesTab = page.getByRole('tab', { name: /^Updates \(2\)$/ });
  await expect(updatesTab).toBeVisible();
  await updatesTab.click();

  const panel = page.getByRole('tabpanel');
  await expect(panel.getByText('Package updates (2)')).toBeVisible();
  await expect(panel.getByText('259.2-1ubuntu3.1')).toBeVisible();
  await expect(panel.getByText('resolute-security')).toBeVisible();
  await expect(panel.getByText('Security', { exact: true })).toBeVisible();
  await expect(panel.getByText(/Windows Updates/)).toHaveCount(0);
});
