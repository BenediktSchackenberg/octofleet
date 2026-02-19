import { chromium } from '@playwright/test';

async function takeScreenshots() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ storageState: 'auth-state.json' });
  const page = await context.newPage();
  
  const pages = [
    { url: 'http://localhost:3000/', name: 'dashboard' },
    { url: 'http://localhost:3000/nodes', name: 'nodes' },
    { url: 'http://localhost:3000/jobs', name: 'jobs' },
    { url: 'http://localhost:3000/services', name: 'services' },
    { url: 'http://localhost:3000/settings', name: 'settings' },
    { url: 'http://localhost:3000/hardware', name: 'hardware' },
    { url: 'http://localhost:3000/vulnerabilities', name: 'vulnerabilities' },
  ];
  
  for (const p of pages) {
    await page.goto(p.url);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `screenshots/${p.name}.png`, fullPage: true });
    console.log(`✅ ${p.name}`);
  }
  
  await browser.close();
  console.log('\n📸 All screenshots saved to screenshots/');
}

takeScreenshots();
