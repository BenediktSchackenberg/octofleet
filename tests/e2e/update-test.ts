import { chromium } from '@playwright/test';

async function updateTest() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ storageState: 'auth-state.json' });
  const page = await context.newPage();
  
  // Deployments with both
  await page.goto('http://localhost:3000/deployments');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screenshots/deployment-update.png', fullPage: true });
  console.log('✅ Beide Deployments (Install + Update)');
  
  // Package detail with 2 versions
  await page.goto('http://localhost:3000/packages');
  await page.waitForTimeout(1000);
  await page.click('text=7-Zip');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screenshots/package-7zip-detail.png', fullPage: true });
  console.log('✅ 7-Zip Package Detail (2 Versionen)');
  
  await browser.close();
}

updateTest();
