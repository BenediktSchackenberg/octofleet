import { test, expect } from '@playwright/test';
import { API_URL, getAuthHeaders } from './helpers';

// Fleet workspace: the node tree is on Fleet -> Nodes (not on the dashboard); a picked branch scopes
// the list, lives in the URL, and the tree stays next to a node's page
test('Fleet tree: a branch scopes the Nodes list, kept in the URL', async ({ page, request }) => {
  const tag = `e2etree${Date.now()}`;
  const release = `Linux ${tag}`;
  const headers = { ...(await getAuthHeaders()), 'Content-Type': 'application/json' };
  for (const hostname of [`${tag}-b`, `${tag}-a`]) {
    expect((await request.post(`${API_URL}/api/v1/inventory/full`, { headers,
      data: { hostname, nodeId: hostname, system: { os: { name: release } } } })).ok()).toBeTruthy();
  }

  // API: counts per release with the node IDs
  const api = await request.get(`${API_URL}/api/v1/nodes/tree?view=summary`, { headers });
  expect(api.ok()).toBeTruthy();
  const summary = await api.json();
  const linux = summary.unassigned.os.find((f: { family: string }) => f.family === 'Linux');
  const branch = linux.releases.find((r: { name: string }) => r.name === release);
  expect(branch.total).toBe(2);
  expect([...branch.node_ids].sort()).toEqual([`${tag}-a`, `${tag}-b`]);
  expect((await request.get(`${API_URL}/api/v1/nodes/tree?view=other`, { headers })).status()).toBe(422);

  // The dashboard carries no tree any more
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { localStorage.setItem('locale', 'en'); localStorage.setItem('octofleet-nodes-view', 'list'); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('navigation', { name: 'Fleet' })).toHaveCount(0);

  // Picking the release in the tree lists exactly its nodes; the branch is in the URL
  await page.goto('/nodes', { waitUntil: 'domcontentloaded' });
  const tree = page.getByRole('navigation', { name: 'Fleet' });
  await expect(tree.getByRole('button', { name: 'All nodes' })).toBeVisible();
  // the label picks a row and opens it; "Not in a group" is open by default
  await tree.getByRole('button', { name: /^Not in a group/ }).click();
  await expect(page).toHaveURL(/group=unassigned/);
  await tree.getByRole('button', { name: /^Linux\s*\d/ }).last().click();
  await tree.getByRole('button', { name: new RegExp(`^${release}`) }).click();
  await expect(page).toHaveURL(/group=unassigned&os=Linux&release=/);
  const names = page.locator('tbody tr td:nth-child(2) a');
  await expect(names).toHaveText([`${tag}-a`, `${tag}-b`]);
  await expect(page.getByRole('heading', { name: `Not in a group › Linux › ${release}` })).toBeVisible();

  // A node's page keeps the tree; Back returns to the same branch
  await names.first().click();
  await expect(page).toHaveURL(new RegExp(`/nodes/${tag}-a`));
  await expect(page.getByRole('navigation', { name: 'Fleet' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/release=/);
  await expect(names).toHaveText([`${tag}-a`, `${tag}-b`]);

  // The chip clears the branch (a history entry: Back brings it back)
  await page.getByRole('button', { name: 'Show all nodes' }).click();
  await expect(page).not.toHaveURL(/group=/);
  await page.goBack();
  await expect(page).toHaveURL(/group=unassigned/);
  await expect(names).toHaveText([`${tag}-a`, `${tag}-b`]);
});
