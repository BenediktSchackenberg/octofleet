import { test, expect } from '@playwright/test';
import { API_URL, getAuthHeaders } from './helpers';

// Linux agents before 0.5.42 read `systemctl list-units` without --plain: a not-found or failed unit
// came with a marker (● or *) in front, which became its name, and every field moved one to the right.
// The Services tab moves these rows back; rows of newer agents stay as they are.
test('Linux services: rows shifted by the systemctl marker show the unit and its state', async ({ page, request }) => {
  const hostname = `e2e-linux-services-${Date.now()}`;
  const headers = { ...(await getAuthHeaders()), 'Content-Type': 'application/json' };
  expect((await request.post(`${API_URL}/api/v1/inventory/full`, { headers, data: {
    hostname, nodeId: hostname, system: { os: { name: 'Ubuntu 26.04 LTS' } },
    services: { enabledServices: ['cron', 'nginx'], services: [
      { name: 'cron', loadState: 'loaded', activeState: 'active', subState: 'running', description: 'Regular background program processing daemon' },
      // an older agent: marker as the name
      { name: '●', loadState: 'auditd.service', activeState: 'not-found', subState: 'inactive', description: 'dead auditd.service' },
      { name: '×', loadState: 'nginx.service', activeState: 'loaded', subState: 'failed', description: 'failed A high performance web server' },
      // a newer agent: a not-found unit in its own fields
      { name: 'connman', loadState: 'not-found', activeState: 'inactive', subState: 'dead', description: 'connman.service' },
    ] } } })).ok()).toBeTruthy();

  await page.goto(`/nodes/${hostname}?tab=services`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('locale', 'en'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  const row = (name: string) => page.getByRole('row').filter({ has: page.getByText(name, { exact: true }) });

  await expect(row('auditd')).toHaveCount(1);
  await expect(row('nginx')).toHaveCount(1);
  await expect(page.getByRole('row').filter({ hasText: /^[●×]/ })).toHaveCount(0);
  // the failed unit counts as failed and comes first; its description is back
  await expect(row('nginx')).toContainText('Failed');
  await expect(row('nginx')).toContainText('A high performance web server');
  await expect(page.getByRole('row').nth(1)).toContainText('nginx');
  // a unit that is not loaded says so in its state, whichever agent reported it
  await expect(row('auditd').getByTitle('inactive (dead), not-found')).toBeVisible();
  await expect(row('connman').getByTitle('inactive (dead), not-found')).toBeVisible();
  await expect(row('cron').getByTitle('active (running)')).toBeVisible();
  // enabled is matched by the unit's real name
  await expect(row('nginx')).toContainText('enabled');
  await expect(row('auditd')).toContainText('disabled');
});
