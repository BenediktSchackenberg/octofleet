import { chromium, FullConfig } from '@playwright/test';

const API_URL = process.env.API_URL || 'http://localhost:8080';
const ADMIN_USER = {
  username: 'admin',
  password: 'OpenClaw2026!',
  email: 'admin@test.local',
  display_name: 'Test Admin'
};

async function globalSetup(config: FullConfig) {
  console.log('🚀 Global Setup: Starting...');
  console.log(`   API_URL: ${API_URL}`);
  console.log(`   BASE_URL: ${config.projects[0].use?.baseURL}`);
  
  // Step 1: Create admin user if not exists
  console.log('📋 Checking/creating admin user...');
  try {
    const setupResponse = await fetch(`${API_URL}/api/v1/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ADMIN_USER)
    });
    
    if (setupResponse.ok) {
      console.log('✅ Admin user created');
    } else if (setupResponse.status === 400) {
      console.log('✅ Admin already exists');
    } else {
      console.log(`⚠️ Setup response: ${setupResponse.status}`);
    }
  } catch (e) {
    console.log(`⚠️ Setup request failed (may be expected): ${e}`);
  }
  
  // Step 2: Get auth token
  console.log('🔑 Authenticating...');
  const response = await fetch(`${API_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: ADMIN_USER.username,
      password: ADMIN_USER.password
    })
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Login failed: ${response.status} - ${text}`);
  }
  
  const data = await response.json();
  process.env.AUTH_TOKEN = data.access_token;
  console.log('✅ Auth token acquired');
  
  // Step 3: Set up browser state with auth
  console.log('🌐 Setting up browser auth state...');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const baseURL = config.projects[0].use?.baseURL || 'http://localhost:3000';
  
  await page.goto(`${baseURL}/login`);
  await page.waitForLoadState('networkidle');
  
  const usernameInput = page.locator('input[name="username"], input[type="text"]').first();
  const passwordInput = page.locator('input[name="password"], input[type="password"]').first();
  
  await usernameInput.fill(ADMIN_USER.username);
  await passwordInput.fill(ADMIN_USER.password);
  await page.click('button:has-text("Sign In"), button:has-text("Anmelden"), button[type="submit"]');
  await page.waitForURL('**/', { timeout: 15000 });
  
  // Save storage state for tests
  await page.context().storageState({ path: './auth-state.json' });
  await browser.close();
  
  console.log('✅ Global Setup: Complete');
}

export default globalSetup;
