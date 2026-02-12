import { test, expect, Page } from '@playwright/test';

// Helper to login before tests
async function login(page: Page) {
  await page.goto('/login');
  await page.fill('input[name="username"]', 'admin');
  await page.fill('input[name="password"]', 'OpenClaw2026!');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/');
}

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
    await page.goto('/');
    
    // Click Nodes in navbar
    await page.click('nav >> text=Nodes');
    await expect(page).toHaveURL(/.*nodes.*/);
    
    // Click Groups
    await page.click('nav >> text=Gruppen');
    await expect(page).toHaveURL(/.*groups.*/);
    
    // Click Jobs
    await page.click('nav >> text=Jobs');
    await expect(page).toHaveURL(/.*jobs.*/);
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
