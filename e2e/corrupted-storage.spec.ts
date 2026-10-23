import { test, expect } from '@playwright/test'
import { sectionBar } from './helpers'
import { readFile } from 'node:fs/promises'

// An unreadable saved record must survive until the user decides what to do
// with it. hydrate() never wrote over it itself, but the page's autosave did,
// ~400 ms after load — right after the toast had promised the opposite.
const DAMAGED = '{"projects":[{"id":"x","name":"Рейс 12", TRUNCATED'
const BASE_URL = `http://127.0.0.1:${process.env.E2E_PORT ?? 3210}`

test.describe('Corrupted saved data', () => {
  test.use({
    storageState: {
      cookies: [],
      origins: [
        {
          origin: BASE_URL,
          localStorage: [
            { name: 'deckload-intro-seen', value: '1' },
            { name: 'deckload-tour-seen', value: '1' },
            { name: 'deckload-projects', value: DAMAGED },
          ],
        },
      ],
    },
  })

  test('is kept until the user chooses to discard it, and can be downloaded first', async ({ page }) => {
    const stored = () => page.evaluate(() => window.localStorage.getItem('deckload-projects'))

    await page.goto('/')
    await expect(page.getByText('Сохранённые данные повреждены')).toBeVisible()
    // The demo project is loaded into the calculator, which arms the
    // debounced autosave — give it well past its 400 ms to (not) fire.
    await expect(sectionBar(page)).toBeVisible()
    await page.waitForTimeout(1500)
    expect(await stored()).toBe(DAMAGED)

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Скачать копию' }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/^deckload-damaged-data-.*\.txt$/)
    expect(await readFile(await download.path(), 'utf8')).toBe(DAMAGED)
    // The warning stays, so the way out is still there.
    await page.getByRole('button', { name: 'Удалить и начать заново' }).click()

    await expect(page.getByText('Сохранённые данные повреждены')).toBeHidden()
    await expect.poll(stored).not.toBe(DAMAGED)
    const saved = JSON.parse((await stored()) ?? 'null')
    expect(saved.projects.map((p: { name: string }) => p.name)).toEqual(['Демо-расчёт'])
  })
})
