import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { ErrorScreen } from './ErrorScreen'

// Audit 2026-11-09: a page that failed to render left Next's blank
// «Application error» page — nothing to try again with, no way to keep the
// saved calculations if they are what it trips over.

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('ErrorScreen', () => {
  it('says what happened, with the error itself under «Подробности», and tries again on request', () => {
    const retry = vi.fn()
    const error = Object.assign(new Error('boom'), { digest: '42' })
    const { getByRole, getByText } = render(<ErrorScreen error={error} retry={retry} />)
    expect(getByRole('heading', { name: 'Не удалось показать расчёт' })).toBeTruthy()
    expect(getByText('boom · 42')).toBeTruthy()
    fireEvent.click(getByRole('button', { name: 'Попробовать снова' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('shows a thrown value that is not an Error as it is', () => {
    const { getByText } = render(<ErrorScreen error="не тот формат" retry={() => {}} />)
    expect(getByText('не тот формат')).toBeTruthy()
  })

  it('downloads the saved calculations exactly as they are stored', async () => {
    const saved = '{"projects":[{"id":"a"}],"activeId":"a"}'
    window.localStorage.setItem('deckload-projects', saved)
    let blob: Blob | undefined
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      blob = b as Blob
      return 'blob:copy'
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const names: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download)
    })
    const { getByRole, queryByRole } = render(<ErrorScreen error={new Error('x')} retry={() => {}} />)
    fireEvent.click(getByRole('button', { name: 'Скачать копию расчётов' }))
    expect(names).toHaveLength(1)
    expect(names[0]).toMatch(/^deckload-backup-\d{4}-\d{2}-\d{2}\.txt$/)
    expect(await blob!.text()).toBe(saved)
    expect(queryByRole('status')).toBeNull()
  })

  it('says so when nothing is saved', () => {
    const { getByRole } = render(<ErrorScreen error={new Error('x')} retry={() => {}} />)
    fireEvent.click(getByRole('button', { name: 'Скачать копию расчётов' }))
    expect(getByRole('status').textContent).toBe('В браузере нет сохранённых расчётов.')
  })
})
