import { test, expect } from '@playwright/test';
import { API_URL, getAuthHeaders } from './helpers';

// The jobs page: filter bar (search, status, type, time range) kept in the URL, cards counting jobs
// of the filters, translated texts
test('Jobs page: filters in the URL, job counts, translation', async ({ page, request }) => {
  const tag = `e2e-jobfilter-${Date.now()}`;
  const headers = { ...(await getAuthHeaders()), 'Content-Type': 'application/json' };
  expect((await request.post(`${API_URL}/api/v1/inventory/full`, {
    headers, data: { hostname: tag, nodeId: tag, system: { os: { name: 'Ubuntu 26.04 LTS' } } },
  })).ok()).toBeTruthy();
  const node = await (await request.get(`${API_URL}/api/v1/nodes/${tag}`, { headers })).json();
  const runJob = async (name: string, success: boolean | null, commandType = 'script') => {
    const created = await (await request.post(`${API_URL}/api/v1/jobs`, {
      headers, data: { name, targetType: 'device', targetId: node.id, commandType, commandData: { script: 'true' } },
    })).json();
    if (success === null) return;
    const detail = await (await request.get(`${API_URL}/api/v1/jobs/${created.id}`, { headers })).json();
    expect((await request.post(`${API_URL}/api/v1/jobs/instances/${detail.instances[0].id}/result`, {
      headers, data: { success, status: success ? 'success' : 'failed', exitCode: success ? 0 : 1, stdout: '', stderr: '' },
    })).ok()).toBeTruthy();
  };
  await runJob(`${tag} ok`, true);
  await runJob(`${tag} bad`, false);
  await runJob(`${tag} inventory`, null, 'inventory');

  // node filter: cards count this node's jobs of the last 7 days
  await page.goto(`/jobs?node=${tag}`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('locale', 'en'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('tbody tr')).toHaveCount(3);
  const card = (label: string) => page.locator('button', { has: page.getByText(label, { exact: true }) }).first();
  await expect(card('Jobs')).toContainText('3');
  await expect(card('Successful')).toContainText('1');
  await expect(card('Failed')).toContainText('1');

  // a card sets the status filter; status, type and search narrow the list and stay in the URL
  await card('Failed').click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody')).toContainText(`${tag} bad`);
  await expect(page).toHaveURL(/status=failed/);
  await page.getByLabel('Status').selectOption('');
  await page.getByLabel('Type').selectOption('inventory');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody')).toContainText(`${tag} inventory`);
  await page.getByLabel('Type').selectOption('');
  await page.getByLabel('Search by name').fill(`${tag} o`);
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page).toHaveURL(/q=/);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Search by name')).toHaveValue(`${tag} o`);
  await expect(page.locator('tbody tr')).toHaveCount(1);

  // German texts
  await page.evaluate(() => localStorage.setItem('locale', 'de'));
  await page.goto(`/jobs?node=${tag}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Fehlgeschlagen', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Neuer Job/ })).toBeVisible();
  await page.evaluate(() => localStorage.setItem('locale', 'en'));
});
