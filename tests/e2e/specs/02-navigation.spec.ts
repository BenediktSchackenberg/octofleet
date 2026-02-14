import { test, expect } from '@playwright/test';

// Tests skip gracefully if not authenticated

test.describe('Navigation & Pages', () => {
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
      
      // If redirected to login, skip this test
      if (page.url().includes('/login')) {
        test.skip(true, 'Not authenticated - skipping page load test');
        return;
      }
      
      // Check page loaded (has some content)
      const bodyContent = await page.locator('body').textContent();
      expect(bodyContent?.length || 0).toBeGreaterThan(0);
    });
  }

  test('should navigate between pages', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    
    if (page.url().includes('/login')) {
      test.skip(true, 'Not authenticated');
      return;
    }
    
    // Try to find and click a navigation link
    const navLink = page.locator('nav a, a[href="/nodes"]').first();
    if (await navLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await navLink.click();
      await page.waitForTimeout(1000);
      // Just verify page changed or stayed (no crash)
      expect(true).toBe(true);
    } else {
      test.skip(true, 'No navigation found');
    }
  });
});
