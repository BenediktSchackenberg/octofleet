import { test, expect } from '@playwright/test';
import { API_URL, getAuthHeaders } from './helpers';

// Linux nodes: the Updates tab shows the last update search (a patch_scan job's result), a reboot
// flag, and starts a patch_scan job; "Install updates" asks before it creates a patch_install job, for
// all updates or only the selected packages.
test('Linux updates: last search, reboot flag, search and install with confirmation', async ({ page, request }) => {
  const hostname = `e2e-linux-upd-${Date.now()}`;
  const headers = { ...(await getAuthHeaders()), 'Content-Type': 'application/json' };
  const pushed = await request.post(`${API_URL}/api/v1/inventory/full`, {
    headers,
    data: {
      hostname, nodeId: hostname,
      system: { os: { name: 'Ubuntu 26.04 LTS' } },
      updates: {
        packageManager: 'apt', totalUpdates: 2, securityUpdates: 1, rebootRequired: true,
        rebootPackages: ['linux-image-7.0.0-44-generic'],
        scan: { status: 'partial', source: 'apt', error: 'W: Failed to fetch http://mirror.example/repo', duration_seconds: 4 },
        updates: [
          { name: 'openssl', newVersion: '3.5.1-1ubuntu2.1', repository: 'resolute-security', security: true },
          { name: 'systemd', newVersion: '259.2-1ubuntu3.1', repository: 'resolute-updates', security: false },
        ],
      },
    },
  });
  expect(pushed.ok()).toBeTruthy();

  await page.goto(`/nodes/${hostname}?tab=updates`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('locale', 'en'));
  await page.reload({ waitUntil: 'domcontentloaded' });

  await expect(page.getByText('Last update search:')).toBeVisible();
  await expect(page.getByText('With errors')).toBeVisible();
  await expect(page.getByText('via apt')).toBeVisible();
  await expect(page.getByText('Package updates (2)')).toBeVisible();
  await expect(page.getByText('Reboot required')).toBeVisible();

  // Install asks first; cancelling creates no job
  await page.getByRole('button', { name: /Install updates/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Install all updates?')).toBeVisible();
  await expect(dialog).toContainText('all 2 package updates with apt');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();

  // Selecting packages: "Install selected (n)" sends only those
  await page.getByRole('checkbox', { name: 'Select openssl' }).check();
  await page.getByRole('button', { name: /Install selected \(1\)/ }).click();
  await expect(dialog.getByText('Install the selected updates?')).toBeVisible();
  await expect(dialog).toContainText('these packages with apt: openssl');
  await dialog.getByRole('button', { name: /Install selected/ }).click();
  await expect(page.getByRole('button', { name: /Installing/ })).toBeDisabled();
  const afterInstall = await request.get(`${API_URL}/api/v1/jobs?node=${hostname}`, { headers });
  const install = (await afterInstall.json()).jobs.find((j: { command_type: string }) => j.command_type === 'patch_install');
  expect(install).toBeTruthy();
  const detail = await (await request.get(`${API_URL}/api/v1/jobs/${install.id}`, { headers })).json();
  const data = typeof detail.commandData === 'string' ? JSON.parse(detail.commandData) : (detail.commandData ?? detail.command_data);
  expect(data.packages).toEqual(['openssl']);
  await page.reload({ waitUntil: 'domcontentloaded' });

  // Search: a patch_scan job for the node; no agent answers in the test, so the button waits
  await page.getByRole('button', { name: /Search for updates/ }).click();
  await expect(page.getByRole('button', { name: /Searching/ })).toBeDisabled();

  const jobs = await request.get(`${API_URL}/api/v1/jobs?node=${hostname}`, { headers });
  expect(jobs.ok()).toBeTruthy();
  const types = (await jobs.json()).jobs.map((j: { command_type: string }) => j.command_type);
  expect(types).toContain('patch_scan');
  expect(types.filter((type: string) => type === 'patch_install')).toHaveLength(1);
});
