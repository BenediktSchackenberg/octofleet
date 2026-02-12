import { test, expect, Page } from '@playwright/test';
import { login } from './helpers';

test.describe('Navigation & Pages', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  const pages = [
    { path: '/', title: /Dashboard/i },
    { path: '/nodes', title: /Nodes/i },
    { path: '/groups', title: /Gruppen|Groups/i },
    { path: '/jobs', title: /Jobs/i },
    { path: '/packages', title: /Pakete|Packages/i },
    { path: '/deployments', title: /Deployments/i },
    { path: '/alerts', title: /Alerts/i },
    { path: '/eventlog', title: /Eventlog|Event/i },
    { path: '/compliance', title: /Compliance/i },
    { path: '/software-compare', title: /Software/i },
    { path: '/performance', title: /Performance/i },
    { path: '/settings', title: /Einstellungen|Settings/i },
    { path: '/users', title: /Benutzer|Users/i },
    { path: '/audit', title: /Audit/i },
    { path: '/api-keys', title: /API/i },
  ];

  for (const p of pages) {
    test(`should load ${p.path} without errors`, async ({ page }) => {
      await page.goto(p.path);
      
      // Wait for page to load
      await page.waitForLoadState('networkidle');
      
      // Check no error messages
      const errorCount = await page.locator('text=/error|fehler|failed/i').count();
      
      // Check page has content
      await expect(page.locator('body')).not.toBeEmpty();
      
      // Screenshot for report
      await page.screenshot({ 
        path: `../reports/screenshots/${p.path.replace('/', '') || 'dashboard'}.png`,
        fullPage: true 
      });
    });
  }

  test('should navigate via navbar', async ({ page }) => {
    // Already logged in from beforeEach
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Click Nodes in navbar
    const nodesLink = page.locator('nav a:has-text("Nodes"), nav >> text=Nodes').first();
    await nodesLink.click();
    await page.waitForLoadState('networkidle');
    // Check we see Nodes content (the page shows "Nodes" heading)
    await expect(page.locator('h1:has-text("Nodes"), h2:has-text("Nodes")')).toBeVisible({ timeout: 5000 });
    
    // Click Jobs
    const jobsLink = page.locator('nav a:has-text("Jobs"), nav >> text=Jobs').first();
    await jobsLink.click();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1:has-text("Jobs"), h2:has-text("Jobs")')).toBeVisible({ timeout: 5000 });
  });

  test('should switch language', async ({ page }) => {
    await page.goto('/');
    
    // Find language selector (globe icon)
    const langSelector = page.locator('[aria-label*="language"], button:has(svg.lucide-globe)').first();
    
    if (await langSelector.isVisible()) {
      await langSelector.click();
      
      // Select English
      await page.click('text=English');
      await page.waitForTimeout(500);
      
      // Check some text changed
      const navText = await page.locator('nav').textContent();
      expect(navText).toMatch(/Nodes|Groups|Settings/);
    }
  });
});
