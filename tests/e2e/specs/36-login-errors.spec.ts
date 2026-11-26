import { test, expect } from '@playwright/test';

// The login page says what went wrong: only a 401 means a wrong password. A request that never
// reaches the server (network, proxy, CORS, a browser blocking it) said "Invalid username or
// password" too, and people reset passwords that were right.
test.describe('login error messages', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  const signIn = async (page: import('@playwright/test').Page) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => localStorage.setItem('locale', 'en'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#username').fill('admin');
    await page.locator('#password').fill(`wrong-${Date.now()}`);
    await page.locator('button[type="submit"]').click();
  };

  test('wrong password: invalid username or password', async ({ page }) => {
    await signIn(page);
    await expect(page.getByText('Invalid username or password')).toBeVisible();
  });

  test('server not reachable: says so and names the server, not the password', async ({ page }) => {
    await page.route('**/api/v1/auth/login', (route) => route.abort('blockedbyclient'));
    await signIn(page);
    const message = page.getByText(/cannot be reached – your password was not checked/);
    await expect(message).toBeVisible();
    await expect(message).toContainText(/http:\/\/[^ ]+:\d+/);
    await expect(page.getByText('Invalid username or password')).toHaveCount(0);
  });

  test('server error and disabled account: their own messages', async ({ page }) => {
    let status = 500;
    await page.route('**/api/v1/auth/login', (route) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ detail: 'x' }) }));
    await signIn(page);
    await expect(page.getByText('The server could not sign you in (error 500)', { exact: false })).toBeVisible();
    status = 403;
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText('This account is disabled.')).toBeVisible();
  });
});
