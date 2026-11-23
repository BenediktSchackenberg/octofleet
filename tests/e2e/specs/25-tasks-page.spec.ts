import { test, expect } from '@playwright/test';
import { API_URL, getAuthHeaders } from './helpers';

// The Tasks page lists failed jobs per node and job type with status, reason, time and links; a later
// successful run of the same job resolves the entry. The jobs page shows only failed jobs with
// ?status=failed (the sidebar badge).
test('Tasks page: failed jobs per node and type, resolved by a later success; jobs page ?status=failed', async ({ page, request }) => {
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
  await runJob(failedName, false);
  const failedId = await runJob(failedName, false);
  await runJob(okName, true); // another script succeeding does not resolve this one

  await page.goto('/tasks?tab=jobs', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('locale', 'en'));
  await page.reload({ waitUntil: 'domcontentloaded' });

  // one entry for both failures: the node as object, the job type as type
  const rows = page.locator('tr', { has: page.getByText(failedName) });
  await expect(rows).toHaveCount(1);
  const row = rows.first();
  await expect(row.getByRole('link', { name: hostname })).toHaveAttribute('href', `/nodes/${node.id}`);
  await expect(row).toContainText('Script');
  await expect(row).toContainText('Failed 2×');
  await expect(row).toContainText('Could not get lock');
  await expect(row).toContainText('failing since');
  await expect(row).toContainText('min ago');
  await expect(row.getByRole('link', { name: 'Open' })).toHaveAttribute('href', `/jobs/${failedId}`);
  await expect(page.getByText(okName)).toHaveCount(0);

  // the dashboard counts like the Tasks page and links to its jobs filter
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Open tasks:')).toBeVisible();
  await expect(page.getByRole('link', { name: /failed job/ }).first()).toHaveAttribute('href', '/tasks?tab=jobs');

  // the jobs page with ?status=failed: only failed jobs (the status filter is set)
  await page.goto('/jobs?status=failed', { waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Status')).toHaveValue('failed');
  await expect(page.getByText(failedName).first()).toBeVisible();
  await expect(page.getByText(okName)).toHaveCount(0);
  // the sidebar badge next to Jobs (shown in the Deploy area) says what it counts
  await expect(page.locator('span[title$="failed jobs in the last 7 days"]').first()).toBeVisible();

  // the same job succeeds later: the entry is resolved and leaves the list
  await runJob(failedName, true);
  await page.goto('/tasks?tab=jobs', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(/Show resolved job failures/)).toBeVisible();
  await expect(page.locator('tr', { has: page.getByText(failedName) })).toHaveCount(0);
  await page.getByText(/Show resolved job failures/).click();
  await expect(page.locator('tr', { has: page.getByText(failedName) }).first()).toContainText('Resolved');
});
