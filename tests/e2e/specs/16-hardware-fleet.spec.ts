import { test, expect } from '@playwright/test';

// Disks of virtual machines are shown as virtual, empty bus types without "()", unknown health
// neutral (not red), and the page is translated. CI has no hardware data, so the API is mocked.
test('hardware fleet page: virtual disks, no empty brackets, unknown health is neutral', async ({ page }) => {
  await page.route('**/api/v1/hardware/fleet', (route) => route.fulfill({ json: {
    nodeCount: 2,
    storage: { totalTB: 0.3, usedTB: 0.2, usedPercent: 59.5 },
    physicalDiskHealth: { healthy: 1, warning: 0, unhealthy: 0, unknown: 1 },
    diskTypes: { ssd: 1, hdd: 0, virtual: 1, unknown: 0 },
    cpuTypes: [{ name: 'Test CPU', count: 2 }],
    physicalDisks: [
      { nodeId: 'n1', hostname: 'e2e-vm', model: 'Virtual Disk', sizeGB: 127, isSsd: false, isVirtual: true,
        busType: null, interfaceType: null, healthStatus: null, temperature: null, wearLevel: null },
      { nodeId: 'n2', hostname: 'e2e-pc', model: 'Test SSD', sizeGB: 512, isSsd: true, isVirtual: false,
        busType: 'NVMe', interfaceType: null, healthStatus: 'Healthy', temperature: null, wearLevel: null },
    ],
    issues: [{ nodeId: 'n2', hostname: 'e2e-pc', issue: 'Drive C: is 96% full', kind: 'volumeUsage',
      drive: 'C:', usedPercent: 96, severity: 'critical' }],
  } }));

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('locale', 'en'));
  await page.goto('/hardware', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: /Hardware fleet overview/ })).toBeVisible();
  const vmRow = page.locator('tr', { hasText: 'e2e-vm' });
  await expect(vmRow).toContainText('Virtual');
  await expect(vmRow).not.toContainText('()');
  await expect(vmRow.getByText('Unknown', { exact: true })).toHaveClass(/text-zinc-400/);
  await expect(page.locator('tr', { hasText: 'e2e-pc' })).toContainText('(NVMe)');
  await expect(page.getByText('Drive C: is 96% full')).toBeVisible();
});
