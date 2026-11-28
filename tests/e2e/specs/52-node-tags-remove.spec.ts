import { test, expect } from '@playwright/test';
import { API_URL, getAuthHeaders } from './helpers';

// Manage tags on a node page: the cross on a current tag removes it (it sent no tag id and the
// server answered 422, so the tag stayed).
test('node page: a tag is removed with its cross', async ({ page, request }) => {
  const name = `e2e-tagrm-${Date.now()}`;
  const headers = { ...(await getAuthHeaders()), 'Content-Type': 'application/json' };
  expect((await request.post(`${API_URL}/api/v1/inventory/full`, { headers, data: { hostname: name, nodeId: name, hardware: { cpu: { name: 'Test CPU', cores: 2 } } } })).ok()).toBeTruthy();
  const tag = (await (await request.post(`${API_URL}/api/v1/tags`, { headers, data: { name, color: '#ef4444' } })).json()).tag;
  expect((await request.post(`${API_URL}/api/v1/devices/${name}/tags`, { headers, data: { tagIds: [tag.id] } })).ok()).toBeTruthy();
  const tagsOf = async () => ((await (await request.get(`${API_URL}/api/v1/devices/${name}/tags`, { headers })).json()).tags as Array<{ id: string }>).map((t) => t.id);
  expect(await tagsOf()).toContain(tag.id);

  try {
    await page.addInitScript(() => localStorage.setItem('locale', 'en'));
    await page.goto(`/nodes/${name}`, { waitUntil: 'domcontentloaded' });
    // a button on the node page, or an item of its "More actions" menu (node page in the style guide)
    await page.getByRole('button', { name: /Manage tags|More actions/i }).first().waitFor();
    const button = page.getByRole('button', { name: 'Manage tags' });
    if (await button.count()) await button.first().click();
    else {
      await page.getByRole('button', { name: /More actions/i }).click();
      await page.getByRole('menuitem', { name: 'Manage tags' }).click();
    }
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: `Remove ${name}` }).click();
    await expect.poll(tagsOf).not.toContain(tag.id);
    await expect(dialog.getByRole('button', { name: `Remove ${name}` })).toHaveCount(0);
    await page.evaluate(() => localStorage.removeItem('locale'));
  } finally {
    await request.delete(`${API_URL}/api/v1/tags/${tag.id}`, { headers });
  }
});
