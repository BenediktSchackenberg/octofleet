import { test, expect } from '@playwright/test';
import { API_URL, getAuthHeaders } from './helpers';

// A failed Windows Update search keeps the node's update list and is shown on the Updates tab
test('a failed update search keeps the list and shows the error', async ({ page, request }) => {
  const hostname = `e2e-scan-${Date.now()}`;
  const headers = { ...(await getAuthHeaders()), 'Content-Type': 'application/json' };
  const node = await request.post(`${API_URL}/api/v1/inventory/full`, {
    headers, data: { hostname, nodeId: hostname, system: { os: { name: 'Microsoft Windows Server 2025 Standard' } } },
  });
  expect(node.ok()).toBeTruthy();

  const scan = (status: string, extra = {}) => ({ status, source: 'wsus', server: 'https://wsus.example:8531', result_code: 2, ...extra });
  const ok = await request.post(`${API_URL}/api/v1/patches/scan-results`, {
    headers, data: { node_id: hostname, scan: scan('succeeded'), patches: [{ kb_id: 'KB5099001', title: 'E2E Cumulative Update', severity: 'critical', category: 'security' }] },
  });
  expect(ok.ok()).toBeTruthy();
  const failed = await request.post(`${API_URL}/api/v1/patches/scan-results`, {
    headers, data: { node_id: hostname, scan: scan('failed', { result_code: null, error: '0x8024401C: WSUS not reachable' }), patches: [] },
  });
  expect(failed.ok()).toBeTruthy();

  // the update from the successful search is still there
  const explorer = await request.get(`${API_URL}/api/v1/patches/catalog?node=${hostname}`, { headers });
  expect((await explorer.json()).items.map((p: { kb_id: string }) => p.kb_id)).toContain('KB5099001');

  await page.goto(`/nodes/${hostname}?tab=updates`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('locale', 'en'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  const panel = page.getByRole('tabpanel');
  await expect(panel.getByText('Last update search:')).toBeVisible();
  await expect(panel.getByText('Failed', { exact: true })).toBeVisible();
  await expect(panel.getByText('via WSUS https://wsus.example:8531')).toBeVisible();
  await expect(panel.getByText('0x8024401C: WSUS not reachable')).toBeVisible();
  // The Updates tab shows that the last search failed
  const tab = page.getByRole('tab', { name: /Updates/ });
  await expect(tab).toHaveAttribute('title', 'The last update search failed');
  await expect(tab).toHaveClass(/text-red-500/);
});
