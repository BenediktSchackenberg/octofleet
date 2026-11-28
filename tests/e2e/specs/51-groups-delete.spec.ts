import { test, expect } from '@playwright/test';
import { API_URL, getAuthHeaders } from './helpers';

// Deleting a group that is used: the dialog lists what uses it and what the delete does, the delete
// needs "Delete and clean up", and the nodes stay. An unused group is deleted after a plain confirmation.
test('groups: delete warns about what uses the group, then cleans up', async ({ page, request }) => {
  const prefix = `e2e-gdel-${Date.now()}`;
  const headers = { ...(await getAuthHeaders()), 'Content-Type': 'application/json' };
  expect((await request.post(`${API_URL}/api/v1/inventory/full`, { headers, data: { hostname: `${prefix}-1`, nodeId: `${prefix}-1`, hardware: { cpu: { name: 'Test CPU', cores: 2 } } } })).ok()).toBeTruthy();
  const nodes = (await (await request.get(`${API_URL}/api/v1/nodes`, { headers })).json()).nodes as Array<{ id: string; hostname: string }>;
  const node = nodes.find((n) => n.hostname === `${prefix}-1`)!;
  const used = (await (await request.post(`${API_URL}/api/v1/groups`, { headers, data: { name: `${prefix}-used` } })).json()).group.id;
  await request.post(`${API_URL}/api/v1/groups/${used}/members`, { headers, data: { nodeIds: [node.id] } });
  await request.post(`${API_URL}/api/v1/groups`, { headers, data: { name: `${prefix}-child`, parentId: used } });
  const empty = (await (await request.post(`${API_URL}/api/v1/groups`, { headers, data: { name: `${prefix}-empty` } })).json()).group.id;

  await page.addInitScript(() => localStorage.setItem('locale', 'en'));

  // a used group: the uses and their effects, "Delete and clean up"
  await page.goto(`/groups/${used}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Delete' }).first().click();
  const dialog = page.getByRole('dialog');
  const uses = dialog.getByRole('list', { name: 'What uses the group' });
  await expect(uses).toContainText('Member nodes: 1');
  await expect(uses).toContainText('removed from the group; the nodes stay');
  await expect(uses).toContainText('Sub-groups: 1');
  await expect(uses).toContainText(`${prefix}-child`);
  await dialog.getByRole('button', { name: 'Delete and clean up' }).click();
  await expect(page).toHaveURL(/\/groups$/);
  await expect(page.getByRole('status').filter({ hasText: `Group "${prefix}-used" deleted.` })).toBeVisible();
  expect((await request.get(`${API_URL}/api/v1/groups/${used}`, { headers })).status()).toBe(404);
  const after = (await (await request.get(`${API_URL}/api/v1/nodes`, { headers })).json()).nodes as Array<{ hostname: string }>;
  expect(after.some((n) => n.hostname === `${prefix}-1`)).toBeTruthy();

  // an unused group: a plain confirmation
  await page.goto(`/groups/${empty}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Delete' }).first().click();
  await expect(page.getByRole('dialog')).toContainText('Nothing uses this group');
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page).toHaveURL(/\/groups$/);
  expect((await request.get(`${API_URL}/api/v1/groups/${empty}`, { headers })).status()).toBe(404);
  await page.evaluate(() => localStorage.removeItem('locale'));
});

// Thousands of groups and tags: each list searches and shows 50 a page
test('groups and tags: search and pages of 50', async ({ page, request }) => {
  const prefix = `e2e-gpage-${Date.now()}`;
  const headers = { ...(await getAuthHeaders()), 'Content-Type': 'application/json' };
  const groups: string[] = [];
  const tags: string[] = [];
  for (let i = 0; i < 55; i++) {
    groups.push((await (await request.post(`${API_URL}/api/v1/groups`, { headers, data: { name: `${prefix}-g${String(i).padStart(2, '0')}` } })).json()).group.id);
  }
  for (let i = 0; i < 52; i++) {
    tags.push((await (await request.post(`${API_URL}/api/v1/tags`, { headers, data: { name: `${prefix}-t${String(i).padStart(2, '0')}` } })).json()).tag.id);
  }
  try {
    await page.addInitScript(() => localStorage.setItem('locale', 'en'));
    await page.goto('/groups', { waitUntil: 'domcontentloaded' });

    await page.getByRole('searchbox', { name: 'Search groups' }).fill(prefix);
    await expect(page.getByText('1-50 of 55')).toBeVisible();
    await expect(page.getByRole('link', { name: `${prefix}-g49` })).toBeVisible();
    await expect(page.getByRole('link', { name: `${prefix}-g50` })).toHaveCount(0);
    await page.getByText('1-50 of 55').locator('..').getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('51-55 of 55')).toBeVisible();
    await expect(page.getByRole('link', { name: `${prefix}-g54` })).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search groups' }).fill(`${prefix}-g07`);
    await expect(page.getByRole('link', { name: `${prefix}-g07` })).toBeVisible();
    await expect(page.getByText('of 55')).toHaveCount(0);

    await page.getByRole('searchbox', { name: 'Search tags' }).fill(prefix);
    await expect(page.getByText('1-50 of 52')).toBeVisible();
    await page.getByText('1-50 of 52').locator('..').getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('51-52 of 52')).toBeVisible();
    await expect(page.getByRole('cell', { name: `${prefix}-t51`, exact: true })).toBeVisible();
    await page.evaluate(() => localStorage.removeItem('locale'));
  } finally {
    for (const id of groups) await request.delete(`${API_URL}/api/v1/groups/${id}?confirm=true`, { headers });
    for (const id of tags) await request.delete(`${API_URL}/api/v1/tags/${id}`, { headers });
  }
});
