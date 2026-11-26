import { test, expect } from '@playwright/test';
import { API_URL, getAuthHeaders } from './helpers';

// Dashboard: the first row answers "is my fleet safe and current?" - Critical threats (critical and
// high as rows, each to the nodes with such CVEs) and Updates (nodes up to date, rows to the Fleet
// updates page with that filter). The card header links share one style.
test('Dashboard: Updates card and Critical threats rows link to the filtered pages', async ({ page, request }) => {
  const headers = await getAuthHeaders();
  const summary = await (await request.get(`${API_URL}/api/v1/patches/fleet/summary`, { headers })).json();

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('locale', 'en'));
  await page.reload({ waitUntil: 'domcontentloaded' });

  // Updates: up to date out of all nodes, the rows with the page's filters
  await expect(page.getByText('nodes up to date')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Show updates →' })).toHaveAttribute('href', '/patches/updates');
  const pending = page.locator('a[href="/patches/updates?pending=1"]');
  await expect(pending).toContainText('Pending updates');
  await expect(pending).toContainText(String(summary.pending));
  await expect(page.locator('a[href="/patches/updates?security=1"]')).toContainText('Security updates');
  await expect(page.locator('a[href="/patches/updates?reboot=1"]')).toContainText('Reboot needed');

  // Critical threats: the link top right, critical and high as rows to the filtered node list
  await expect(page.getByRole('link', { name: 'Show vulnerabilities →' })).toHaveAttribute('href', '/vulnerabilities');
  await expect(page.locator('a[href="/vulnerabilities?tab=nodes&severity=critical"]')).toContainText('Critical');
  await expect(page.locator('a[href="/vulnerabilities?tab=nodes&severity=high"]')).toContainText('High risk');
  await expect(page.getByText('View security reports →')).toHaveCount(0);

  // the first row: Critical threats and Updates before Fleet status
  const top = async (name: string) => (await page.getByRole('link', { name }).first().boundingBox())!.y;
  expect(await top('Show vulnerabilities →')).toBeLessThan(await top('Show nodes →'));
  expect(await top('Show updates →')).toBeLessThan(await top('Show nodes →'));

  // one style for the header links
  const classes = await Promise.all(['Show updates →', 'Show nodes →', 'Show jobs →', 'Detailed analytics →']
    .map((name) => page.getByRole('link', { name }).first().getAttribute('class')));
  expect(new Set(classes).size).toBe(1);

  await pending.click();
  await expect(page).toHaveURL(/\/patches\/updates\?pending=1/);
});

test('Vulnerabilities: ?severity=high lists only nodes with high CVEs; the chip clears it', async ({ page, request }) => {
  const headers = await getAuthHeaders();
  const high = await (await request.get(`${API_URL}/api/v1/vulnerabilities/by-node?severity=high`, { headers })).json();

  await page.goto('/vulnerabilities?tab=nodes&severity=high', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('locale', 'en'));
  await page.reload({ waitUntil: 'domcontentloaded' });

  const chip = page.getByRole('button', { name: /Only nodes with High CVEs/ });
  await expect(chip).toBeVisible();
  for (const node of high.nodes.slice(0, 3)) await expect(page.getByText(node.hostname).first()).toBeVisible();

  await chip.click();
  await expect(chip).toHaveCount(0);
  await expect(page).not.toHaveURL(/severity=/);
  await expect(page).toHaveURL(/tab=nodes/);
});
