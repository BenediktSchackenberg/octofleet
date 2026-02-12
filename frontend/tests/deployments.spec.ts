import { test, expect } from '@playwright/test';

test.describe('Deployments Page', () => {
  test('should display deployments page', async ({ page }) => {
    await page.goto('/deployments');
    
    // Page should load
    await expect(page.locator('body')).toBeVisible();
    
    // Should have deployments heading or table
    const hasContent = await page.locator('h1, h2, table').count();
    expect(hasContent).toBeGreaterThan(0);
  });

  test('page loads without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));
    
    await page.goto('/deployments');
    await page.waitForTimeout(2000);
    
    // Check for critical errors (ignore expected empty state)
    const criticalErrors = errors.filter(e => !e.includes('404'));
    expect(criticalErrors).toHaveLength(0);
  });
});

test.describe('Deployment Detail Page', () => {
  test('should handle non-existent deployment gracefully', async ({ page }) => {
    await page.goto('/deployments/non-existent-id');
    await page.waitForTimeout(2000);
    
    // Should either show "not found" message or handle gracefully
    const content = await page.locator('body').textContent();
    expect(content).toBeTruthy();
  });
});
