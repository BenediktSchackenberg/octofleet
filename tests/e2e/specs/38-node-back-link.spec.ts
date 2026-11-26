import { test, expect } from '@playwright/test';
import { API_URL, getAuthHeaders } from './helpers';

// The node page links back to the Nodes list the user came from - with its branch of the Fleet tree,
// not just "Nodes" - and to all nodes when it was opened directly.
test('node page: back link to the list the user came from', async ({ page, request }) => {
  const hostname = `e2e-back-${Date.now()}`;
  const headers = { ...(await getAuthHeaders()), 'Content-Type': 'application/json' };
  expect((await request.post(`${API_URL}/api/v1/inventory/full`, { headers, data: {
    hostname, nodeId: hostname, system: { os: { name: 'Ubuntu 26.04 LTS' } } } })).ok()).toBeTruthy();

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { localStorage.setItem('locale', 'en'); localStorage.setItem('octofleet-nodes-view', 'list'); });

  // opened directly: back to all nodes
  await page.goto(`/nodes/${hostname}`, { waitUntil: 'domcontentloaded' });
  const back = page.getByRole('link', { name: 'All nodes' }).filter({ has: page.locator('svg.lucide-arrow-left') });
  await expect(back).toHaveAttribute('href', '/nodes');

  // from the "Not in a group" branch: back to that branch
  await page.goto(`/nodes?group=unassigned`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Not in a group' })).toBeVisible();
  await page.getByPlaceholder('Search...').fill(hostname);
  await page.locator('tbody tr td:nth-child(2) a', { hasText: hostname }).click();
  await expect(page).toHaveURL(new RegExp(`/nodes/${hostname}`));
  const backToBranch = page.getByRole('link', { name: 'Not in a group' }).filter({ has: page.locator('svg.lucide-arrow-left') });
  await expect(backToBranch).toHaveAttribute('href', '/nodes?group=unassigned');
  await backToBranch.click();
  await expect(page).toHaveURL(/\/nodes\?group=unassigned$/);
  await expect(page.getByRole('heading', { name: 'Not in a group' })).toBeVisible();
});
