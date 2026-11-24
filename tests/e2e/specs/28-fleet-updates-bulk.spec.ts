import { test, expect } from '@playwright/test';
import { API_URL, getAuthHeaders } from './helpers';

// Fleet updates, bulk actions: tick nodes, search on them, or install all of their updates after a
// confirmation that lists each node with its reboot outlook and offers the reboot choice. Windows installs
// only updates approved in the catalog; Linux nodes the versions their approval rules approve - these agents
// report no release (older agent), so they are skipped (31-linux-approval-rules covers the rules)
test('Fleet updates: search and install on ticked nodes', async ({ page, request }) => {
  const tag = `e2e-fleetbulk-${Date.now()}`;
  const headers = { ...(await getAuthHeaders()), 'Content-Type': 'application/json' };
  const win = `${tag}-win`, linux = `${tag}-linux`, idle = `${tag}-idle`;
  // a KB of its own: the catalog approval is global and must start unapproved
  const kb = `KB58${String(Date.now()).slice(-5)}`;
  for (const [hostname, data] of [
    [win, { system: { os: { name: 'Microsoft Windows Server 2025 Standard' } } }],
    [linux, { system: { os: { name: 'Ubuntu 26.04 LTS' } }, updates: { packageManager: 'apt', totalUpdates: 1, securityUpdates: 0,
      updates: [{ name: 'vim', newVersion: '9.1', security: false }] } }],
    [idle, { system: { os: { name: 'Debian GNU/Linux 13 (trixie)' } }, updates: { packageManager: 'apt', totalUpdates: 0, updates: [] } }],
  ] as const) {
    expect((await request.post(`${API_URL}/api/v1/inventory/full`, { headers, data: { hostname, nodeId: hostname, ...data } })).ok()).toBeTruthy();
  }
  expect((await request.post(`${API_URL}/api/v1/patches/scan-results`, { headers, data: {
    node_id: win, scan: { status: 'succeeded', source: 'wsus', server: 'https://wsus.example:8531' },
    patches: [
      { kb_id: kb, title: `2026-11 Cumulative Update for Microsoft server operating system (${kb})`, severity: 'critical', category: 'security', reboot_behavior: 'always' },
      { kb_id: 'KB2267602', title: 'Security Intelligence Update for Microsoft Defender Antivirus - KB2267602 (Version 1.463.277.0)', severity: 'low', category: 'security', reboot_behavior: 'never' },
    ] } })).ok()).toBeTruthy();

  await page.goto(`/patches/updates?q=${tag}`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('locale', 'en'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Shown: 3')).toBeVisible();

  // Nothing approved yet: Windows is skipped with a link to the catalog, the older Linux agents too
  await page.getByRole('checkbox', { name: 'Select the nodes shown' }).check();
  await expect(page.getByText('3 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Install updates…' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading')).toHaveText('Install updates on the selected nodes?');
  await expect(dialog.getByRole('listitem').filter({ hasText: win })).toContainText('no approved updates – skipped');
  await expect(dialog.getByRole('listitem').filter({ hasText: win }).getByRole('link', { name: 'Approve in the catalog' })).toBeVisible();
  await expect(dialog.getByRole('listitem').filter({ hasText: linux })).toContainText('Linux agent too old for approval rules – skipped');
  await expect(dialog.getByRole('listitem').filter({ hasText: idle })).toContainText('Linux agent too old for approval rules – skipped');
  await expect(dialog.getByRole('button', { name: 'Install (0)' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // Approved in the catalog: the Windows node installs it
  const catalog = await (await request.get(`${API_URL}/api/v1/patches/catalog?search=${kb}`, { headers })).json();
  const entry = catalog.items.find((p: { kb_id: string }) => p.kb_id === kb);
  expect((await request.patch(`${API_URL}/api/v1/patches/catalog/${entry.id}/approve`, { headers })).ok()).toBeTruthy();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('row').filter({ hasText: win })).toContainText('1 approved');
  await page.getByRole('checkbox', { name: 'Select the nodes shown' }).check();
  await page.getByRole('button', { name: 'Install updates…' }).click();
  await expect(dialog.getByRole('listitem').filter({ hasText: win })).toContainText('Approved updates: 1 of 1');
  await expect(dialog.getByRole('listitem').filter({ hasText: win })).toContainText('Will need a reboot');
  // Defender signatures only when asked for
  await dialog.getByRole('checkbox', { name: /Include Defender signature updates/ }).check();
  await expect(dialog.getByRole('listitem').filter({ hasText: win })).toContainText(/of 2/);
  await dialog.getByRole('checkbox', { name: /Include Defender signature updates/ }).uncheck();
  // The reboot choice, as on the node page; Windows' own restart policy is mentioned
  await expect(dialog.getByLabel(/^Don't reboot/)).toBeChecked();
  await expect(dialog).toContainText('Windows may still restart by itself');
  await dialog.getByRole('button', { name: 'Install (1)' }).click();
  await expect(page.getByText('Installation started – nodes: 1')).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: win })).toContainText('Installing…');
  await expect(page.getByRole('row').filter({ hasText: linux })).not.toContainText('Installing…');

  // Search on one node
  await page.getByRole('checkbox', { name: `Select ${idle}` }).check();
  await page.getByRole('button', { name: 'Search for updates (1)' }).click();
  await expect(page.getByText('Update search started – nodes: 1')).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: idle })).toContainText('Searching…');

  // A running installation is not started again: the dialog says so and installs nowhere
  await page.getByRole('checkbox', { name: `Select ${win}` }).check();
  await page.getByRole('button', { name: 'Install updates…' }).click();
  await expect(dialog.getByRole('listitem').filter({ hasText: win })).toContainText('a search or installation is running – skipped');
  await expect(dialog.getByRole('button', { name: 'Install (0)' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // The Windows job got only the cumulative update and no reboot
  const fleet = await (await request.get(`${API_URL}/api/v1/patches/fleet?q=${win}`, { headers })).json();
  const job = await (await request.get(`${API_URL}/api/v1/jobs/${fleet.nodes[0].last_job.id}`, { headers })).json();
  const data = typeof job.command_data === 'string' ? JSON.parse(job.command_data) : job.command_data;
  expect(data.kb_ids).toEqual([kb]);
  expect(data.reboot_policy).toBe('no_reboot');
});
