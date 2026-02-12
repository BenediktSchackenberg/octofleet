import { test, expect, Page } from '@playwright/test';

// Test different user roles
const roles = [
  { username: 'admin', password: 'OpenClaw2026!', expectedAccess: ['users', 'api-keys', 'audit', 'settings'] },
  // Add more roles as needed
  // { username: 'operator', password: 'xxx', expectedAccess: ['nodes', 'jobs', 'packages'] },
  // { username: 'viewer', password: 'xxx', expectedAccess: ['nodes', 'groups'] },
];

test.describe('Role-Based Access Control', () => {
  test('admin should have full access', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="username"]', 'admin');
    await page.fill('input[name="password"]', 'OpenClaw2026!');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/');
    
    // Admin should see all nav items
    const adminPages = ['/users', '/audit', '/api-keys', '/settings'];
    
    for (const p of adminPages) {
      await page.goto(p);
      await page.waitForLoadState('networkidle');
      
      // Should not redirect to login or show access denied
      const url = page.url();
      expect(url).not.toContain('login');
      
      const accessDenied = await page.locator('text=/Access Denied|Zugriff verweigert|403/i').count();
      expect(accessDenied).toBe(0);
    }
  });

  test('should show user info in navbar', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="username"]', 'admin');
    await page.fill('input[name="password"]', 'OpenClaw2026!');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/');
    
    // Should show username somewhere
    await expect(page.locator('text=/admin/i').first()).toBeVisible();
  });
});

test.describe('API Key Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="username"]', 'admin');
    await page.fill('input[name="password"]', 'OpenClaw2026!');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/');
  });

  test('should load API keys page', async ({ page }) => {
    await page.goto('/api-keys');
    await page.waitForLoadState('networkidle');
    
    await expect(page.locator('h1, h2')).toContainText(/API/i);
  });

  test('should create new API key', async ({ page }) => {
    await page.goto('/api-keys');
    await page.waitForLoadState('networkidle');
    
    const createBtn = page.locator('button:has-text("Erstellen"), button:has-text("Create"), button:has-text("New")');
    if (await createBtn.first().isVisible()) {
      await createBtn.first().click();
      
      const timestamp = Date.now();
      await page.fill('input[name="name"], input[placeholder*="Name"]', `TestKey-${timestamp}`);
      
      const submitBtn = page.locator('button:has-text("Erstellen"), button:has-text("Create"), button[type="submit"]');
      await submitBtn.first().click();
      
      await page.waitForTimeout(1000);
      
      // Should show the new key or success message
      const success = await page.locator(`text=TestKey-${timestamp}`).isVisible() 
                   || await page.locator('text=/success|erfolgreich|created/i').isVisible();
      expect(success).toBe(true);
    }
  });
});

test.describe('Audit Log', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="username"]', 'admin');
    await page.fill('input[name="password"]', 'OpenClaw2026!');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/');
  });

  test('should display audit log entries', async ({ page }) => {
    await page.goto('/audit');
    await page.waitForLoadState('networkidle');
    
    // Should show audit entries (login events from tests)
    const table = page.locator('table');
    if (await table.isVisible()) {
      const rows = await table.locator('tbody tr').count();
      console.log(`Audit log has ${rows} entries`);
      expect(rows).toBeGreaterThan(0);
    }
  });

  test('should filter audit by action type', async ({ page }) => {
    await page.goto('/audit');
    await page.waitForLoadState('networkidle');
    
    // Find filter
    const filterSelect = page.locator('select, [role="combobox"]').first();
    if (await filterSelect.isVisible()) {
      await filterSelect.click();
      
      const loginOption = page.locator('text=login');
      if (await loginOption.isVisible()) {
        await loginOption.click();
        await page.waitForTimeout(1000);
      }
    }
  });
});
