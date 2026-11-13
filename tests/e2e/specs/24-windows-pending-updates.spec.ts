import { test, expect } from '@playwright/test';
import { API_URL, getAuthHeaders } from './helpers';

// Windows: the Updates tab lists the available updates and turns amber while one is pending - a
// Defender signature update alone (offered several times a day) does not count
test('Windows Updates tab: available updates and the pending highlight without Defender signatures', async ({ page, request }) => {
  const hostname = `e2e-win-pending-${Date.now()}`;
  const headers = { ...(await getAuthHeaders()), 'Content-Type': 'application/json' };
  expect((await request.post(`${API_URL}/api/v1/inventory/full`, {
    headers, data: { hostname, nodeId: hostname, system: { os: { name: 'Microsoft Windows Server 2025 Standard' } } },
  })).ok()).toBeTruthy();
  const scan = { status: 'succeeded', source: 'wsus', server: 'https://wsus.example:8531', result_code: 2 };
  const defender = { kb_id: 'KB2267602', title: 'Security Intelligence Update for Microsoft Defender Antivirus - KB2267602 (Version 1.463.277.0)', severity: 'low', category: 'security' };
  const report = (patches: object[]) => request.post(`${API_URL}/api/v1/patches/scan-results`, { headers, data: { node_id: hostname, scan, patches } });

  // Only a Defender signature update: listed, but the tab is not highlighted
  expect((await report([defender])).ok()).toBeTruthy();
  await page.goto(`/nodes/${hostname}?tab=updates`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('locale', 'en'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  const panel = page.getByRole('tabpanel');
  await expect(panel.getByText('Available updates (1)')).toBeVisible();
  await expect(panel.getByText('Defender signatures', { exact: true })).toBeVisible();
  const tab = page.getByRole('tab', { name: /Updates/ });
  await expect(tab).not.toHaveClass(/text-amber-500/);
  // The status line counts like the tab: none pending, the Defender update separately
  await expect(panel.getByText('Pending updates: 0')).toBeVisible();
  await expect(panel.getByText('+ 1 Defender signatures')).toBeVisible();

  // A cumulative update as well: the tab turns amber, counting only that one
  expect((await report([defender, { kb_id: 'KB5130001', title: '2026-11 Cumulative Update for Microsoft server operating system', severity: 'critical', category: 'security' }])).ok()).toBeTruthy();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(panel.getByText('Available updates (2)')).toBeVisible();
  await expect(tab).toHaveClass(/text-amber-500/);
  await expect(tab).toHaveAttribute('title', 'Pending updates: 1');
  await expect(panel.getByText('Pending updates: 1')).toBeVisible();
});
