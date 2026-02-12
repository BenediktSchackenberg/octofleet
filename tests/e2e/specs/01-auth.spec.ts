import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    // Clear any existing auth
    await page.context().clearCookies();
  });

  test('should show login page when not authenticated', async ({ page }) => {
    await page.goto('/');
    // Should redirect to login
    await expect(page).toHaveURL(/.*login.*/);
  });

  test('should login with valid credentials', async ({ page }) => {
    await page.goto('/login');
    
    await page.fill('input[name="username"]', 'admin');
    await page.fill('input[name="password"]', 'OpenClaw2026!');
    await page.click('button[type="submit"]');
    
    // Should redirect to dashboard
    await page.waitForURL('**/');
    await expect(page.locator('h1')).toContainText(/Dashboard|Inventory/i);
  });

  test('should reject invalid credentials', async ({ page }) => {
    await page.goto('/login');
    
    await page.fill('input[name="username"]', 'admin');
    await page.fill('input[name="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');
    
    // Should show error
    await expect(page.locator('text=Ungültig')).toBeVisible({ timeout: 5000 });
  });

  test('should logout successfully', async ({ page }) => {
    // Login first
    await page.goto('/login');
    await page.fill('input[name="username"]', 'admin');
    await page.fill('input[name="password"]', 'OpenClaw2026!');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/');
    
    // Find and click logout
    await page.click('text=Logout');
    
    // Should redirect to login
    await expect(page).toHaveURL(/.*login.*/);
  });
});
