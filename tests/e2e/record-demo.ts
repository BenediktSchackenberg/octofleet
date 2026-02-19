import { chromium } from '@playwright/test';

async function recordDemo() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    storageState: 'auth-state.json',
    recordVideo: {
      dir: 'videos/',
      size: { width: 1920, height: 1080 }
    }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  
  console.log('🎬 Recording Octofleet Demo...\n');
  
  // 1. Dashboard
  console.log('📊 Dashboard...');
  await page.goto('http://localhost:3000/');
  await page.waitForTimeout(3000);
  
  // 2. Nodes
  console.log('🖥️ Nodes...');
  await page.goto('http://localhost:3000/nodes');
  await page.waitForTimeout(2500);
  
  // 3. Hardware
  console.log('💾 Hardware...');
  await page.goto('http://localhost:3000/hardware');
  await page.waitForTimeout(2500);
  
  // 4. Jobs
  console.log('⚡ Jobs...');
  await page.goto('http://localhost:3000/jobs');
  await page.waitForTimeout(2500);
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(1500);
  
  // 5. Packages
  console.log('📦 Packages...');
  await page.goto('http://localhost:3000/packages');
  await page.waitForTimeout(2000);
  await page.click('text=7-Zip').catch(() => {});
  await page.waitForTimeout(2500);
  
  // 6. Deployments
  console.log('🚀 Deployments...');
  await page.goto('http://localhost:3000/deployments');
  await page.waitForTimeout(2500);
  
  // 7. Services
  console.log('🔧 Services...');
  await page.goto('http://localhost:3000/services');
  await page.waitForTimeout(2000);
  await page.click('text=Templates').catch(() => {});
  await page.waitForTimeout(2000);
  
  // 8. Vulnerabilities
  console.log('🛡️ Vulnerabilities...');
  await page.goto('http://localhost:3000/vulnerabilities');
  await page.waitForTimeout(3000);
  
  // 9. Settings
  console.log('⚙️ Settings...');
  await page.goto('http://localhost:3000/settings');
  await page.waitForTimeout(2000);
  await page.click('text=Users').catch(() => {});
  await page.waitForTimeout(1500);
  await page.goto('http://localhost:3000/settings');
  await page.waitForTimeout(500);
  await page.click('text=Audit Log').catch(() => {});
  await page.waitForTimeout(2000);
  
  // 10. Back to Dashboard + Dark Mode
  console.log('🌙 Dark Mode...');
  await page.goto('http://localhost:3000/');
  await page.waitForTimeout(1500);
  // Click dark mode toggle (moon icon button)
  const darkModeBtn = page.locator('button').filter({ hasText: '' }).locator('svg').first();
  await darkModeBtn.click().catch(async () => {
    // Fallback: click by position near top right
    await page.mouse.click(1040, 27);
  });
  await page.waitForTimeout(3000);
  
  await context.close();
  await browser.close();
  
  console.log('\n✅ Demo recording complete!');
}

recordDemo().catch(console.error);
