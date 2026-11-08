import { test, expect } from '@playwright/test';
import { API_URL, getAuthHeaders } from './helpers';

// The open tab is kept in the URL: a reload opens the same tab, the first tab needs no parameter.
test('node page: the open tab survives a reload', async ({ page, request }) => {
  const hostname = `e2e-tabs-${Date.now()}`;
  const response = await request.post(`${API_URL}/api/v1/inventory/full`, {
    headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
    data: { hostname, nodeId: hostname, hardware: { cpu: { name: 'Test CPU', cores: 2 }, ram: { totalGB: 4 } } },
  });
  expect(response.ok()).toBeTruthy();

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('locale', 'en'));
  await page.goto(`/nodes/${hostname}`, { waitUntil: 'domcontentloaded' });

  const hardware = page.getByRole('tab', { name: 'Hardware' });
  await hardware.click();
  await expect(hardware).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/[?&]tab=hardware/);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('tab', { name: 'Hardware' })).toHaveAttribute('aria-selected', 'true');

  // back to the first tab: the parameter is removed again
  await page.getByRole('tab', { name: 'Overview' }).click();
  await expect(page).not.toHaveURL(/[?&]tab=/);
  await page.evaluate(() => localStorage.removeItem('locale'));
});
