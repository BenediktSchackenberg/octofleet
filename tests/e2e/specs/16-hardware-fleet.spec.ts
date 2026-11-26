import { test, expect } from '@playwright/test';

// One row per host with its disks (device · model · size), total size, type and the worst disk's
// status; disks of virtual machines without health data are "Virtual – no SMART" (neutral, not
// "Unknown"); unknown health on a physical disk stays neutral (not red); a host with a problem disk
// comes first and names that disk; empty bus types without "()"; hosts link to the node's Hardware tab.
// CI has no hardware data, so the API is mocked.
test('hardware fleet page: one row per host, worst status, VM disks without SMART', async ({ page }) => {
  await page.route('**/api/v1/hardware/fleet', (route) => route.fulfill({ json: {
    nodeCount: 3,
    storage: { totalTB: 1.8, usedTB: 0.6, usedPercent: 33.3 },
    physicalDiskHealth: { healthy: 1, warning: 1, unhealthy: 0, virtual: 1, unknown: 1 },
    diskTypes: { ssd: 1, hdd: 2, virtual: 1, unknown: 0 },
    cpuTypes: [{ name: 'Test CPU', count: 3 }],
    physicalDisks: [
      { nodeId: 'n1', hostname: 'e2e-vm', deviceId: '/dev/sda', model: 'Virtual Disk', sizeGB: 127, isSsd: null,
        isVirtual: true, busType: null, interfaceType: null, healthStatus: null, health: 'virtual',
        temperature: null, wearLevel: null },
      { nodeId: 'n2', hostname: 'e2e-pc', deviceId: '\\\\.\\PHYSICALDRIVE0', model: 'Test SSD', sizeGB: 512,
        isSsd: true, isVirtual: false, busType: 'NVMe', interfaceType: null, healthStatus: 'Healthy',
        health: 'healthy', temperature: null, wearLevel: null },
      { nodeId: 'n2', hostname: 'e2e-pc', deviceId: '\\\\.\\PHYSICALDRIVE1', model: 'Test HDD', sizeGB: 1000,
        isSsd: false, isVirtual: false, busType: 'SATA', interfaceType: null, healthStatus: 'Warning',
        health: 'warning', temperature: null, wearLevel: null },
      { nodeId: 'n3', hostname: 'e2e-old', deviceId: '/dev/sdb', model: 'Old HDD', sizeGB: 250, isSsd: false,
        isVirtual: false, busType: null, interfaceType: 'SATA', healthStatus: null, health: 'unknown',
        temperature: null, wearLevel: null },
    ],
    issues: [{ nodeId: 'n2', hostname: 'e2e-pc', issue: 'Drive C: is 96% full', kind: 'volumeUsage',
      drive: 'C:', usedPercent: 96, severity: 'critical' }],
  } }));

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('locale', 'en'));
  await page.goto('/hardware', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: /Hardware fleet overview/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Disks (4 on 3 hosts)' })).toBeVisible();
  const rows = page.locator('tbody tr');
  await expect(rows).toHaveCount(3);
  // worst first: the host with a warning disk, then unknown, then virtual
  await expect(rows.nth(0)).toContainText('e2e-pc');
  await expect(rows.nth(1)).toContainText('e2e-old');
  await expect(rows.nth(2)).toContainText('e2e-vm');

  const pcRow = rows.nth(0);
  await expect(pcRow).toContainText('Disk 0');
  await expect(pcRow).toContainText('Disk 1');
  await expect(pcRow).toContainText('1512 GB');
  await expect(pcRow).toContainText('SSD (NVMe), HDD (SATA)');
  await expect(pcRow.locator('td').last().getByText('Warning', { exact: true })).toHaveClass(/text-yellow-400/);
  await expect(pcRow.locator('li', { hasText: 'Disk 1' }).getByText('Warning', { exact: true })).toBeVisible();
  await expect(pcRow.locator('li', { hasText: 'Disk 0' })).not.toContainText('Healthy');

  const vmRow = rows.nth(2);
  await expect(vmRow).toContainText('sda');
  await expect(vmRow).not.toContainText('()');
  await expect(vmRow.getByText('Virtual – no SMART', { exact: true })).toHaveClass(/text-sky-300/);
  await expect(vmRow).not.toContainText('Unknown');
  await expect(vmRow.getByRole('link', { name: 'e2e-vm' })).toHaveAttribute('href', '/nodes/n1?tab=hardware');

  await expect(rows.nth(1).getByText('Unknown', { exact: true })).toHaveClass(/text-zinc-400/);

  await expect(page.getByText('1 Virtual – no SMART')).toBeVisible();
  await expect(page.getByText('Drive C: is 96% full')).toBeVisible();
});
