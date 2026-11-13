import { test, expect } from '@playwright/test';

// The date format picked in the language menu (31.12.2026, 12/31/2026, 2026-12-31) shows as labeled
// in every language - the separator belongs to the format, not to the language
const cases = [
  { locale: 'en', order: 'dmy', example: '31.12.2026' },
  { locale: 'es', order: 'dmy', example: '31.12.2026' },
  { locale: 'de', order: 'dmy', example: '31.12.2026' },
  { locale: 'en', order: 'mdy', example: '12/31/2026' },
  { locale: 'de', order: 'mdy', example: '12/31/2026' },
  { locale: 'en', order: 'ymd', example: '2026-12-31' },
];

for (const { locale, order, example } of cases) {
  test(`date format ${order} in ${locale}: ${example}`, async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(([l, o]) => {
      localStorage.setItem('locale', l);
      localStorage.setItem('dateOrder', o);
      localStorage.setItem('timeFormat', '24h');
    }, [locale, order]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const menuTitle = { de: 'Sprache, Uhrzeit und Datum', es: 'Idioma, hora y fecha', en: 'Language, time and date' }[locale];
    await page.locator(`button[title="${menuTitle}"]`).click();
    await expect(page.getByText(new RegExp(`: ${example.replace(/[./]/g, '\\$&')}, 14:30`))).toBeVisible();
  });
}
