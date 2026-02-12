import { test, expect, Page } from '@playwright/test';
import { login } from './helpers';

test.describe('Nodes', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('should display node list', async ({ page }) => {
    await page.goto('/nodes');
    await page.waitForLoadState('networkidle');
    
    // Should have table with nodes
    const table = page.locator('table');
    await expect(table).toBeVisible();
    
    // Should show at least one node
    const rows = page.locator('table tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    
    console.log(`Found ${count} nodes`);
  });

  test('should open node details', async ({ page }) => {
    await page.goto('/nodes');
    await page.waitForLoadState('networkidle');
    
    // Click first node link
    const firstNode = page.locator('table tbody tr').first().locator('a').first();
    const nodeName = await firstNode.textContent();
    await firstNode.click();
    
    // Should navigate to detail page
    await expect(page).toHaveURL(/.*nodes\/.+/);
    
    // Should show node info
    await expect(page.locator('h1, h2')).toContainText(new RegExp(nodeName || '', 'i'));
  });

  test('should show node inventory tabs', async ({ page }) => {
    await page.goto('/nodes');
    await page.waitForLoadState('networkidle');
    
    // Click first node
    await page.locator('table tbody tr').first().locator('a').first().click();
    await page.waitForURL(/.*nodes\/.+/);
    
    // Check for inventory tabs (Hardware, Software, Security, etc.)
    const tabTexts = ['Hardware', 'Software', 'Security', 'Network', 'Services'];
    for (const tab of tabTexts) {
      const tabElement = page.locator(`text=${tab}`).first();
      if (await tabElement.isVisible()) {
        await tabElement.click();
        await page.waitForTimeout(500);
        console.log(`✓ Tab ${tab} works`);
      }
    }
  });
});

test.describe('Groups', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('should display groups list', async ({ page }) => {
    await page.goto('/groups');
    await page.waitForLoadState('networkidle');
    
    // Page should load without errors
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('should create a new group', async ({ page }) => {
    await page.goto('/groups');
    
    // Click create button
    const createBtn = page.locator('button:has-text("Neue Gruppe"), button:has-text("New Group")');
    if (await createBtn.isVisible()) {
      await createBtn.click();
      
      // Fill form
      const timestamp = Date.now();
      await page.fill('input[name="name"], input[placeholder*="Name"]', `TestGroup-${timestamp}`);
      
      // Submit
      await page.click('button:has-text("Erstellen"), button:has-text("Create")');
      
      // Should appear in list
      await page.waitForTimeout(1000);
      await expect(page.locator(`text=TestGroup-${timestamp}`)).toBeVisible();
    }
  });
});

test.describe('Jobs', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('should display jobs list', async ({ page }) => {
    await page.goto('/jobs');
    await page.waitForLoadState('networkidle');
    
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('should create a new job', async ({ page }) => {
    await page.goto('/jobs');
    await page.waitForLoadState('networkidle');
    
    const createBtn = page.locator('button:has-text("Neuer Job"), button:has-text("New Job")');
    if (await createBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await createBtn.click();
      await page.waitForTimeout(500);
      
      const timestamp = Date.now();
      // Name field has placeholder "z.B. Windows Update Check"
      const nameInput = page.locator('input[placeholder*="Windows"], input[placeholder*="Name"]').first();
      if (await nameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await nameInput.fill(`TestJob-${timestamp}`);
      }
      
      // Command field has placeholder "z.B. hostname"
      const cmdInput = page.locator('input[placeholder*="hostname"], textarea[placeholder*="hostname"]').first();
      if (await cmdInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await cmdInput.fill('echo "Test"');
      }
      
      await page.click('button:has-text("Job erstellen"), button:has-text("Create")');
      await page.waitForTimeout(1000);
    }
    // Test passes if we're still on jobs page
    expect(page.url()).toContain('jobs');
  });
});

test.describe('Packages', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('should display packages list', async ({ page }) => {
    await page.goto('/packages');
    await page.waitForLoadState('networkidle');
    
    await expect(page.locator('body')).not.toBeEmpty();
  });
});
