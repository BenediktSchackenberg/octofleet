import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { API_URL, getAuthHeaders } from './helpers';

// The node page's Services tab shows the services of both agents in one table:
// Windows (system inventory) and Linux (systemd units).

async function push(request: APIRequestContext, data: Record<string, unknown>) {
  const response = await request.post(`${API_URL}/api/v1/inventory/full`, {
    headers: { ...(await getAuthHeaders()), 'Content-Type': 'application/json' },
    data,
  });
  expect(response.ok()).toBeTruthy();
}

async function openServicesTab(page: Page, hostname: string) {
  await page.goto(`/nodes/${hostname}`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('locale', 'en'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  const tab = page.getByRole('tab', { name: /^Services$/ });
  await expect(tab).toBeVisible();
  await tab.click();
  return page.getByRole('tabpanel');
}

test('Services tab shows the services of a Windows node', async ({ page, request }) => {
  const hostname = `e2e-win-services-${Date.now()}`;
  await push(request, {
    hostname,
    nodeId: hostname,
    system: {
      os: { name: 'Microsoft Windows Server 2025 Standard', version: '10.0.26100' },
      services: {
        total: 2,
        running: 1,
        services: [
          { name: 'Spooler', displayName: 'Print Spooler', state: 'Running', startMode: 'Auto', startName: 'LocalSystem' },
          { name: 'Fax', displayName: 'Fax', state: 'Stopped', startMode: 'Manual', startName: 'NT AUTHORITY\\NetworkService' },
        ],
      },
    },
  });

  const panel = await openServicesTab(page, hostname);
  await expect(panel.getByText('Services (2)')).toBeVisible();
  await expect(panel.getByText('1 running · 1 stopped · 0 failed')).toBeVisible();
  await expect(panel.getByText('Print Spooler')).toBeVisible();
  await expect(panel.getByText('LocalSystem')).toBeVisible();

  await panel.getByPlaceholder('Search name or description...').fill('spool');
  await expect(panel.getByText('Fax', { exact: true })).toHaveCount(0);
  await expect(panel.getByText('Spooler', { exact: true })).toBeVisible();
});

test('Services tab shows the systemd units of a Linux node, failed ones first', async ({ page, request }) => {
  const hostname = `e2e-linux-services-${Date.now()}`;
  await push(request, {
    hostname,
    nodeId: hostname,
    services: {
      services: [
        { name: 'ssh', loadState: 'loaded', activeState: 'active', subState: 'running', description: 'OpenBSD Secure Shell server' },
        { name: 'cups', loadState: 'loaded', activeState: 'inactive', subState: 'dead', description: 'CUPS Scheduler' },
        { name: 'backup', loadState: 'loaded', activeState: 'failed', subState: 'failed', description: 'Nightly backup' },
      ],
      summary: { total: 3, active: 1, failed: 1, inactive: 1 },
      enabledServices: ['ssh', 'backup'],
    },
  });

  const panel = await openServicesTab(page, hostname);
  await expect(panel.getByText('Services (3)')).toBeVisible();
  await expect(panel.getByText('1 running · 1 stopped · 1 failed')).toBeVisible();
  const rows = panel.getByRole('row');
  await expect(rows.nth(1)).toContainText('backup');
  await expect(rows.nth(1)).toContainText('Failed');
  await expect(rows.nth(1)).toContainText('enabled');

  await panel.getByRole('combobox').selectOption('stopped');
  await expect(panel.getByText('cups', { exact: true })).toBeVisible();
  await expect(panel.getByText('ssh', { exact: true })).toHaveCount(0);
});

test('Services tab stays visible when no services were reported', async ({ page, request }) => {
  const hostname = `e2e-no-services-${Date.now()}`;
  await push(request, { hostname, nodeId: hostname, system: { os: { name: 'Ubuntu 26.04 LTS' } } });

  const panel = await openServicesTab(page, hostname);
  await expect(panel.getByText('The agent has not reported any services for this node yet.')).toBeVisible();
});
