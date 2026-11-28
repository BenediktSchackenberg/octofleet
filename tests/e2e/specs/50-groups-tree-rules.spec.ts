import { test, expect } from '@playwright/test';
import { API_URL, getAuthHeaders } from './helpers';

// Groups: a dynamic group made in the UI (rule builder with a live preview) gets its members at once;
// a sub-group is added from the group page and shown in the tree and the breadcrumb; editing works.
test('groups: dynamic group with a rule, sub-group, tree and edit', async ({ page, request }) => {
  const prefix = `e2e-gtree-${Date.now()}`;
  const headers = { ...(await getAuthHeaders()), 'Content-Type': 'application/json' };
  for (const n of [1, 2]) {
    expect((await request.post(`${API_URL}/api/v1/inventory/full`, { headers, data: { hostname: `${prefix}-${n}`, nodeId: `${prefix}-${n}`, hardware: { cpu: { name: 'Test CPU', cores: 2 } } } })).ok()).toBeTruthy();
  }
  await page.addInitScript(() => localStorage.setItem('locale', 'en'));
  await page.goto('/groups', { waitUntil: 'domcontentloaded' });

  // a dynamic group: the rule says which nodes, the preview shows them before saving
  await page.getByRole('button', { name: 'Create group' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Name' }).fill(`${prefix}-ring`);
  await dialog.getByRole('radio', { name: 'Dynamic' }).check();
  await dialog.getByRole('combobox', { name: 'Field of condition 1' }).selectOption('hostname');
  await dialog.getByRole('combobox', { name: 'Operator of condition 1' }).selectOption('startswith');
  await dialog.getByRole('textbox', { name: 'Value of condition 1' }).fill(prefix);
  await expect(dialog.getByRole('status')).toContainText('Matches 2 of');
  await dialog.getByRole('button', { name: 'Create group' }).click();

  // the group page: members at once, the rule, a sub-group
  await expect(page.getByRole('status').filter({ hasText: 'Group created with 2 nodes' })).toBeVisible();
  await expect(page.getByRole('link', { name: `${prefix}-1` })).toBeVisible();
  await page.getByRole('button', { name: 'Add sub-group' }).click();
  await page.getByRole('dialog').getByRole('textbox', { name: 'Name' }).fill(`${prefix}-pilot`);
  await page.getByRole('dialog').getByRole('button', { name: 'Create group' }).click();
  await expect(page.getByRole('navigation', { name: 'Parent groups' })).toContainText(`${prefix}-ring`);

  // editing (it sent PATCH before, which the API does not have)
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('dialog').getByRole('textbox', { name: 'Description' }).fill('pilot nodes');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('pilot nodes')).toBeVisible();

  // the tree: the sub-group under its parent
  await page.goto('/groups', { waitUntil: 'domcontentloaded' });
  const parentRow = page.getByRole('row', { name: new RegExp(`${prefix}-ring`) });
  await expect(parentRow).toContainText('1 sub-groups');
  await expect(page.getByRole('row', { name: new RegExp(`${prefix}-pilot`) })).toBeVisible();
  await parentRow.getByRole('button', { name: `Collapse ${prefix}-ring` }).click();
  await expect(page.getByRole('row', { name: new RegExp(`${prefix}-pilot`) })).toHaveCount(0);
  await page.evaluate(() => localStorage.removeItem('locale'));
});
