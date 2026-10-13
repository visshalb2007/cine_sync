import { defineConfig, devices } from '@playwright/test'
import path from 'path'

export default defineConfig({
  testDir: __dirname,
  testMatch: /.*\.spec\.ts/,
  timeout: 45000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    launchOptions: {
      args: [
        '--autoplay-policy=no-user-gesture-required',
        '--use-fake-ui-for-media-stream',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
    },
  },
  webServer: {
    command: 'npx tsx server/index.ts',
    url: 'http://localhost:3000/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    env: {
      DB_PATH: ':memory:',
      PORT: '3000',
      NODE_ENV: 'test',
      RECONNECT_GRACE_MS: '3000',
      SOCKET_PING_INTERVAL: '1000',
      SOCKET_PING_TIMEOUT: '1000',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
