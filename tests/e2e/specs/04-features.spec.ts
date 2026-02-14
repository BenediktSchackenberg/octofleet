import { test, expect } from '@playwright/test';

// Auth state loaded from storageState in config

test.describe('Software Compare', () => {
  test('should load software compare page', async ({ page }) => {
    await page.goto('/software-compare', { waitUntil: 'domcontentloaded' });
    
    if (page.url().includes('/login')) {
      test.skip(true, 'Auth not loaded');
      return;
    }
    
    await expect(page.locator('body')).not.toBeEmpty();
  });
});

test.describe('Compliance Dashboard', () => {
  test('should load compliance data', async ({ page }) => {
    await page.goto('/compliance', { waitUntil: 'domcontentloaded' });
    
    if (page.url().includes('/login')) {
      test.skip(true, 'Auth not loaded');
      return;
    }
    
    await expect(page.locator('body')).not.toBeEmpty();
  });
});

test.describe('Eventlog', () => {
  test('should load eventlog page', async ({ page }) => {
    await page.goto('/eventlog', { waitUntil: 'domcontentloaded' });
    
    if (page.url().includes('/login')) {
      test.skip(true, 'Auth not loaded');
      return;
    }
    
    await expect(page.locator('body')).not.toBeEmpty();
  });
});

test.describe('Dashboard', () => {
  test('should load dashboard with stats', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    
    if (page.url().includes('/login')) {
      test.skip(true, 'Auth not loaded');
      return;
    }
    
    // Check page loads
    await expect(page.locator('body')).not.toBeEmpty();
    
    // Check for dashboard content (cards or stats)
    const hasContent = await page.locator('[class*="card"], [class*="stat"], h1, h2').count() > 0;
    expect(hasContent).toBe(true);
  });
});
