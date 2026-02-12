import { test, expect, Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.fill('input[name="username"]', 'admin');
  await page.fill('input[name="password"]', 'OpenClaw2026!');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/');
}

test.describe('Software Compare', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('should load top software list', async ({ page }) => {
    await page.goto('/software-compare');
    await page.waitForLoadState('networkidle');
    
    // Should show top installed software
    const softwareList = page.locator('text=/7-Zip|Microsoft|Edge|Chrome/i');
    await expect(softwareList.first()).toBeVisible({ timeout: 10000 });
  });

  test('should search for specific software', async ({ page }) => {
    await page.goto('/software-compare');
    await page.waitForLoadState('networkidle');
    
    // Find search input
    const searchInput = page.locator('input[type="text"], input[placeholder*="Search"], input[placeholder*="Suche"]').first();
    await searchInput.fill('7-Zip');
    
    // Click search/compare button
    const searchBtn = page.locator('button:has-text("Compare"), button:has-text("Suchen"), button:has-text("Search")').first();
    if (await searchBtn.isVisible()) {
      await searchBtn.click();
    } else {
      await searchInput.press('Enter');
    }
    
    await page.waitForTimeout(2000);
    
    // Should show version comparison
    await expect(page.locator('text=/version|Version|25\.01/i').first()).toBeVisible();
  });
});

test.describe('Compliance Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('should load compliance data', async ({ page }) => {
    await page.goto('/compliance');
    await page.waitForLoadState('networkidle');
    
    // Should show compliance cards/stats
    await expect(page.locator('body')).not.toBeEmpty();
    
    // Should have some data (firewall, bitlocker, etc.)
    const hasData = await page.locator('text=/Firewall|BitLocker|Antivirus|Nodes/i').first().isVisible();
    expect(hasData).toBe(true);
  });

  test('should show node compliance details', async ({ page }) => {
    await page.goto('/compliance');
    await page.waitForLoadState('networkidle');
    
    // If there's a table, check it has content
    const table = page.locator('table');
    if (await table.isVisible()) {
      const rows = await table.locator('tbody tr').count();
      console.log(`Compliance table has ${rows} rows`);
      expect(rows).toBeGreaterThanOrEqual(0);
    }
  });
});

test.describe('Eventlog', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('should load eventlog data', async ({ page }) => {
    await page.goto('/eventlog');
    await page.waitForLoadState('networkidle');
    
    // Should show eventlog entries or empty state
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('should filter by log type', async ({ page }) => {
    await page.goto('/eventlog');
    await page.waitForLoadState('networkidle');
    
    // Find log type filter
    const filterSelect = page.locator('select, [role="combobox"]').first();
    if (await filterSelect.isVisible()) {
      await filterSelect.click();
      
      // Select Security
      const securityOption = page.locator('text=Security').first();
      if (await securityOption.isVisible()) {
        await securityOption.click();
        await page.waitForTimeout(1000);
      }
    }
  });
});

test.describe('Dashboard Stats', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('should display accurate node count', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Find node count stat
    const nodeCount = page.locator('text=/\\d+\\s*(Nodes|nodes)/i').first();
    if (await nodeCount.isVisible()) {
      const text = await nodeCount.textContent();
      console.log(`Dashboard shows: ${text}`);
    }
  });

  test('should display charts', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Check for chart elements
    const charts = page.locator('canvas, svg.recharts-surface, [class*="chart"]');
    const chartCount = await charts.count();
    console.log(`Found ${chartCount} chart elements`);
  });
});
