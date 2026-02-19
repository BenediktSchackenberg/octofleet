import { chromium } from '@playwright/test';

async function deploymentTest() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ storageState: 'auth-state.json' });
  const page = await context.newPage();
  
  // Deployments Page
  await page.goto('http://localhost:3000/deployments');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screenshots/deployment-list.png', fullPage: true });
  console.log('✅ Deployments Liste');
  
  // Packages Page
  await page.goto('http://localhost:3000/packages');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'screenshots/packages-7zip.png', fullPage: true });
  console.log('✅ Packages (7-Zip)');
  
  await browser.close();
}

deploymentTest();
