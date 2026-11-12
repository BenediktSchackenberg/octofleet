import { test, expect } from '@playwright/test';
import { API_URL, getAuthHeaders } from './helpers';

// "Collect inventory" on the node page asks the agent for a fresh inventory (an `inventory` job)
// and waits for it, instead of only reloading the stored data.
test('Collect inventory creates an inventory job for the node and waits for the agent', async ({ page, request }) => {
  const hostname = `e2e-collect-${Date.now()}`;
  const headers = { ...(await getAuthHeaders()), 'Content-Type': 'application/json' };
  const pushed = await request.post(`${API_URL}/api/v1/inventory/full`, {
    headers,
    data: { hostname, nodeId: hostname, system: { os: { name: 'Microsoft Windows Server 2025 Standard' } } },
  });
  expect(pushed.ok()).toBeTruthy();

  await page.goto(`/nodes/${hostname}`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('locale', 'en'));
  await page.reload({ waitUntil: 'domcontentloaded' });

  const button = page.getByRole('button', { name: /Collect inventory/ });
  await expect(button).toBeEnabled();
  await button.click();
  // No agent answers in the test: the button waits for it
  await expect(page.getByRole('button', { name: /Waiting for the agent/ })).toBeDisabled();

  const jobs = await request.get(`${API_URL}/api/v1/jobs?limit=20`, { headers });
  expect(jobs.ok()).toBeTruthy();
  const job = (await jobs.json()).jobs.find((j: { target_name: string; command_type: string }) =>
    j.target_name === hostname && j.command_type === 'inventory');
  expect(job).toBeTruthy();
});
