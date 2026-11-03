import { test, expect } from '@playwright/test';
import { API_URL, getAuthHeaders } from './helpers';

// After an admin reset with "require change", the user must be able to change the password
// on /change-password without being signed out by the page's background requests.
const pw = (tag: string) => `Forced-${tag}-${Math.random().toString(36).slice(2, 10)}9!`;

test.describe('forced password change', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('user changes the password on /change-password and can continue', async ({ page, request }) => {
    const [p1, p2, p3] = [pw('a'), pw('b'), pw('c')];
    const username = `forced-ui-${Date.now()}`;
    const headers = { ...(await getAuthHeaders()), 'Content-Type': 'application/json' };
    const created = await request.post(`${API_URL}/api/v1/users`, { headers, data: { username, password: p1 } });
    expect(created.ok()).toBeTruthy();
    const { id } = await created.json();
    const reset = await request.post(`${API_URL}/api/v1/users/${id}/password`, { headers, data: { new_password: p2, must_change_password: true } });
    expect(reset.ok()).toBeTruthy();

    const signIn = async (password: string) => {
      await page.goto('/login');
      await page.locator('input[type="text"], input[name="username"]').first().fill(username);
      await page.locator('input[type="password"]').first().fill(password);
      await page.click('button[type="submit"]');
    };

    await signIn(p2);
    await expect(page).toHaveURL(/\/change-password/, { timeout: 15000 });
    await page.waitForTimeout(15000); // background requests of the page have run several times by now
    await expect(page).toHaveURL(/\/change-password/);

    const fields = page.locator('input[type="password"]');
    await fields.nth(0).fill(p2);
    await fields.nth(1).fill(p3);
    await fields.nth(2).fill(p3);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/login/, { timeout: 15000 });

    await signIn(p3);
    await expect(page).not.toHaveURL(/\/(login|change-password)/, { timeout: 15000 });
  });
});
