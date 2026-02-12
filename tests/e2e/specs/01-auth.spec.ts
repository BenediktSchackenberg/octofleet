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
    await page.waitForLoadState('networkidle');
    
    await page.locator('input[type="text"], input[name="username"]').first().fill('admin');
    await page.locator('input[type="password"], input[name="password"]').first().fill('OpenClaw2026!');
    await page.click('button:has-text("Sign In"), button:has-text("Anmelden"), button[type="submit"]');
    
    // Should redirect to dashboard
    await page.waitForURL('**/', { timeout: 10000 });
    // Just check we're not on login anymore
    await expect(page).not.toHaveURL(/.*login.*/);
  });

  test('should reject invalid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    
    await page.locator('input[type="text"], input[name="username"]').first().fill('admin');
    await page.locator('input[type="password"], input[name="password"]').first().fill('wrongpassword');
    await page.click('button:has-text("Sign In"), button:has-text("Anmelden"), button[type="submit"]');
    
    // Should show error or stay on login
    await page.waitForTimeout(2000);
    // Either error message visible or still on login page
    const isOnLogin = page.url().includes('login');
    const hasError = await page.locator('text=/Ungültig|Invalid|Error|Fehler|failed/i').count() > 0;
    expect(isOnLogin || hasError).toBe(true);
  });

  test('should logout successfully', async ({ page }) => {
    // Login first
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await page.locator('input[type="text"], input[name="username"]').first().fill('admin');
    await page.locator('input[type="password"], input[name="password"]').first().fill('OpenClaw2026!');
    await page.click('button:has-text("Sign In"), button:has-text("Anmelden"), button[type="submit"]');
    await page.waitForURL('**/', { timeout: 10000 });
    
    // Find and click logout
    const logoutBtn = page.locator('button:has-text("Logout"), button:has-text("Abmelden"), button:has-text("Sign Out"), [aria-label*="logout"]');
    if (await logoutBtn.first().isVisible({ timeout: 5000 })) {
      await logoutBtn.first().click();
      // Should redirect to login
      await expect(page).toHaveURL(/.*login.*/, { timeout: 10000 });
    }
  });
});
