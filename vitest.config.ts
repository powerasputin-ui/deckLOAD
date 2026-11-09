import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Skips the video intro gate so page.test.tsx keeps rendering the
    // calculator directly. (The e2e suite doesn't use this build-time flag —
    // it seeds the "seen" localStorage flags instead, see playwright.config.ts.)
    env: { NEXT_PUBLIC_SKIP_INTRO: '1' },
    // `bun run test:cov`: what the unit tests run, by file (coverage/index.html).
    // Only the app's own code; the stylesheet isn't code, and the provider
    // fails to parse it.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.css'],
      reporter: ['text-summary', 'html'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
