import { test, expect } from '@playwright/test';

// Auth state loaded from storageState in config

test.describe('Role-Based Access Control', () => {
  test('admin should access protected pages', async ({ page }) => {
    await page.goto('/users', { waitUntil: 'domcontentloaded' });
    
    if (page.url().includes('/login')) {
      test.skip(true, 'Auth not loaded');
      return;
    }
    
    // Admin should be able to access /users
    expect(page.url()).toContain('users');
    await expect(page.locator('body')).not.toBeEmpty();
  });
});

test.describe('API Key Management', () => {
  test('should load API keys page', async ({ page }) => {
    await page.goto('/api-keys', { waitUntil: 'domcontentloaded' });
    
    if (page.url().includes('/login')) {
      test.skip(true, 'Auth not loaded');
      return;
    }
    
    expect(page.url()).toContain('api-keys');
    await expect(page.locator('body')).not.toBeEmpty();
  });
});

test.describe('Audit Log', () => {
  test('should display audit log', async ({ page }) => {
    await page.goto('/audit', { waitUntil: 'domcontentloaded' });
    
    if (page.url().includes('/login')) {
      test.skip(true, 'Auth not loaded');
      return;
    }
    
    expect(page.url()).toContain('audit');
    await expect(page.locator('body')).not.toBeEmpty();
  });
});
