import { test, expect } from '@playwright/test';
import { API_URL, getAuthHeaders } from './helpers';

// Nodes list: a stable order by hostname (case-insensitive) whatever reported last - it was by last
// contact and changed on every reload; a picked sort is kept in the URL and Back returns to the previous one
test('Nodes list: stable order by name, sort in the URL', async ({ page, request }) => {
  const tag = `e2e-order-${Date.now()}`;
  const headers = { ...(await getAuthHeaders()), 'Content-Type': 'application/json' };
  // reported in this order: by last contact the list would start with -b
  for (const hostname of [`${tag}-c`, `${tag}-A`, `${tag}-b`]) {
    expect((await request.post(`${API_URL}/api/v1/inventory/full`, { headers,
      data: { hostname, nodeId: hostname, system: { os: { name: 'Ubuntu 26.04 LTS' } } } })).ok()).toBeTruthy();
  }
  const api = await request.get(`${API_URL}/api/v1/nodes`, { headers });
  const listed = ((await api.json()).nodes as { hostname: string }[]).map((n) => n.hostname).filter((h) => h.startsWith(tag));
  expect(listed).toEqual([`${tag}-A`, `${tag}-b`, `${tag}-c`]);

  await page.goto('/nodes', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { localStorage.setItem('locale', 'en'); localStorage.setItem('octofleet-nodes-view', 'list'); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('Search...').fill(tag);
  const names = page.locator('tbody tr td a[href^="/nodes/"]');
  await expect(names).toHaveText([`${tag}-A`, `${tag}-b`, `${tag}-c`]);

  // The name column again: descending, in the URL, kept on reload
  await page.getByRole('button', { name: 'Hostname' }).click();
  await expect(page).toHaveURL(/dir=desc/);
  await expect(names).toHaveText([`${tag}-c`, `${tag}-b`, `${tag}-A`]);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('Search...').fill(tag);
  await expect(names).toHaveText([`${tag}-c`, `${tag}-b`, `${tag}-A`]);

  // Back returns to the default order
  await page.goBack();
  await expect(page).not.toHaveURL(/dir=desc/);
  await page.getByPlaceholder('Search...').fill(tag);
  await expect(names).toHaveText([`${tag}-A`, `${tag}-b`, `${tag}-c`]);
});
