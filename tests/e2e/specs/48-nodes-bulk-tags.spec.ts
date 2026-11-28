import { test, expect } from '@playwright/test';
import { API_URL, getAuthHeaders } from './helpers';

// Nodes list: select the nodes a search shows, tag them (a new tag) and add them to a group in one
// action each; the Groups page manages the tag (rename, delete with where it is used).
test('bulk: tag and group the shown nodes, then rename and delete the tag', async ({ page, request }) => {
  const prefix = `e2e-bulk-${Date.now()}`;
  const headers = { ...(await getAuthHeaders()), 'Content-Type': 'application/json' };
  for (const n of [1, 2]) {
    expect((await request.post(`${API_URL}/api/v1/inventory/full`, { headers, data: {
      hostname: `${prefix}-${n}`, nodeId: `${prefix}-${n}`, hardware: { cpu: { name: 'Test CPU', cores: 2 } },
    } })).ok()).toBeTruthy();
  }
  const group = await (await request.post(`${API_URL}/api/v1/groups`, { headers, data: { name: `${prefix}-group` } })).json();
  const tagName = `${prefix}-tag`;

  await page.addInitScript(() => { localStorage.setItem('locale', 'en'); localStorage.setItem('octofleet-nodes-view', 'list'); });
  await page.goto('/nodes', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('Search...').fill(prefix);
  await expect(page.getByRole('link', { name: `${prefix}-1` })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Select all 2 shown nodes' }).check();
  const bar = page.getByRole('region', { name: 'Bulk actions' });
  await expect(bar.getByText('All 2 shown nodes selected')).toBeVisible();

  // a new tag for both, in one action; the button says how many nodes it reaches
  await bar.getByRole('button', { name: 'Add tag' }).click();
  await page.getByRole('textbox', { name: 'or a new tag' }).fill(tagName);
  // a favourite colour, one click
  await page.getByRole('radio', { name: '#22c55e' }).click();
  await page.getByRole('button', { name: `Tag 2 nodes with ${tagName}` }).click();
  await expect(bar.getByRole('status')).toContainText('2 added');
  await expect(page.getByRole('row', { name: new RegExp(`${prefix}-2`) }).getByText(tagName)).toBeVisible();
  const tags = await (await request.get(`${API_URL}/api/v1/tags`, { headers })).json();
  expect(tags.tags.find((x: { name: string }) => x.name === tagName).color).toBe('#22c55e');

  // both into the group
  await bar.getByRole('button', { name: 'Add to group' }).click();
  await page.getByRole('combobox', { name: 'Group' }).selectOption({ label: `${prefix}-group` });
  await page.getByRole('button', { name: `Add 2 nodes to ${prefix}-group` }).click();
  await expect(bar.getByRole('status')).toContainText('2 added');
  const members = await (await request.get(`${API_URL}/api/v1/groups/${group.group.id}`, { headers })).json();
  expect(members.members.map((m: { hostname: string }) => m.hostname).sort()).toEqual([`${prefix}-1`, `${prefix}-2`]);

  // the tag on the Groups page: where it is used, rename, open its nodes, delete
  await page.goto('/groups', { waitUntil: 'domcontentloaded' });
  const row = page.getByRole('row', { name: new RegExp(tagName) });
  await expect(row.getByRole('cell').nth(1)).toHaveText('2');
  await row.getByRole('button', { name: `Edit ${tagName}` }).click();
  await page.getByRole('textbox', { name: 'Tag' }).fill(`${tagName}-renamed`);
  await expect(page.getByRole('radio', { name: '#22c55e' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: '#a855f7' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  const renamed = page.getByRole('row', { name: new RegExp(`${tagName}-renamed`) });
  await expect(renamed).toBeVisible();
  const after = await (await request.get(`${API_URL}/api/v1/tags`, { headers })).json();
  expect(after.tags.find((x: { name: string }) => x.name === `${tagName}-renamed`).color).toBe('#a855f7');
  await renamed.getByRole('link', { name: '2' }).click();
  await expect(page).toHaveURL(new RegExp(`/nodes\\?tag=${tagName}-renamed`));
  await expect(page.getByRole('link', { name: `${prefix}-1` })).toBeVisible();

  await page.goto('/groups', { waitUntil: 'domcontentloaded' });
  page.once('dialog', (d) => { expect(d.message()).toContain('2 nodes'); d.accept(); });
  await page.getByRole('row', { name: new RegExp(`${tagName}-renamed`) }).getByRole('button', { name: `Delete ${tagName}-renamed` }).click();
  await expect(page.getByRole('row', { name: new RegExp(`${tagName}-renamed`) })).toHaveCount(0);
  await page.evaluate(() => { localStorage.removeItem('locale'); localStorage.removeItem('octofleet-nodes-view'); });
});
