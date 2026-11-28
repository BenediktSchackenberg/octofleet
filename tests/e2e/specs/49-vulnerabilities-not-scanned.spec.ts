import { test, expect } from '@playwright/test';
import { API_URL, getAuthHeaders } from './helpers';

// A node whose release the scan cannot check (no advisory source, e.g. Arch Linux) must not look clean:
// its Vulnerabilities tab and tab label say so, and the Vulnerabilities page names such releases.
test('a node the scan cannot check says so instead of 0 CVEs', async ({ page, request }) => {
  const hostname = `e2e-arch-${Date.now()}`;
  const headers = { ...(await getAuthHeaders()), 'Content-Type': 'application/json' };
  expect((await request.post(`${API_URL}/api/v1/inventory/full`, { headers, data: {
    hostname, nodeId: hostname, system: { os: { name: 'Arch Linux', version: 'rolling' } },
  } })).ok()).toBeTruthy();
  await page.addInitScript(() => localStorage.setItem('locale', 'en'));

  await page.goto(`/nodes/${hostname}?tab=vulnerabilities`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('status').filter({ hasText: 'This node is not checked for vulnerabilities' })).toContainText('Arch Linux');
  await expect(page.getByRole('tab', { name: 'Vulnerabilities (-)' })).toBeVisible();
  await expect(page.getByText('No CVEs are stored for this node')).toHaveCount(0);

  await page.goto('/vulnerabilities', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('status').filter({ hasText: 'Not checked for vulnerabilities' })).toContainText(/Arch Linux rolling \(\d+ nodes?\)/);
});
