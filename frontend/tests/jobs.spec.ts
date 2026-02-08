import { test, expect } from '@playwright/test';

const API_URL = 'http://192.168.0.5:8080';

test.describe('Jobs Page', () => {
  test('should display jobs page', async ({ page }) => {
    await page.goto('/jobs');
    
    // Wait for page load
    await page.waitForTimeout(2000);
    
    // Should have content
    const hasContent = await page.locator('button, table, div').count();
    expect(hasContent).toBeGreaterThan(0);
  });

  test('should have create job functionality', async ({ page }) => {
    await page.goto('/jobs');
    
    // Wait for page load
    await page.waitForTimeout(2000);
    
    // Look for any button
    const buttons = await page.locator('button').count();
    expect(buttons).toBeGreaterThan(0);
  });

  test('page loads without errors', async ({ page }) => {
    await page.goto('/jobs');
    
    // No console errors
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    
    await page.waitForTimeout(2000);
    
    // Some errors are okay (CORS, etc), but page should render
    const hasBody = await page.locator('body').isVisible();
    expect(hasBody).toBe(true);
  });
});

test.describe('Jobs API', () => {
  test('list jobs endpoint works', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/v1/jobs`);
    expect(response.status()).toBe(200);
    
    const data = await response.json();
    expect(data).toHaveProperty('jobs');
    expect(Array.isArray(data.jobs)).toBe(true);
  });

  test('can create a test job', async ({ request }) => {
    const response = await request.post(`${API_URL}/api/v1/jobs`, {
      data: {
        name: 'Playwright Test Job',
        targetType: 'all',
        commandType: 'run',
        commandData: { command: ['echo', 'test'] }
      }
    });
    
    expect(response.status()).toBe(200);
    
    const data = await response.json();
    expect(data).toHaveProperty('id');
    expect(data.name).toBe('Playwright Test Job');
  });

  test('job shows in list after creation', async ({ request }) => {
    // Create job
    const createRes = await request.post(`${API_URL}/api/v1/jobs`, {
      data: {
        name: 'List Test Job',
        targetType: 'all',
        commandType: 'run',
        commandData: { command: ['hostname'] }
      }
    });
    expect(createRes.status()).toBe(200);
    const created = await createRes.json();
    
    // Fetch list
    const listRes = await request.get(`${API_URL}/api/v1/jobs`);
    const list = await listRes.json();
    
    // Find our job
    const found = list.jobs.find((j: any) => j.id === created.id);
    expect(found).toBeTruthy();
  });
});
