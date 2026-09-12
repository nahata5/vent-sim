import { defineConfig, devices } from '@playwright/test';

const port = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${port}/`,
    trace: 'retain-on-failure',
  },
  projects: [
    // Desktop suite (unchanged by the mobile layout, D-020).
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: [/mobile\.spec\.ts/, /tablet\.spec\.ts/] },
    // Phone (412 × 839, touch) and tablet (800 × 1280) layouts, both Chromium.
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
    { name: 'tablet', use: { ...devices['Nexus 10'] }, testMatch: /tablet\.spec\.ts/ },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
