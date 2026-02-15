import { chromium, FullConfig } from '@playwright/test';

const API_URL = process.env.API_URL || 'http://localhost:8080';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN_USER = {
  username: 'admin',
  password: 'admin',
  email: 'admin@test.local',
  display_name: 'Test Admin'
};

async function globalSetup(config: FullConfig) {
  console.log('🚀 Global Setup: Starting...');
  console.log(`   API_URL: ${API_URL}`);
  console.log(`   BASE_URL: ${BASE_URL}`);
  
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
  
  // Step 2: Get auth token via API
  console.log('🔑 Authenticating via API...');
  let authToken: string;
  try {
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
    authToken = data.access_token;
    process.env.AUTH_TOKEN = authToken;
    console.log('✅ Auth token acquired');
  } catch (e) {
    console.error('❌ API auth failed:', e);
    throw e;
  }
  
  // Step 3: Set up browser state with auth (inject token directly)
  console.log('🌐 Setting up browser auth state...');
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  
  const baseURL = config.projects[0].use?.baseURL || BASE_URL;
  
  // First, go to the app to set the origin
  await page.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  
  // Inject auth token directly into localStorage (more reliable than form login)
  await page.evaluate((token) => {
    localStorage.setItem('authToken', token);
    localStorage.setItem('token', token);
    // Also try common auth storage patterns
    localStorage.setItem('access_token', token);
  }, authToken);
  
  // Try to also do a form-based login as backup
  console.log('📝 Attempting form login...');
  try {
    await page.goto(`${baseURL}/login`, { waitUntil: 'networkidle', timeout: 20000 });
    
    // Check if already logged in (redirected to home)
    if (!page.url().includes('/login')) {
      console.log('✅ Already authenticated (redirected)');
    } else {
      // Fill login form
      const usernameInput = page.locator('input[name="username"], input[type="text"]').first();
      const passwordInput = page.locator('input[name="password"], input[type="password"]').first();
      
      if (await usernameInput.isVisible({ timeout: 5000 })) {
        await usernameInput.fill(ADMIN_USER.username);
        await passwordInput.fill(ADMIN_USER.password);
        
        // Try multiple button selectors
        const submitButton = page.locator('button[type="submit"], button:has-text("Sign In"), button:has-text("Anmelden"), button:has-text("Login")').first();
        await submitButton.click();
        
        // Wait for navigation with more flexibility
        try {
          await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 10000 });
          console.log('✅ Form login successful');
        } catch {
          // Take screenshot for debugging
          await page.screenshot({ path: './login-debug.png', fullPage: true });
          console.log('⚠️ Form login redirect timeout - screenshot saved to login-debug.png');
          console.log(`   Current URL: ${page.url()}`);
        }
      } else {
        console.log('⚠️ Login form not found - may already be authenticated');
      }
    }
  } catch (e) {
    console.log(`⚠️ Form login skipped: ${e}`);
  }
  
  // Save storage state for tests
  await context.storageState({ path: './auth-state.json' });
  await browser.close();
  
  console.log('✅ Global Setup: Complete');
}

export default globalSetup;
