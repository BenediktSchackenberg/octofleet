import { Page } from '@playwright/test';

export async function login(page: Page) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.locator('input[type="text"], input[name="username"]').first().fill('admin');
  await page.locator('input[type="password"], input[name="password"]').first().fill('Octofleet2026!');
  await page.click('button:has-text("Sign In"), button:has-text("Anmelden"), button[type="submit"]');
  await page.waitForURL('**/', { timeout: 10000 });
}
