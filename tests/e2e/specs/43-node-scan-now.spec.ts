import { test, expect } from '@playwright/test';
import { API_URL, getAuthHeaders } from './helpers';

// Scan now on the node's Vulnerabilities tab scans only this node and shows the result. The node's
// one application is not checked (no OS: only Windows applications use NVD), so CI needs no network.
test('node page: Scan now scans the node and shows the result', async ({ page, request }) => {
  const hostname = `e2e-node-scan-${Date.now()}`;
  const response = await request.post(`${API_URL}/api/v1/inventory/full`, {
    headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
    data: { hostname, nodeId: hostname, software: { software: [{ name: `No Such App ${hostname}`, version: '1.0' }] } },
  });
  expect(response.ok()).toBeTruthy();

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('locale', 'en'));
  await page.goto(`/nodes/${hostname}?tab=vulnerabilities`, { waitUntil: 'domcontentloaded' });

  const scanNow = page.getByRole('button', { name: 'Scan now' });
  await expect(scanNow).toBeEnabled();
  await scanNow.click();
  await expect(page.getByText('Scan finished: 0 software versions checked.')).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/^Data from the scan of this node at /)).toBeVisible();
  await expect(scanNow).toBeEnabled();

  const scans = await request.get(`${API_URL}/api/v1/vulnerabilities/scans?node=${hostname}`, { headers: await getAuthHeaders() });
  expect(scans.ok()).toBeTruthy();
  expect((await scans.json()).scans).toHaveLength(1);
  await page.evaluate(() => localStorage.removeItem('locale'));
});
