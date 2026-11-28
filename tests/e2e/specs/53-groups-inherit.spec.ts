import { test, expect } from '@playwright/test';
import { API_URL, getAuthHeaders } from './helpers';

// A parent group lists the nodes of its sub-groups ("Via ..."), only its own members can be removed
// there, and a group on the third level offers no further sub-group.
test('groups: a parent shows its sub-groups\' nodes; three levels at most', async ({ page, request }) => {
  const prefix = `e2e-ginh-${Date.now()}`;
  const headers = { ...(await getAuthHeaders()), 'Content-Type': 'application/json' };
  expect((await request.post(`${API_URL}/api/v1/inventory/full`, { headers, data: { hostname: `${prefix}-1`, nodeId: `${prefix}-1`, hardware: { cpu: { name: 'Test CPU', cores: 2 } } } })).ok()).toBeTruthy();
  const post = async (name: string, parentId?: string) =>
    (await (await request.post(`${API_URL}/api/v1/groups`, { headers, data: { name, ...(parentId ? { parentId } : {}) } })).json()).group.id as string;
  const top = await post(`${prefix}-servers`);
  const mid = await post(`${prefix}-linux`, top);
  const leaf = await post(`${prefix}-web`, mid);
  await request.post(`${API_URL}/api/v1/groups/${leaf}/members`, { headers, data: { nodeIds: [`${prefix}-1`] } });
  try {
    await page.addInitScript(() => localStorage.setItem('locale', 'en'));
    await page.goto(`/groups/${top}`, { waitUntil: 'domcontentloaded' });
    const row = page.getByRole('row', { name: new RegExp(`${prefix}-1`) });
    await expect(row).toContainText(`Via ${prefix}-web`);
    await expect(row.getByRole('button', { name: 'Remove' })).toHaveCount(0);

    await page.goto(`/groups/${leaf}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('row', { name: new RegExp(`${prefix}-1`) })).toContainText('Direct');
    await expect(page.getByRole('button', { name: /Add sub-group/ })).toBeDisabled();
    await page.evaluate(() => localStorage.removeItem('locale'));
  } finally {
    for (const id of [leaf, mid, top]) await request.delete(`${API_URL}/api/v1/groups/${id}?confirm=true`, { headers });
  }
});
