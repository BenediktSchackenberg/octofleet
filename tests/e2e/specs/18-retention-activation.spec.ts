import { test, expect } from '@playwright/test';

for (const managed of [false, true]) {
  test(`retention: ${managed ? 'fresh install saves normally' : 'upgrade needs confirmed activation'}`, async ({ page }) => {
    let item = {
      category: 'security_events', table: 'events_normalized', keep_days: 30,
      compress_after_days: 7, legal_hold: false, management_enabled: managed,
      default_keep_days: 30, default_compress_after_days: 7, applied: managed,
      size_bytes: 0, oldest: null, jobs: [],
    };
    const writes: Record<string, unknown>[] = [];
    await page.addInitScript(() => localStorage.setItem('locale', 'en'));
    await page.route('**/api/v1/retention**', async route => {
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON();
        writes.push(body);
        item = { ...item, ...body, applied: true };
        await route.fulfill({ json: item });
      } else {
        await route.fulfill({ json: { retention: [item] } });
      }
    });
    await page.goto('/settings/retention');
    const keep = page.locator('input[type="number"]').first();
    await expect(keep).toHaveValue('30');
    if (!managed) {
      await expect(page.getByText(/Upgrade protection:/)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Legal hold off' })).toBeDisabled();
      page.once('dialog', dialog => dialog.dismiss());
      await page.getByRole('button', { name: 'Activate retention', exact: true }).click();
      expect(writes).toHaveLength(0);
    } else {
      await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    }
    await keep.fill('60');
    if (!managed) page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: managed ? 'Save' : 'Activate retention', exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toMatchObject({ keep_days: 60, compress_after_days: 7, management_enabled: true });
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await expect(page.getByText(/Upgrade protection:/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Legal hold off' })).toBeEnabled();
  });
}
