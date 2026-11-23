import { test, expect } from '@playwright/test';
import { API_URL, getAuthHeaders } from './helpers';

// Reboot button: next to "Reboot required" on the node's Updates tab; the dialog names the node and
// warns about logged-on users; afterwards the node shows the scheduled reboot and can cancel it, and
// "Reboot required" stays until the node reports after the reboot
test('Reboot button: dialog with warnings, scheduled reboot, cancel', async ({ page, request }) => {
  const hostname = `e2e-reboot-${Date.now()}`;
  const headers = { ...(await getAuthHeaders()), 'Content-Type': 'application/json' };
  expect((await request.post(`${API_URL}/api/v1/inventory/full`, { headers, data: {
    hostname, nodeId: hostname, system: { os: { name: 'CachyOS Linux' } },
    updates: { packageManager: 'pacman', totalUpdates: 1, securityUpdates: 0, rebootRequired: true,
      updates: [{ name: 'vim', newVersion: '9.1.1-1', repository: 'extra', security: false }] } } })).ok()).toBeTruthy();
  expect((await request.post(`${API_URL}/api/v1/live-data`, { headers, data: {
    nodeId: hostname, loggedOnUsers: [{ user: 'anna', session: 'tty2', since: null }] } })).ok()).toBeTruthy();

  await page.goto(`/nodes/${hostname}?tab=updates`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('locale', 'en'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Reboot required')).toBeVisible();

  // the Updates tab's button (the header has one too)
  await page.getByRole('button', { name: /Reboot/ }).last().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(`Reboot ${hostname}`);
  await expect(dialog).toContainText('Logged on: anna (tty2)');
  const submit = dialog.getByRole('button', { name: 'Reboot', exact: true });
  // a logged-on user must be acknowledged first
  await expect(submit).toBeDisabled();
  await dialog.getByRole('radio').nth(1).check();   // in N minutes
  await dialog.getByLabel('In', { exact: true }).selectOption('30');
  await dialog.getByRole('checkbox').click();
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText(/Reboot sent/)).toBeVisible();

  // scheduled: shown with Cancel; "Reboot required" stays until the node reports after the reboot
  await expect(page.getByText(/Reboot requested/).first()).toBeVisible();
  await expect(page.getByText('Reboot required')).toBeVisible();
  await page.getByRole('button', { name: /Cancel reboot/ }).first().click();
  await expect(page.getByText(/Cancelling the reboot/)).toBeVisible();
});
