import { PlaywrightTestConfig } from '@playwright/test'
import { execSync } from 'child_process'

const config: PlaywrightTestConfig = {
  testDir: './',
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  // Run tests in files in parallel
  fullyParallel: true,
  // Configure web server
  webServer: {
    command: 'npx ts-node-dev ../server/index.ts',
    port: 3000,
    timeout: 120000,
    reuseExistingServer: true,
  },
  // Reporter to use for test results
  reporter: [['list'], ['html', { outputFolder: 'playwright-report' }]],
}

export default config