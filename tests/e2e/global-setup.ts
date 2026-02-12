import { chromium, FullConfig } from '@playwright/test';

const API_URL = process.env.API_URL || 'http://192.168.0.5:8080';

async function globalSetup(config: FullConfig) {
  console.log('🚀 Global Setup: Authenticating...');
  
  // Get auth token for tests
  const response = await fetch(`${API_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'admin',
      password: 'OpenClaw2026!'
    })
  });
  
  if (!response.ok) {
    throw new Error(`Login failed: ${response.status}`);
  }
  
  const data = await response.json();
  
  // Store token for tests
  process.env.AUTH_TOKEN = data.access_token;
  
  // Also set up browser state with auth
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  await page.goto(`${config.projects[0].use?.baseURL}/login`);
  await page.fill('input[name="username"]', 'admin');
  await page.fill('input[name="password"]', 'OpenClaw2026!');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/');
  
  // Save storage state
  await page.context().storageState({ path: './auth-state.json' });
  await browser.close();
  
  console.log('✅ Global Setup: Complete');
}

export default globalSetup;
