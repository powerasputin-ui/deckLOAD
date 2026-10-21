import { defineConfig, devices } from '@playwright/test'

// A dedicated port, not :3000: that is where a dev server — or an entirely
// different app — usually already lives, and `reuseExistingServer` would then
// quietly run the whole suite against it (e2e/global-setup.ts now refuses to
// start if the thing on the port isn't DeckLoad). Override with E2E_PORT.
const PORT = Number(process.env.E2E_PORT ?? 3210)
const BASE_URL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    // Both first-run experiences (the intro video and the product tour) start
    // out dismissed, so specs open straight on the calculator through the
    // real production gate; e2e/first-run.spec.ts overrides this to cover the
    // gate itself. (Replaces the old build-time NEXT_PUBLIC_SKIP_INTRO flag,
    // which skipped the intro but not the tour.)
    storageState: {
      cookies: [],
      origins: [
        {
          origin: BASE_URL,
          localStorage: [
            { name: 'deckload-intro-seen', value: '1' },
            { name: 'deckload-tour-seen', value: '1' },
          ],
        },
      ],
    },
    // For machines whose installed Chromium isn't the build this Playwright
    // version pins: E2E_CHROMIUM_PATH=/path/to/chrome-or-headless_shell
    launchOptions: process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'bun run build && bun run start',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180 * 1000,
    env: { PORT: String(PORT) },
  },
})
