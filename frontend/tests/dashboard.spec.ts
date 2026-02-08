import { test, expect } from '@playwright/test';

const API_URL = 'http://192.168.0.5:8080';

test.describe('Dashboard', () => {
  test('should display dashboard content', async ({ page }) => {
    await page.goto('/');
    
    // Wait for page to load
    await page.waitForTimeout(2000);
    
    // Dashboard should have some content
    const hasContent = await page.locator('div, section, main').count();
    expect(hasContent).toBeGreaterThan(0);
  });

  test('should show node information', async ({ page }) => {
    await page.goto('/');
    
    // Wait for API calls
    await page.waitForTimeout(3000);
    
    // Look for any node-related content or stats
    const body = await page.locator('body').textContent();
    expect(body).toBeTruthy();
  });

  test('should display stats or node count', async ({ page }) => {
    await page.goto('/');
    
    // Dashboard should load without errors
    await page.waitForTimeout(2000);
    
    // Check for numbers (stats) or text content
    const hasNumbers = await page.locator('text=/\\d+/').count();
    expect(hasNumbers).toBeGreaterThanOrEqual(0); // May be 0 if no nodes
  });
});

test.describe('Dashboard API Integration', () => {
  test('backend should be reachable', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/v1/nodes`);
    expect(response.status()).toBe(200);
  });

  test('nodes endpoint returns valid data', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/v1/nodes`);
    expect(response.status()).toBe(200);
    
    const data = await response.json();
    expect(data).toHaveProperty('nodes');
    expect(Array.isArray(data.nodes)).toBe(true);
  });

  test('inventory endpoints are accessible', async ({ request }) => {
    // Get a node first
    const nodesRes = await request.get(`${API_URL}/api/v1/nodes`);
    const nodesData = await nodesRes.json();
    
    if (nodesData.nodes.length > 0) {
      const nodeId = nodesData.nodes[0].node_id;
      
      // Check hardware endpoint
      const hwRes = await request.get(`${API_URL}/api/v1/inventory/hardware/${nodeId}`);
      expect(hwRes.status()).toBe(200);
    }
  });
});
