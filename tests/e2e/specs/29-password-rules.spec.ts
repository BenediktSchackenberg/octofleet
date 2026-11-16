import { test, expect, type APIRequestContext } from '@playwright/test';
import { API_URL, getAuthHeaders } from './helpers';

// The change-password dialog and /change-password show the server's password rules with a
// mark per rule, and the server's reason for a rejected password in the UI language.
const dialogButton = /change password|passwort ändern|cambiar contraseña/i;
const pw = (tag: string) => `Rules-${tag}-${Math.random().toString(36).slice(2, 10)}9!`;

async function withPolicy(request: APIRequestContext, change: Record<string, unknown>, run: () => Promise<void>) {
  const headers = { ...(await getAuthHeaders()), 'Content-Type': 'application/json' };
  const url = `${API_URL}/api/v1/security/password-policy`;
  const original = await (await request.get(url, { headers })).json();
  expect((await request.put(url, { headers, data: { ...original, ...change } })).ok()).toBeTruthy();
  try {
    await run();
  } finally {
    await request.put(url, { headers, data: original });
  }
}

test.describe('password rules', () => {
  test('the dialog lists the server rules and marks them while typing', async ({ page, request }) => {
    await withPolicy(request, { min_length: 14, require_digit: true }, async () => {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: dialogButton }).click();
      const dialog = page.getByRole('dialog');
      const rules = dialog.getByTestId('password-rules');
      const length = rules.locator('li', { hasText: 'At least 14 characters' });
      const digit = rules.locator('li', { hasText: 'A digit (0–9)' });
      await expect(length).toHaveAttribute('data-state', 'open');
      await expect(digit).toHaveAttribute('data-state', 'open');

      const fields = dialog.locator('input[type="password"]');
      await fields.nth(1).fill('only-letters');
      await expect(length).toHaveAttribute('data-state', 'broken');
      await expect(digit).toHaveAttribute('data-state', 'broken');
      await fields.nth(1).fill('letters-and-2026');
      await expect(length).toHaveAttribute('data-state', 'met');
      await expect(digit).toHaveAttribute('data-state', 'met');

      // a broken rule is reported before anything is sent
      await fields.nth(0).fill('not-the-current-password');
      await fields.nth(1).fill('no-digits-here!');
      await fields.nth(2).fill('no-digits-here!');
      await dialog.locator('button[type="submit"]').click();
      await expect(page.getByText('Rule not met: A digit (0–9)')).toBeVisible();
    });
  });

  test.describe('during a required change', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('/change-password shows the rules and the server reason in German', async ({ page, request }) => {
      await withPolicy(request, { history_count: 2 }, async () => {
        const [p1, p2] = [pw('a'), pw('b')];
        const username = `rules-ui-${Date.now()}`;
        const headers = { ...(await getAuthHeaders()), 'Content-Type': 'application/json' };
        const created = await request.post(`${API_URL}/api/v1/users`, { headers, data: { username, password: p1 } });
        expect(created.ok()).toBeTruthy();
        const { id } = await created.json();
        try {
          // the reset puts p1 into the history
          const reset = await request.post(`${API_URL}/api/v1/users/${id}/password`,
            { headers, data: { new_password: p2, must_change_password: true } });
          expect(reset.ok()).toBeTruthy();

          await page.goto('/login');
          await page.evaluate(() => localStorage.setItem('locale', 'de'));
          await page.reload();
          await page.locator('input[type="text"], input[name="username"]').first().fill(username);
          await page.locator('input[type="password"]').first().fill(p2);
          await page.click('button[type="submit"]');
          await expect(page).toHaveURL(/\/change-password/, { timeout: 15000 });
          await expect(page.getByText('Ihr Passwort muss geändert werden, bevor Sie fortfahren können.')).toBeVisible();
          await expect(page.locator('form').getByRole('button', { name: 'Abmelden' })).toBeVisible();
          await expect(page.getByTestId('password-rules')).toContainText('Keines der letzten 2 Passwörter');

          const fields = page.locator('input[type="password"]');
          await fields.nth(0).fill(p2);
          await fields.nth(1).fill(p1);
          await fields.nth(2).fill(p1);
          const [response] = await Promise.all([
            page.waitForResponse(r => r.url().includes('/auth/me/password') && r.request().method() === 'POST'),
            page.locator('button[type="submit"]').click(),
          ]);
          expect(response.status()).toBe(400);
          await expect(page.getByText('Dieses Passwort wurde kürzlich verwendet. Bitte ein anderes wählen.')).toBeVisible();
          await expect(page).toHaveURL(/\/change-password/);
        } finally {
          await request.delete(`${API_URL}/api/v1/users/${id}`, { headers });
        }
      });
    });
  });
});
