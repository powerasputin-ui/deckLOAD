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
    // calculator directly — see playwright.config.ts for the matching e2e flag.
    env: { NEXT_PUBLIC_SKIP_INTRO: '1' },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
