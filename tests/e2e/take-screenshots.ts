import { chromium } from '@playwright/test';

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 }
  });
  const page = await context.newPage();
  
  const BASE = 'http://192.168.0.5:3000';
  const docsDir = '../../docs';
  
  // Login with correct password
  console.log('🔐 Logging in...');
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[id="username"]', 'admin');
  await page.fill('input[id="password"]', 'admin');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
  
  console.log(`✅ Now at: ${page.url()}`);
  
  // Dashboard
  console.log('📸 screenshot-dashboard.png...');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${docsDir}/screenshot-dashboard.png` });
  
  // Vulnerabilities
  console.log('📸 screenshot-vulns.png...');
  await page.goto(`${BASE}/vulnerabilities`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${docsDir}/screenshot-vulns.png` });
  
  // Alerts
  console.log('📸 screenshot-alerts.png...');
  await page.goto(`${BASE}/alerts`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${docsDir}/screenshot-alerts.png` });
  
  // Hardware
  console.log('📸 screenshot-hardware.png...');
  await page.goto(`${BASE}/hardware`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${docsDir}/screenshot-hardware.png` });
  
  // Jobs
  console.log('📸 screenshot-jobs.png...');
  await page.goto(`${BASE}/jobs`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${docsDir}/screenshot-jobs.png` });
  
  // Go to dashboard and click a node for node detail
  console.log('📸 screenshot-node.png...');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  
  // Try to click first node in sidebar
  try {
    const firstNode = page.locator('aside button, aside a').first();
    await firstNode.click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${docsDir}/screenshot-node.png` });
  } catch (e) {
    console.log('Could not get node detail, using dashboard');
    await page.screenshot({ path: `${docsDir}/screenshot-node.png` });
  }
  
  await browser.close();
  console.log('✅ All screenshots done!');
}

main().catch(console.error);
