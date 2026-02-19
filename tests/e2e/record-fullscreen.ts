import { chromium } from '@playwright/test';

async function recordFullscreen() {
  const browser = await chromium.launch();
  
  // Use exact viewport size - no gray borders
  const context = await browser.newContext({
    storageState: 'auth-state.json',
    viewport: { width: 1280, height: 720 },
    recordVideo: {
      dir: 'videos/',
      size: { width: 1280, height: 720 }
    }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  
  console.log('🎬 Recording Fullscreen Demo...\n');
  
  // Dashboard
  console.log('📊 Dashboard...');
  await page.goto('http://localhost:3000/');
  await page.waitForTimeout(3500);
  
  // Nodes
  console.log('🖥️ Nodes...');
  await page.goto('http://localhost:3000/nodes');
  await page.waitForTimeout(3000);
  
  // Hardware
  console.log('💾 Hardware...');
  await page.goto('http://localhost:3000/hardware');
  await page.waitForTimeout(3000);
  
  // Jobs - with scroll
  console.log('⚡ Jobs...');
  await page.goto('http://localhost:3000/jobs');
  await page.waitForTimeout(2000);
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(2000);
  
  // Packages + 7-Zip detail
  console.log('📦 Packages...');
  await page.goto('http://localhost:3000/packages');
  await page.waitForTimeout(2000);
  await page.click('text=7-Zip').catch(() => {});
  await page.waitForTimeout(3000);
  
  // Deployments
  console.log('🚀 Deployments...');
  await page.goto('http://localhost:3000/deployments');
  await page.waitForTimeout(3000);
  
  // Services + Templates
  console.log('🔧 Services...');
  await page.goto('http://localhost:3000/services');
  await page.waitForTimeout(2000);
  await page.click('text=Templates').catch(() => {});
  await page.waitForTimeout(2500);
  
  // Vulnerabilities
  console.log('🛡️ Vulnerabilities...');
  await page.goto('http://localhost:3000/vulnerabilities');
  await page.waitForTimeout(3500);
  
  // Settings
  console.log('⚙️ Settings...');
  await page.goto('http://localhost:3000/settings');
  await page.waitForTimeout(3000);
  
  // Back to Dashboard
  console.log('🏠 Dashboard final...');
  await page.goto('http://localhost:3000/');
  await page.waitForTimeout(2000);
  
  await context.close();
  await browser.close();
  
  console.log('\n✅ Fullscreen recording complete!');
}

recordFullscreen().catch(console.error);
