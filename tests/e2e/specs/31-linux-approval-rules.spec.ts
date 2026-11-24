import { test, expect } from '@playwright/test';
import { API_URL, getAuthHeaders } from './helpers';

// Linux approval rules (#271): the rules page shows the disabled example rule, creates a rule with a live
// preview, and the fleet list then installs exactly the approved version on the Linux node. The rule is
// limited to a release of its own per run, so other tests are not affected.
test('Linux approval rules: create a rule, preview it, install the approved version', async ({ page, request }) => {
  const tag = `${Date.now()}`;
  const host = `e2e-linuxrules-${tag}`;
  const release = { id: `e2e${tag}`, versionId: '1' };
  const headers = { ...(await getAuthHeaders()), 'Content-Type': 'application/json' };
  const pushed = await request.post(`${API_URL}/api/v1/inventory/full`, { headers, data: {
    hostname: host, nodeId: host, system: { os: { name: 'Ubuntu 26.04 LTS' } },
    updates: { packageManager: 'apt', totalUpdates: 2, securityUpdates: 1, release, updates: [
      { name: 'openssl', newVersion: '3.5.1-1ubuntu2.1', arch: 'amd64', installedVersion: '3.5.1-1ubuntu2', repository: 'e2e-security', security: true },
      { name: 'curl', newVersion: '8.14.1-2ubuntu1', arch: 'amd64', installedVersion: '8.14.1-1', repository: 'e2e-updates', security: false },
    ] } } });
  expect(pushed.ok()).toBeTruthy();
  let ruleId: string | undefined;
  try {
    await page.goto('/patches/linux-rules', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => localStorage.setItem('locale', 'en'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Linux approval rules' })).toBeVisible();
    // the example rule exists and is disabled
    await expect(page.getByRole('checkbox', { name: 'Enable the rule Security updates (example)' })).not.toBeChecked();

    // a new rule: curl only, this run's release; the preview counts before saving
    await page.getByRole('button', { name: 'New rule' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill(`curl ${tag}`);
    await dialog.getByLabel('Only these releases (optional)').fill(`e2e${tag}:*`);
    await dialog.getByLabel('Packages (optional)').fill('curl');
    await expect(dialog).toContainText('Nodes covered: 1 · approved now: 1 · waiting for their minimum age: 0');
    // an invalid pattern is reported by the server
    await dialog.getByLabel('Packages (optional)').fill('curl;rm');
    await expect(dialog).toContainText('invalid pattern');
    await dialog.getByLabel('Packages (optional)').fill('curl');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(`Rule "curl ${tag}" created`)).toBeVisible();
    const rules = await (await request.get(`${API_URL}/api/v1/patches/linux-rules`, { headers })).json();
    ruleId = rules.rules.find((r: { name: string }) => r.name === `curl ${tag}`).id;
    await expect(page.getByRole('row').filter({ hasText: `curl ${tag}` })).toContainText('packages curl');

    // the fleet list counts it (the server updates its cache in the background) and installs exactly that version
    await page.goto(`/patches/updates?q=${host}`, { waitUntil: 'domcontentloaded' });
    await expect(async () => {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('row').filter({ hasText: host })).toContainText('1 approved', { timeout: 2000 });
    }).toPass({ timeout: 30000 });
    await page.getByRole('checkbox', { name: `Select ${host}` }).check();
    await page.getByRole('button', { name: 'Install updates…' }).click();
    const confirm = page.getByRole('dialog');
    await expect(confirm.getByRole('listitem').filter({ hasText: host })).toContainText('Approved updates: 1 of 2');
    await confirm.getByRole('button', { name: 'Install (1)' }).click();
    await expect(page.getByText('Installation started – nodes: 1')).toBeVisible();
    const jobs = await (await request.get(`${API_URL}/api/v1/jobs?node=${host}&command_type=patch_install`, { headers })).json();
    expect(jobs.jobs).toHaveLength(1);
    const detail = await (await request.get(`${API_URL}/api/v1/jobs/${jobs.jobs[0].job_id}`, { headers })).json();
    const data = typeof detail.command_data === 'string' ? JSON.parse(detail.command_data) : detail.command_data;
    expect(data.packages).toEqual([{ name: 'curl', version: '8.14.1-2ubuntu1' }]);
  } finally {
    if (ruleId) await request.delete(`${API_URL}/api/v1/patches/linux-rules/${ruleId}`, { headers });
  }
});
