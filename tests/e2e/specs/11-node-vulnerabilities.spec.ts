import { test, expect } from '@playwright/test';
import { API_URL, getAuthHeaders } from './helpers';

// The node page has a Vulnerabilities tab that ?tab=vulnerabilities opens directly, and the
// Security tab's button switches to it. CI has no scan data, so the list is empty here.
test('node page: Vulnerabilities tab, direct link and button in the Security tab', async ({ page, request }) => {
  const hostname = `e2e-node-vulns-${Date.now()}`;
  const response = await request.post(`${API_URL}/api/v1/inventory/full`, {
    headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
    data: { hostname, nodeId: hostname, hardware: { cpu: { name: 'Test CPU', cores: 2 }, ram: { totalGB: 4 } } },
  });
  expect(response.ok()).toBeTruthy();

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('locale', 'en'));

  await page.goto(`/nodes/${hostname}?tab=vulnerabilities`, { waitUntil: 'domcontentloaded' });
  const tab = page.getByRole('tab', { name: /^Vulnerabilities \(0\)$/ });
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('No known vulnerabilities for the installed software.')).toBeVisible();

  await page.getByRole('tab', { name: 'Sicherheit' }).click();
  await page.getByRole('button', { name: 'Show vulnerabilities' }).click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await page.evaluate(() => localStorage.removeItem('locale'));
});
