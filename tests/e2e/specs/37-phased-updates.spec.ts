import { test, expect } from '@playwright/test';
import { API_URL, getAuthHeaders } from './helpers';

// Ubuntu phased updates: apt holds them back on a node until its turn comes. The Updates tab marks them
// ("Phased (10 %)"), does not count them as pending, and leaves them out of "Select all" and the install
// dialog - so nobody tries to install them again and again.
test('Linux updates: phased updates are marked, not pending and not selectable', async ({ page, request }) => {
  const hostname = `e2e-linux-phased-${Date.now()}`;
  const headers = { ...(await getAuthHeaders()), 'Content-Type': 'application/json' };
  expect((await request.post(`${API_URL}/api/v1/inventory/full`, { headers, data: {
    hostname, nodeId: hostname, system: { os: { name: 'Ubuntu 26.04 LTS' } },
    updates: { packageManager: 'apt', totalUpdates: 2, securityUpdates: 0, phasedUpdates: 1, rebootRequired: false, updates: [
      { name: 'libsqlite3-0', newVersion: '3.46.1-9ubuntu0.4', repository: 'resolute-updates', security: false,
        phased: true, phasedPercent: 10 },
      { name: 'fwupd', newVersion: '2.1.6-3ubuntu4~26.04.1', repository: 'resolute-updates', security: false },
    ] } } })).ok()).toBeTruthy();

  await page.goto(`/nodes/${hostname}?tab=updates`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('locale', 'en'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  const row = (name: string) => page.getByRole('row').filter({ hasText: name });

  await expect(row('libsqlite3-0')).toContainText('Phased (10 %)');
  await expect(row('fwupd')).not.toContainText('Phased');
  await expect(page.getByText(/1 phased update\(s\)/)).toBeVisible();
  // the tab counts only the update that can be installed
  await expect(page.getByRole('tab', { name: /Updates \(1\)/ })).toBeVisible();

  // the phased one cannot be ticked; "Select all" ticks only the other
  await expect(row('libsqlite3-0').getByRole('checkbox')).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Select all updates' }).click();
  await expect(row('fwupd').getByRole('checkbox')).toBeChecked();
  await expect(row('libsqlite3-0').getByRole('checkbox')).not.toBeChecked();
  await expect(page.getByRole('button', { name: /Install selected \(1\)/ })).toBeVisible();

  // Patches -> Fleet updates counts the same: 1 pending, the phased one only as a hint
  const fleet = await (await request.get(`${API_URL}/api/v1/patches/fleet?q=${hostname}`, { headers })).json();
  expect(fleet.nodes[0]).toMatchObject({ pending: 1, phased: 1 });
  await page.goto(`/patches/updates?q=${hostname}`, { waitUntil: 'domcontentloaded' });
  const fleetRow = page.getByRole('row').filter({ hasText: hostname });
  await expect(fleetRow).toContainText('1 phased (not counted)');
});

test('Linux updates: only phased updates pending - nothing to install', async ({ page, request }) => {
  const hostname = `e2e-linux-phased-only-${Date.now()}`;
  const headers = { ...(await getAuthHeaders()), 'Content-Type': 'application/json' };
  expect((await request.post(`${API_URL}/api/v1/inventory/full`, { headers, data: {
    hostname, nodeId: hostname, system: { os: { name: 'Ubuntu 26.04 LTS' } },
    updates: { packageManager: 'apt', totalUpdates: 1, securityUpdates: 0, phasedUpdates: 1, rebootRequired: false, updates: [
      { name: 'libsqlite3-0', newVersion: '3.46.1-9ubuntu0.4', repository: 'resolute-updates', security: false,
        phased: true, phasedPercent: null },
    ] } } })).ok()).toBeTruthy();

  await page.goto(`/nodes/${hostname}?tab=updates`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('locale', 'en'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('row').filter({ hasText: 'libsqlite3-0' })).toContainText('Phased');
  await expect(page.getByRole('tab', { name: /Updates \(0\)/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Install updates/ })).toBeDisabled();
});
