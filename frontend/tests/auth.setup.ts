import { test as setup, expect } from '@playwright/test';

const authFile = 'tests/.auth/user.json';

setup('authenticate', async ({ page }) => {
  // Go to login page
  await page.goto('/login');
  
  // Wait for page to load
  await page.waitForSelector('input#username', { timeout: 10000 });
  
  // Fill credentials
  await page.locator('input#username').fill('admin');
  await page.locator('input#password').fill('admin');
  
  // Click submit
  await page.locator('button[type="submit"]').click();
  
  // Wait for API response and token storage
  await page.waitForTimeout(2000);
  
  // Check if token was stored - if yes, we're logged in
  const token = await page.evaluate(() => localStorage.getItem('token'));
  expect(token).toBeTruthy();
  
  // Navigate to dashboard (window.location.href may not work in Next.js dev mode)
  if (page.url().includes('/login')) {
    await page.goto('/');
  }
  
  // Verify we're on dashboard
  await expect(page).toHaveURL('/');
  
  // Save storage state
  await page.context().storageState({ path: authFile });
});
