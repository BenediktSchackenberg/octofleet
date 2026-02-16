import { chromium } from '@playwright/test';

const screenshots = [
  { url: 'http://192.168.0.5:3000', name: 'screenshot-dashboard.png' },
  { url: 'http://192.168.0.5:3000/nodes/CONTROLLER', name: 'screenshot-node.png' },
  { url: 'http://192.168.0.5:3000/vulnerabilities', name: 'screenshot-vulns.png' },
  { url: 'http://192.168.0.5:3000/alerts', name: 'screenshot-alerts.png' },
  { url: 'http://192.168.0.5:3000/hardware', name: 'screenshot-hardware.png' },
];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await context.newPage();

for (const s of screenshots) {
  console.log(`📸 ${s.name}...`);
  await page.goto(s.url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `../../docs/${s.name}`, fullPage: false });
  console.log(`   ✅ Saved`);
}

await browser.close();
console.log('\n✅ All screenshots done!');
