import { test, expect } from '@playwright/test';
import { API_URL, getAuthHeaders } from './helpers';

// Installed updates (Win32_QuickFixEngineering) are shown with the title, type and result from the
// Windows Update history; a KB without a history entry is shown as installed
test('installed updates show title, type and status from the update history', async ({ page, request }) => {
  const hostname = `e2e-qfe-${Date.now()}`;
  const headers = { ...(await getAuthHeaders()), 'Content-Type': 'application/json' };
  const pushed = await request.post(`${API_URL}/api/v1/inventory/full`, {
    headers,
    data: {
      hostname, nodeId: hostname,
      system: { os: { name: 'Microsoft Windows Server 2025 Standard' } },
      hotfixes: {
        hotfixes: [
          { hotfixId: 'KB5128646', description: 'Security Update', installedOn: '2026-10-16T00:00:00Z' },
          { hotfixId: 'KB5099777', description: 'Update', installedOn: '2026-10-16T00:00:00Z' },
          { hotfixId: 'KB5099888', description: 'Update', installedOn: '2026-10-01T00:00:00Z' },
        ],
        updateHistory: [
          { updateId: 'e2e-1', kbId: 'KB5128646', title: '2026-10 Cumulative Update for Microsoft server operating system version 24H2 for x64-based Systems (KB5128646)',
            installedOn: '2026-10-16T10:00:00Z', operation: 'Installation', resultCode: 'Succeeded' },
          { updateId: 'e2e-2', kbId: 'KB5099777', title: '2026-10 Cumulative Update for .NET Framework 3.5 and 4.8.1 (KB5099777)',
            installedOn: '2026-10-16T10:05:00Z', operation: 'Installation', resultCode: 'Failed' },
        ],
      },
    },
  });
  expect(pushed.ok()).toBeTruthy();

  await page.goto(`/nodes/${hostname}?tab=updates`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('locale', 'en'));
  await page.reload({ waitUntil: 'domcontentloaded' });

  await expect(page.getByText('Installed updates (3)')).toBeVisible();
  const row = (kb: string) => page.locator('tr', { has: page.getByText(kb, { exact: true }) }).first();
  await expect(row('KB5128646')).toContainText('Cumulative Update for Microsoft server operating system');
  await expect(row('KB5128646')).toContainText('Cumulative update');
  await expect(row('KB5128646')).toContainText('Succeeded');
  await expect(row('KB5099777')).toContainText('.NET');
  await expect(row('KB5099777')).toContainText('Failed');
  await expect(row('KB5099888')).toContainText('Installed');
});
