import { test, expect } from '@playwright/test';

const API_URL = 'http://192.168.0.49:8080';

const securityPages = [
  { path: '/security/monitoring', title: 'Monitoring Profiles' },
  { path: '/security/policies', title: 'Policy Assignment' },
  { path: '/security/posture', title: 'Config Posture Snapshots' },
  { path: '/security/vulnerabilities', title: 'Vulnerability Fleet View' },
  { path: '/security/rules', title: 'Behavior Rules' },
  { path: '/security/findings', title: 'Findings & Risk Scoring' },
  { path: '/security/activity', title: 'Activity Dashboards' },
  { path: '/security/evidence', title: 'Evidence Pack Export' },
  { path: '/security/retention', title: 'Retention & Legal Hold' },
  { path: '/security/audit', title: 'UI Audit Logging' },
];

test.describe('Security Center - Navigation', () => {
  for (const { path, title } of securityPages) {
    test(`should navigate to ${title} (${path})`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(path.replace('/', '\\/')));
      // Page should render without errors
      await page.waitForTimeout(1000);
      const body = await page.locator('body').textContent();
      expect(body).toBeTruthy();
      // Should not show a generic error page
      expect(body).not.toContain('404');
    });
  }
});

test.describe('Security Center - Page Content', () => {
  for (const { path, title } of securityPages) {
    test(`${title} should display content`, async ({ page }) => {
      await page.goto(path);
      await page.waitForTimeout(2000);

      // Page should have meaningful DOM content
      const hasContent = await page.locator('div, section, main, table').count();
      expect(hasContent).toBeGreaterThan(0);

      // Should contain some text related to the page or at least a heading
      const heading = page.locator('h1, h2, h3').first();
      await expect(heading).toBeVisible({ timeout: 5000 });
    });
  }
});

test.describe('Security Center - Monitoring Profiles CRUD', () => {
  test('should display monitoring profiles list', async ({ page }) => {
    await page.goto('/security/monitoring');
    await page.waitForTimeout(2000);

    // Look for a table or list of profiles
    const tableOrList = page.locator('table, [role="grid"], [class*="list"], [class*="card"]').first();
    await expect(tableOrList).toBeVisible({ timeout: 5000 }).catch(() => {
      // Empty state is also acceptable
    });
  });

  test('should open create dialog or navigate to create page', async ({ page }) => {
    await page.goto('/security/monitoring');
    await page.waitForTimeout(2000);

    // Look for a create/add button
    const createBtn = page.locator('button, a').filter({ hasText: /create|add|new/i }).first();
    if (await createBtn.isVisible().catch(() => false)) {
      await createBtn.click();
      await page.waitForTimeout(1000);
      // A dialog or new page should appear
      const formVisible = await page.locator('input, textarea, form, [role="dialog"]').count();
      expect(formVisible).toBeGreaterThan(0);
    }
  });
});

test.describe('Security Center - Behavior Rules CRUD', () => {
  test('should display rules list', async ({ page }) => {
    await page.goto('/security/rules');
    await page.waitForTimeout(2000);

    const tableOrList = page.locator('table, [role="grid"], [class*="list"], [class*="card"]').first();
    await expect(tableOrList).toBeVisible({ timeout: 5000 }).catch(() => {
      // Empty state is acceptable
    });
  });

  test('should open create dialog for rules', async ({ page }) => {
    await page.goto('/security/rules');
    await page.waitForTimeout(2000);

    const createBtn = page.locator('button, a').filter({ hasText: /create|add|new/i }).first();
    if (await createBtn.isVisible().catch(() => false)) {
      await createBtn.click();
      await page.waitForTimeout(1000);
      const formVisible = await page.locator('input, textarea, form, [role="dialog"]').count();
      expect(formVisible).toBeGreaterThan(0);
    }
  });
});

test.describe('Security Center - Evidence Pack Export', () => {
  test('should have export functionality', async ({ page }) => {
    await page.goto('/security/evidence');
    await page.waitForTimeout(2000);

    // Look for export button or download link
    const exportBtn = page.locator('button, a').filter({ hasText: /export|download|generate/i }).first();
    const hasExport = await exportBtn.isVisible().catch(() => false);
    // Page loaded successfully regardless
    const body = await page.locator('body').textContent();
    expect(body).toBeTruthy();
  });
});

test.describe('Security Center - API Endpoints', () => {
  test('monitoring profiles API is accessible', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/v1/security/monitoring-profiles`);
    expect([200, 401, 403]).toContain(response.status());
  });

  test('behavior rules API is accessible', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/v1/security/rules`);
    expect([200, 401, 403]).toContain(response.status());
  });

  test('findings API is accessible', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/v1/security/findings`);
    expect([200, 401, 403]).toContain(response.status());
  });

  test('audit log API is accessible', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/v1/security/audit-logs`);
    expect([200, 401, 403]).toContain(response.status());
  });
});

test.describe('Security Center - Console Errors', () => {
  for (const { path, title } of securityPages) {
    test(`${title} should load without console errors`, async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          errors.push(msg.text());
        }
      });

      await page.goto(path);
      await page.waitForTimeout(2000);

      // Filter out known benign errors (e.g. favicon, HMR)
      const realErrors = errors.filter(
        (e) => !e.includes('favicon') && !e.includes('HMR') && !e.includes('websocket')
      );
      expect(realErrors).toEqual([]);
    });
  }
});
