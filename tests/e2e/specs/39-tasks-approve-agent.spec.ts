import { test, expect } from '@playwright/test';
import { API_URL, getAuthHeaders } from './helpers';

// An agent waiting for approval can be approved or rejected right in its Tasks row (after a
// confirmation that names it); "Open" leads to the Nodes page, where the pending section is.
test('Tasks page: approve and reject waiting agents in the row', async ({ page, request }) => {
  const stamp = Date.now();
  const register = async (hostname: string) => {
    const res = await request.post(`${API_URL}/api/v1/nodes/register`, {
      data: { hostname, osName: 'Ubuntu 26.04 LTS', agentVersion: '0.5.40-linux', machineId: `${hostname}-machine` },
    });
    expect(res.ok()).toBeTruthy();
    return (await res.json()).pendingId as string;
  };
  const toApprove = `e2e-approve-${stamp}`;
  const toReject = `e2e-reject-${stamp}`;
  const approveId = await register(toApprove);
  const rejectId = await register(toReject);

  await page.goto('/tasks?tab=approvals', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('locale', 'en'));
  await page.reload({ waitUntil: 'domcontentloaded' });

  const row = (hostname: string) => page.locator('tr', { has: page.getByText(hostname, { exact: true }) });
  await expect(row(toApprove)).toHaveCount(1);
  await expect(row(toApprove).getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/nodes');

  // the confirmation names the agent; dismissing it changes nothing
  let message = '';
  page.once('dialog', (d) => { message = d.message(); d.dismiss(); });
  await row(toReject).getByRole('button', { name: 'Reject' }).click();
  await expect.poll(() => message).toContain(toReject);
  await expect(row(toReject)).toHaveCount(1);

  page.once('dialog', (d) => d.accept());
  await row(toReject).getByRole('button', { name: 'Reject' }).click();
  await expect(row(toReject)).toHaveCount(0);

  page.once('dialog', (d) => { message = d.message(); d.accept(); });
  await row(toApprove).getByRole('button', { name: 'Approve' }).click();
  await expect(row(toApprove)).toHaveCount(0);
  expect(message).toContain(toApprove);

  // both left the pending list: one approved, one rejected
  const headers = await getAuthHeaders();
  const pending = await (await request.get(`${API_URL}/api/v1/pending-nodes`, { headers })).json();
  const ids = pending.pending.map((p: { id: string }) => p.id);
  expect(ids).not.toContain(approveId);
  expect(ids).not.toContain(rejectId);
  const config = await request.get(`${API_URL}/api/v1/pending-nodes/${rejectId}/config`);
  expect(config.ok()).toBeFalsy();
});
