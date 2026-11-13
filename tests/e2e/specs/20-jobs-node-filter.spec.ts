import { test, expect } from '@playwright/test';
import { API_URL, getAuthHeaders } from './helpers';

// The node page's "Jobs" count and link cover that node; "Start job" preselects the node
test('jobs page filtered by node, node count, and Start job preselects the node', async ({ page, request }) => {
  const hostname = `e2e-jobs-${Date.now()}`;
  const headers = { ...(await getAuthHeaders()), 'Content-Type': 'application/json' };
  expect((await request.post(`${API_URL}/api/v1/inventory/full`, {
    headers, data: { hostname, nodeId: hostname, system: { os: { name: 'Microsoft Windows Server 2025 Standard' } } },
  })).ok()).toBeTruthy();
  const node = await (await request.get(`${API_URL}/api/v1/nodes/${hostname}`, { headers })).json();
  for (const name of ['e2e job one', 'e2e job two']) {
    expect((await request.post(`${API_URL}/api/v1/jobs`, {
      headers, data: { name, targetType: 'device', targetId: node.id, commandType: 'script', commandData: { script: 'true' } },
    })).ok()).toBeTruthy();
  }

  await page.goto(`/nodes/${hostname}`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('locale', 'en'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  const jobsLink = page.locator(`a[href="/jobs?node=${hostname}&range=all"]`);
  await expect(jobsLink).toContainText('2');

  await jobsLink.click();
  await expect(page.getByText(`Jobs for ${hostname}`)).toBeVisible();
  await expect(page.getByText('e2e job one')).toBeVisible();
  await expect(page.getByText('e2e job two')).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(2);

  await page.goto(`/jobs?target=${hostname}`, { waitUntil: 'domcontentloaded' });
  const deviceSelect = page.locator('select').filter({ has: page.locator(`option[value="${node.id}"]`) });
  await expect(deviceSelect).toHaveValue(node.id);
});
