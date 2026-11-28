import { test, expect } from '@playwright/test';
import { API_URL, getAuthHeaders } from './helpers';

// Fleet updates: Windows and Linux nodes in one list with pending updates, reboot and last search; the
// cards filter, the filters live in the URL and Back returns to the previous filter; a node leads to
// its Updates tab
test('Fleet updates: list, filters with Back, link to the Updates tab', async ({ page, request }) => {
  const tag = `e2e-fleet-${Date.now()}`;
  const headers = { ...(await getAuthHeaders()), 'Content-Type': 'application/json' };
  const win = `${tag}-win`, linux = `${tag}-linux`, idle = `${tag}-idle`;
  for (const [hostname, data] of [
    [win, { system: { os: { name: 'Microsoft Windows Server 2025 Standard' } } }],
    [linux, { system: { os: { name: 'Ubuntu 26.04 LTS' } }, updates: { packageManager: 'apt', totalUpdates: 1, securityUpdates: 0, rebootRequired: true,
      updates: [{ name: 'vim', newVersion: '9.1', security: false }] } }],
    [idle, { system: { os: { name: 'Debian GNU/Linux 13 (trixie)' } }, updates: { packageManager: 'apt', totalUpdates: 0, updates: [] } }],
  ] as const) {
    expect((await request.post(`${API_URL}/api/v1/inventory/full`, { headers, data: { hostname, nodeId: hostname, ...data } })).ok()).toBeTruthy();
  }
  expect((await request.post(`${API_URL}/api/v1/patches/scan-results`, { headers, data: {
    node_id: win, scan: { status: 'partial', source: 'wsus', server: 'https://wsus.example:8531', error: '0x8024401C' },
    patches: [
      { kb_id: 'KB5130001', title: '2026-11 Cumulative Update for Microsoft server operating system', severity: 'critical', category: 'security', reboot_behavior: 'can' },
      { kb_id: 'KB2267602', title: 'Security Intelligence Update for Microsoft Defender Antivirus - KB2267602 (Version 1.463.277.0)', severity: 'low', category: 'security', reboot_behavior: 'never' },
    ] } })).ok()).toBeTruthy();

  await page.goto(`/patches/updates?q=${tag}`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('locale', 'en'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Fleet updates' })).toBeVisible();
  const rows = page.getByRole('row');
  await expect(page.getByText('Shown: 3')).toBeVisible();

  const winRow = rows.filter({ hasText: win });
  await expect(winRow).toContainText('1 security');
  await expect(winRow).toContainText('+ 1 Defender signatures');
  await expect(winRow).toContainText('May need a reboot');
  await expect(winRow).toContainText('With errors');
  await expect(rows.filter({ hasText: linux })).toContainText('Reboot pending');
  await expect(rows.filter({ hasText: idle })).toContainText('Not searched yet');

  // A card filters; the filter is in the URL and Back returns to the list without it
  await page.getByRole('button', { name: /Reboot pending or needed/ }).click();
  await expect(page).toHaveURL(/reboot=1/);
  await expect(page.getByText('Shown: 1')).toBeVisible();
  await expect(rows.filter({ hasText: idle })).toHaveCount(0);
  await page.goBack();
  await expect(page).not.toHaveURL(/reboot=1/);
  await expect(page.getByText('Shown: 3')).toBeVisible();

  await page.getByLabel('Operating system').selectOption('windows');
  await expect(page).toHaveURL(/os=windows/);
  await expect(page.getByText('Shown: 1')).toBeVisible();

  // The node leads to its Updates tab
  await page.getByRole('link', { name: win }).click();
  await expect(page).toHaveURL(/tab=updates/);
  await expect(page.getByRole('tab', { name: /Updates/ })).toHaveAttribute('aria-selected', 'true');
});

// Icons, not emojis: the cards, the bulk buttons and the reboot row button use the same icon set as
// the dashboard (emojis looked different on every system and clashed with the dark theme)
test('Fleet updates: icons instead of emojis', async ({ page, request }) => {
  const hostname = `e2e-fleet-icons-${Date.now()}`;
  const headers = { ...(await getAuthHeaders()), 'Content-Type': 'application/json' };
  expect((await request.post(`${API_URL}/api/v1/inventory/full`, { headers, data: { hostname, nodeId: hostname,
    system: { os: { name: 'Ubuntu 26.04 LTS' } }, updates: { packageManager: 'apt', totalUpdates: 1, securityUpdates: 0, rebootRequired: true,
      updates: [{ name: 'vim', newVersion: '9.1', security: false }] } } })).ok()).toBeTruthy();

  await page.goto(`/patches/updates?q=${hostname}&reboot=1`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('locale', 'en'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  const row = page.getByRole('row').filter({ hasText: hostname });
  await expect(row).toContainText('Reboot pending');

  // seven cards, each with an icon
  const cards = page.locator('div[class*="lg:grid-cols-7"] > button[aria-pressed]');
  await expect(cards).toHaveCount(7);
  for (let i = 0; i < 7; i++) await expect(cards.nth(i).locator('svg')).toHaveCount(1);
  // the row's Reboot button and the bulk buttons after ticking the node
  await expect(row.getByRole('button', { name: /Reboot/ }).locator('svg')).toHaveCount(1);
  await row.getByRole('checkbox').check();
  for (const name of [/Search for updates/, /Install updates/, /Reboot/]) {
    await expect(page.getByRole('button', { name }).first().locator('svg')).toHaveCount(1);
  }
  // no emoji left in the page's text
  const text = await page.locator('main').innerText();
  expect(text.match(/\p{Extended_Pictographic}/gu) ?? []).toEqual([]);
});
