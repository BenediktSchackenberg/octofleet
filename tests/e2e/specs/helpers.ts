import { Page } from '@playwright/test';

export const API_URL = process.env.API_URL || 'http://localhost:8080';
const API_KEY = process.env.TEST_API_KEY || 'a9544b6300030bda29268e0f207b88ba446f6a31669a7c63';

export async function login(page: Page) {
  const password = process.env.TEST_PASSWORD || 'admin';
  await page.goto('/login');
  await page.waitForTimeout(1000);
  await page.locator('input[type="text"], input[name="username"]').first().fill('admin');
  await page.locator('input[type="password"], input[name="password"]').first().fill(password);
  await page.click('button:has-text("Sign In"), button:has-text("Anmelden"), button[type="submit"]');
  await page.waitForURL('**/', { timeout: 10000 });
}

let adminToken: Promise<string> | undefined;

/** Login token of the admin (TEST_PASSWORD), fetched once per worker. */
function getAdminToken(): Promise<string> {
  adminToken ??= (async () => {
    const res = await fetch(`${API_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: process.env.TEST_PASSWORD || 'admin' }),
    });
    if (!res.ok) throw new Error(`admin login failed: ${res.status}`);
    return (await res.json()).access_token;
  })();
  return adminToken;
}

/**
 * Headers for API calls in tests. Routes that read or change fleet data, jobs or users need a
 * user account, so this sends the admin's token; the agent key stays for agent routes.
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  return {
    'X-API-Key': API_KEY,
    Authorization: `Bearer ${await getAdminToken()}`,
  };
}
