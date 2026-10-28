import { test, expect } from '@playwright/test';

// Octofleet is often opened over plain HTTP on the LAN, where browsers offer no
// navigator.clipboard. The copy buttons must work there too, so the API is removed here.
test('Add Device copies the install command without navigator.clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => {
    (window as unknown as { __clipboard: Clipboard }).__clipboard = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  });
  await page.goto('/nodes', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /add device|gerät hinzufügen/i }).first().click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('install-script');
  await dialog.getByRole('button', { name: /^(copy|kopieren)$/i }).first().click();
  await expect(dialog.getByRole('button', { name: /^(copied|kopiert)$/i }).first()).toBeVisible();

  const copied = await page.evaluate(() => (window as unknown as { __clipboard: Clipboard }).__clipboard.readText());
  expect(copied).toContain('/api/v1/onboarding/install-script');
});
