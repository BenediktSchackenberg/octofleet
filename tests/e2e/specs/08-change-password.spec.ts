import { test, expect } from '@playwright/test';

const dialogButton = /change password|passwort ändern|cambiar contraseña/i;

// A wrong current password is used throughout, so the account's password stays
// unchanged for the other tests.
test.describe('Change password dialog', () => {
  test('reaches the API and reports a wrong current password', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: dialogButton }).click();

    const dialog = page.getByRole('dialog');
    const fields = dialog.locator('input[type="password"]');
    await fields.nth(0).fill('not-the-current-password');
    await fields.nth(1).fill('e2e-new-password-2026');
    await fields.nth(2).fill('e2e-new-password-2026');

    const [response] = await Promise.all([
      page.waitForResponse(r => r.url().includes('/auth/me/password') && r.request().method() === 'POST'),
      dialog.locator('button[type="submit"]').click(),
    ]);
    expect(new URL(response.url()).pathname).toBe('/api/v1/auth/me/password');
    expect(response.status()).toBe(403);
    await expect(page.getByText('Current password is incorrect')).toBeVisible();
  });

  test('clears the typed passwords when it is closed', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: dialogButton }).click();

    const fields = page.getByRole('dialog').locator('input[type="password"]');
    await fields.nth(0).fill('typed-current-password');
    await fields.nth(1).fill('typed-new-password-2026');
    await fields.nth(2).fill('typed-new-password-2026');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    await page.getByRole('button', { name: dialogButton }).click();
    for (let i = 0; i < 3; i++) {
      await expect(fields.nth(i)).toHaveValue('');
    }
  });
});
