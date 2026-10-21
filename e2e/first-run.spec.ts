import { test, expect } from '@playwright/test'

// The suite seeds both "seen" flags (playwright.config.ts) so ordinary specs
// open straight on the calculator. These cover the gate itself.
test.describe('First-run gate', () => {
  test('a returning visitor goes straight to the calculator and never requests the intro video', async ({ page }) => {
    const introRequests: string[] = []
    page.on('request', (r) => {
      if (/deckload-intro/.test(r.url())) introRequests.push(r.url())
    })

    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Очистить' })).toBeVisible()
    // Give any late preload a chance to fire before concluding there was none.
    await page.waitForTimeout(1500)

    expect(introRequests).toEqual([])
    await expect(page.getByRole('button', { name: 'Пропустить тур' })).toHaveCount(0)
  })

  test.describe('a first-time visitor', () => {
    test.use({ storageState: { cookies: [], origins: [] } })

    test('sees the intro, then the calculator with the product tour — and neither comes back after being dismissed', async ({ page }) => {
      test.setTimeout(60_000)
      await page.goto('/')
      // Two ways out of the intro: the corner "Пропустить", and — once the
      // video ends, errors or stalls (headless Chromium can't decode this
      // mp4, so here after ~4 s) — the full-screen "Войти на сайт" overlay,
      // which then covers the corner button. Take whichever is available.
      // `force`: once the video is over the intro swaps in a WebGL shader
      // backdrop that starves a software-rendered page of animation frames,
      // so Playwright's "wait until stable" check can take many seconds.
      // Idempotent on purpose: with the page that starved, a click can land
      // but still time out on its acknowledgement — the retry must then see
      // "already inside" instead of waiting for a button that is gone.
      await expect(async () => {
        if (await page.getByRole('button', { name: 'Очистить' }).isVisible()) return
        const enter = page.getByRole('button', { name: 'Войти на сайт' })
        if (await enter.isVisible()) await enter.click({ force: true, timeout: 5000 })
        else await page.getByRole('button', { name: 'Пропустить', exact: true }).click({ force: true, timeout: 5000 })
      }).toPass({ timeout: 40_000 })

      await expect(page.getByRole('button', { name: 'Очистить' })).toBeVisible()
      const skipTour = page.getByRole('button', { name: 'Пропустить тур' })
      await expect(skipTour).toBeVisible()
      await skipTour.click()
      await expect(skipTour).toBeHidden()

      await page.reload()
      await expect(page.getByRole('button', { name: 'Очистить' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Пропустить', exact: true })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Пропустить тур' })).toHaveCount(0)
    })
  })
})
