import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,  // Reduced retries for faster CI
  workers: 1,
  timeout: 30000,  // 30s per test
  reporter: [
    ['html', { outputFolder: '../reports/playwright' }],
    ['json', { outputFile: '../reports/playwright/results.json' }],
    ['list']
  ],
  
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',  // Disabled for faster CI
    // Use stored auth state from global-setup
    storageState: './auth-state.json',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  globalSetup: './global-setup.ts',
});
