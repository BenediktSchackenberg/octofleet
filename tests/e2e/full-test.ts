import { chromium } from '@playwright/test';

async function fullTest() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ storageState: 'auth-state.json' });
  const page = await context.newPage();
  
  console.log('🐙 Octofleet Full Visual Test\n');
  
  // Dashboard
  await page.goto('http://localhost:3000/');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'screenshots/01-dashboard.png', fullPage: true });
  console.log('✅ Dashboard');
  
  // Click auf Nodes
  await page.click('text=Nodes');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshots/02-nodes.png', fullPage: true });
  console.log('✅ Nodes Liste');
  
  // Click auf ersten Node
  const nodeLink = page.locator('a[href^="/nodes/"]').first();
  if (await nodeLink.count() > 0) {
    await nodeLink.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/03-node-detail.png', fullPage: true });
    console.log('✅ Node Detail');
  }
  
  // Services
  await page.goto('http://localhost:3000/services');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'screenshots/04-services.png', fullPage: true });
  console.log('✅ Services');
  
  // Click Templates Tab
  await page.click('text=Templates');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshots/05-templates.png', fullPage: true });
  console.log('✅ Service Templates');
  
  // Jobs
  await page.goto('http://localhost:3000/jobs');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'screenshots/06-jobs.png', fullPage: true });
  console.log('✅ Jobs');
  
  // Settings
  await page.goto('http://localhost:3000/settings');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'screenshots/07-settings.png', fullPage: true });
  console.log('✅ Settings');
  
  // Vulnerabilities
  await page.goto('http://localhost:3000/vulnerabilities');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screenshots/08-vulns.png', fullPage: true });
  console.log('✅ Vulnerabilities');
  
  // Hardware
  await page.goto('http://localhost:3000/hardware');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'screenshots/09-hardware.png', fullPage: true });
  console.log('✅ Hardware');
  
  // Live View (wenn node online)
  await page.goto('http://localhost:3000/nodes');
  await page.waitForTimeout(500);
  const liveLink = page.locator('a:has-text("Live")').first();
  if (await liveLink.count() > 0) {
    await liveLink.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'screenshots/10-live.png', fullPage: true });
    console.log('✅ Live View');
  }
  
  await browser.close();
  console.log('\n📸 Alle Screenshots in screenshots/');
}

fullTest();
