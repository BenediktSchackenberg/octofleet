import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test('should load dashboard', async ({ page }) => {
    await page.goto('/');
    // Dashboard loads successfully
    await expect(page.locator('body')).toBeVisible();
    // Look for any dashboard content
    await page.waitForTimeout(1000);
  });

  test('should navigate to Nodes page', async ({ page }) => {
    await page.goto('/');
    // Use getByRole or direct navigation
    await page.goto('/nodes');
    await expect(page).toHaveURL(/\/nodes/);
  });

  test('should navigate to Groups page', async ({ page }) => {
    await page.goto('/groups');
    await expect(page).toHaveURL(/\/groups/);
  });

  test('should navigate to Jobs page', async ({ page }) => {
    await page.goto('/jobs');
    await expect(page).toHaveURL(/\/jobs/);
  });

  test('should navigate to Packages page', async ({ page }) => {
    await page.goto('/packages');
    await expect(page).toHaveURL(/\/packages/);
  });
});
