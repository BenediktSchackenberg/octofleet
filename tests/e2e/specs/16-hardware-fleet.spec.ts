import { test, expect } from '@playwright/test';

// Disks of virtual machines are shown as virtual, with health "Virtual – no SMART" (neutral, not
// "Unknown"), empty bus types without "()", unknown health on a physical disk neutral (not red), a
// device column (Disk 1 / sda), host links to the node's Hardware tab, and the page is translated.
// CI has no hardware data, so the API is mocked.
test('hardware fleet page: device column, virtual disks without SMART, unknown health is neutral', async ({ page }) => {
  await page.route('**/api/v1/hardware/fleet', (route) => route.fulfill({ json: {
    nodeCount: 3,
    storage: { totalTB: 0.3, usedTB: 0.2, usedPercent: 59.5 },
    physicalDiskHealth: { healthy: 1, warning: 0, unhealthy: 0, virtual: 1, unknown: 1 },
    diskTypes: { ssd: 1, hdd: 1, virtual: 1, unknown: 0 },
    cpuTypes: [{ name: 'Test CPU', count: 3 }],
    physicalDisks: [
      { nodeId: 'n1', hostname: 'e2e-vm', deviceId: '/dev/sda', model: 'Virtual Disk', sizeGB: 127, isSsd: null,
        isVirtual: true, busType: null, interfaceType: null, healthStatus: null, health: 'virtual',
        temperature: null, wearLevel: null },
      { nodeId: 'n2', hostname: 'e2e-pc', deviceId: '\\\\.\\PHYSICALDRIVE1', model: 'Test SSD', sizeGB: 512,
        isSsd: true, isVirtual: false, busType: 'NVMe', interfaceType: null, healthStatus: 'Healthy',
        health: 'healthy', temperature: null, wearLevel: null },
      { nodeId: 'n3', hostname: 'e2e-old', deviceId: '/dev/sdb', model: 'Old HDD', sizeGB: 1000, isSsd: false,
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
  await expect(page.getByRole('columnheader', { name: 'Device' })).toBeVisible();

  const vmRow = page.locator('tr', { hasText: 'e2e-vm' });
  await expect(vmRow.getByRole('cell', { name: 'sda', exact: true })).toBeVisible();
  await expect(vmRow).not.toContainText('()');
  await expect(vmRow.getByText('Virtual – no SMART', { exact: true })).toHaveClass(/text-sky-300/);
  await expect(vmRow).not.toContainText('Unknown');
  await expect(vmRow.getByRole('link', { name: 'e2e-vm' })).toHaveAttribute('href', '/nodes/n1?tab=hardware');

  const pcRow = page.locator('tr', { hasText: 'e2e-pc' });
  await expect(pcRow.getByRole('cell', { name: 'Disk 1', exact: true })).toBeVisible();
  await expect(pcRow).toContainText('(NVMe)');

  const oldRow = page.locator('tr', { hasText: 'e2e-old' });
  await expect(oldRow.getByText('Unknown', { exact: true })).toHaveClass(/text-zinc-400/);

  await expect(page.getByText('1 Virtual – no SMART')).toBeVisible();
  await expect(page.getByText('Drive C: is 96% full')).toBeVisible();
});
