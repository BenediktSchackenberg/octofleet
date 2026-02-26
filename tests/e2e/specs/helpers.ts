import { Page } from '@playwright/test';

export const API_URL = process.env.API_URL || 'http://localhost:8080';
const API_KEY = process.env.TEST_API_KEY || 'octofleet-inventory-dev-key';

export async function login(page: Page) {
  const password = process.env.TEST_PASSWORD || 'Octofleet2026!';
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.locator('input[type="text"], input[name="username"]').first().fill('admin');
  await page.locator('input[type="password"], input[name="password"]').first().fill(password);
  await page.click('button:has-text("Sign In"), button:has-text("Anmelden"), button[type="submit"]');
  await page.waitForURL('**/', { timeout: 10000 });
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
  return {
    'X-API-Key': API_KEY,
  };
}
