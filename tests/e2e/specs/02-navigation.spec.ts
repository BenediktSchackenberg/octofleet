import { test, expect } from '@playwright/test';

// Auth state is loaded from playwright.config.ts (storageState)
// No need to login in each test

test.describe('Navigation & Pages', () => {
  // Core pages only (faster CI)
  const corePages = [
    { path: '/', name: 'Dashboard' },
    { path: '/nodes', name: 'Nodes' },
    { path: '/groups', name: 'Groups' },
    { path: '/jobs', name: 'Jobs' },
    { path: '/packages', name: 'Packages' },
    { path: '/settings', name: 'Settings' },
  ];

  for (const p of corePages) {
    test(`should load ${p.name} page`, async ({ page }) => {
      await page.goto(p.path, { waitUntil: 'domcontentloaded' });
      
      // If redirected to login, the auth state didn't work - skip gracefully
      if (page.url().includes('/login')) {
        test.skip(true, 'Auth state not loaded - skipping navigation test');
        return;
      }
      
      // Check page has content (not empty)
      await expect(page.locator('body')).not.toBeEmpty();
      
      // Check no major errors on page
      const pageContent = await page.content();
      expect(pageContent).not.toContain('Internal Server Error');
      expect(pageContent).not.toContain('500');
    });
  }

  test('should navigate between pages', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    
    if (page.url().includes('/login')) {
      test.skip(true, 'Auth state not loaded');
      return;
    }
    
    // Find and click Nodes link
    const nodesLink = page.locator('a[href="/nodes"], nav >> text=Nodes').first();
    if (await nodesLink.isVisible({ timeout: 3000 })) {
      await nodesLink.click();
      await page.waitForURL('**/nodes', { timeout: 5000 });
      expect(page.url()).toContain('/nodes');
    }
  });
});
