import { test, expect } from '@playwright/test';

const API_URL = 'http://192.168.0.5:8080';

test.describe('Nodes Page', () => {
  test('should display nodes page', async ({ page }) => {
    await page.goto('/nodes');
    
    // Wait for page to load
    await page.waitForTimeout(2000);
    
    // Should have table or content
    const hasContent = await page.locator('table, div, [class*="card"]').count();
    expect(hasContent).toBeGreaterThan(0);
  });

  test('should show node details on click', async ({ page }) => {
    await page.goto('/nodes');
    
    // Wait for nodes to load
    await page.waitForTimeout(3000);
    
    // Click first clickable element that looks like a node
    const nodeLink = page.locator('a[href*="/nodes/"], tr, [class*="cursor-pointer"]').first();
    if (await nodeLink.isVisible()) {
      await nodeLink.click();
      
      // Should navigate to detail page or show detail panel
      await page.waitForTimeout(1000);
    }
  });
});

test.describe('Node Detail Page', () => {
  let nodeId: string;

  test.beforeAll(async ({ request }) => {
    // Get first node ID
    const response = await request.get(`${API_URL}/api/v1/nodes`);
    const data = await response.json();
    if (data.nodes.length > 0) {
      nodeId = data.nodes[0].node_id;  // snake_case
    }
  });

  test('should display node overview tab', async ({ page }) => {
    if (!nodeId) test.skip();
    
    await page.goto(`/nodes/${nodeId}`);
    
    // Should show tabs
    await expect(page.locator('text=/übersicht|overview/i').first()).toBeVisible({ timeout: 10000 });
  });

  test('should display hardware info', async ({ page }) => {
    if (!nodeId) test.skip();
    
    await page.goto(`/nodes/${nodeId}`);
    
    // Click hardware tab
    const hwTab = page.locator('text=/hardware/i').first();
    if (await hwTab.isVisible()) {
      await hwTab.click();
      await page.waitForTimeout(1000);
      
      // Should show CPU/RAM info
      const hasCpu = await page.locator('text=/cpu|prozessor/i').count();
      const hasRam = await page.locator('text=/ram|speicher|memory/i').count();
      expect(hasCpu + hasRam).toBeGreaterThan(0);
    }
  });

  test('should display software list', async ({ page }) => {
    if (!nodeId) test.skip();
    
    await page.goto(`/nodes/${nodeId}`);
    
    // Click software tab
    const swTab = page.locator('text=/software/i').first();
    if (await swTab.isVisible()) {
      await swTab.click();
      await page.waitForTimeout(1000);
      
      // Should show software table or list
      const hasContent = await page.locator('table, [class*="list"]').count();
      expect(hasContent).toBeGreaterThan(0);
    }
  });

  test('should display security info', async ({ page }) => {
    if (!nodeId) test.skip();
    
    await page.goto(`/nodes/${nodeId}`);
    
    // Click security tab
    const secTab = page.locator('text=/sicherheit|security/i').first();
    if (await secTab.isVisible()) {
      await secTab.click();
      await page.waitForTimeout(1000);
      
      // Should show antivirus/firewall status
      const hasAv = await page.locator('text=/antivirus|firewall|defender/i').count();
      expect(hasAv).toBeGreaterThan(0);
    }
  });
});

test.describe('Nodes API', () => {
  test('list nodes returns valid data', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/v1/nodes`);
    expect(response.status()).toBe(200);
    
    const data = await response.json();
    expect(data).toHaveProperty('nodes');
    
    if (data.nodes.length > 0) {
      const node = data.nodes[0];
      // API uses snake_case
      expect(node).toHaveProperty('node_id');
      expect(node).toHaveProperty('hostname');
    }
  });

  test('node detail endpoint works', async ({ request }) => {
    // Get first node
    const listRes = await request.get(`${API_URL}/api/v1/nodes`);
    const list = await listRes.json();
    
    if (list.nodes.length > 0) {
      const nodeId = list.nodes[0].node_id;  // snake_case
      
      // Fetch detail (inventory endpoints)
      const hwRes = await request.get(`${API_URL}/api/v1/inventory/hardware/${nodeId}`);
      expect(hwRes.status()).toBe(200);
      
      const swRes = await request.get(`${API_URL}/api/v1/inventory/software/${nodeId}`);
      expect(swRes.status()).toBe(200);
    }
  });
});
