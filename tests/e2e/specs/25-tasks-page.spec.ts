import { test, expect } from '@playwright/test';
import { API_URL, getAuthHeaders } from './helpers';

// The Tasks page lists a failed job with its status, time and a link to the job; the jobs page
// shows only failed jobs with ?status=failed (the dashboard's "failed job" link)
test('Tasks page: a failed job with status, time and link; jobs page ?status=failed', async ({ page, request }) => {
  const hostname = `e2e-tasks-${Date.now()}`;
  const headers = { ...(await getAuthHeaders()), 'Content-Type': 'application/json' };
  expect((await request.post(`${API_URL}/api/v1/inventory/full`, {
    headers, data: { hostname, nodeId: hostname, system: { os: { name: 'Ubuntu 26.04 LTS' } } },
  })).ok()).toBeTruthy();
  const node = await (await request.get(`${API_URL}/api/v1/nodes/${hostname}`, { headers })).json();

  const runJob = async (name: string, success: boolean) => {
    const created = await (await request.post(`${API_URL}/api/v1/jobs`, {
      headers, data: { name, targetType: 'device', targetId: node.id, commandType: 'script', commandData: { script: 'true' } },
    })).json();
    const detail = await (await request.get(`${API_URL}/api/v1/jobs/${created.id}`, { headers })).json();
    expect((await request.post(`${API_URL}/api/v1/jobs/instances/${detail.instances[0].id}/result`, {
      headers, data: { success, status: success ? 'success' : 'failed', exitCode: success ? 0 : 1, stdout: '', stderr: success ? '' : 'E: Could not get lock' },
    })).ok()).toBeTruthy();
    return created.id as string;
  };
  const failedName = `E2E failed job ${Date.now()}`;
  const okName = `E2E ok job ${Date.now()}`;
  const failedId = await runJob(failedName, false);
  await runJob(okName, true);

  await page.goto('/tasks?tab=jobs', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('locale', 'en'));
  await page.reload({ waitUntil: 'domcontentloaded' });

  const row = page.locator('tr', { has: page.getByText(failedName, { exact: true }) });
  await expect(row).toContainText('Failed job');
  await expect(row).toContainText('Failed on 1 of 1');
  await expect(row).toContainText('Could not get lock');
  await expect(row).toContainText('min ago');
  await expect(row.getByRole('link', { name: 'Open' })).toHaveAttribute('href', `/jobs/${failedId}`);
  // a successful job is not a task
  await expect(page.getByText(okName, { exact: true })).toHaveCount(0);

  // the jobs page with the dashboard's link: only failed jobs, with a chip to show all
  await page.goto('/jobs?status=failed', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Failed jobs', { exact: true })).toBeVisible();
  await expect(page.getByText(failedName)).toBeVisible();
  await expect(page.getByText(okName)).toHaveCount(0);
});
