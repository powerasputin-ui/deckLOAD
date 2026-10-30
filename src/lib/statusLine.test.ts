import { describe, it, expect } from 'vitest'
import { statusItems, type StatusLineInput } from './statusLine'
import type { Check } from './checks'

const base: StatusLineInput = {
  utilization: 0.812,
  weightKg: 16_600,
  placedUnits: 22,
  totalUnits: 22,
  tripCount: 1,
}

const texts = (s: StatusLineInput) => statusItems(s).map((i) => i.text)

describe('status line', () => {
  it('shows load, weight and units for a single trip without vessel data', () => {
    expect(texts(base)).toEqual(['81%', '16.6 т', '22/22 ед.'])
  })

  it('names the vessel limit next to the weight and flags going over it', () => {
    expect(texts({ ...base, maxDeckCargoT: 2550 })[1]).toBe('16.6 из 2550 т')
    const over = statusItems({ ...base, maxDeckCargoT: 10 }).find((i) => i.id === 'weight')!
    expect(over.tone).toBe('danger')
  })

  it('counts trips only when there is more than one', () => {
    expect(texts({ ...base, tripCount: 2 })).toContain('2 рейса')
    expect(texts({ ...base, tripCount: 5 })).toContain('5 рейсов')
  })

  it('shows GM of the worse state with the booklet verdict, and marks an estimate', () => {
    expect(texts({ ...base, gm: { valueM: 2.771, status: 'ok', estimated: false, state: 'departure' } })).toContain('GM 2.77 м (отход) ✓')
    expect(texts({ ...base, gm: { valueM: 1.5, status: 'warn', estimated: false, state: 'arrival' } })).toContain('GM 1.50 м (приход) ⚠')
    expect(texts({ ...base, gm: { valueM: 0.1, status: 'error', estimated: true, state: 'arrival' } })).toContain('GM ≈0.10 м (приход) ✕')
    // Not worked out though the vessel's data is there: said, not guessed.
    const missing = statusItems({ ...base, gmMissing: 'Не задана высота палубы над килем' }).find((i) => i.id === 'gm')!
    expect(missing).toMatchObject({ text: 'GM — ⚠', title: 'Не задана высота палубы над килем', tone: 'warn', target: 'stability' })
    const tone = (status: 'ok' | 'warn' | 'error') =>
      statusItems({ ...base, gm: { valueM: 1, status, estimated: false, state: 'arrival' } }).find((i) => i.id === 'gm')!.tone
    expect([tone('ok'), tone('warn'), tone('error')]).toEqual([undefined, 'warn', 'danger'])
  })

  it('counts the plan\'s ✕ and ⚠, as far as there are any, and names them', () => {
    const check = (id: Check['id'], title: string, status: Check['status']): Check => ({ id, title, status, detail: '', target: 'checks' })
    const checks = [
      check('capacity', 'Вместимость и рейсы', 'ok'),
      check('deck-weight', 'Вес палубы', 'error'),
      check('zones', 'Зоны т/м²', 'warn'),
      check('lashing', 'Крепление', 'warn'),
      check('stability', 'Остойчивость', 'none'),
    ]
    const items = statusItems({ ...base, checks })
    expect(items.map((i) => i.text).slice(-2)).toEqual(['✕ 1', '⚠ 2'])
    const errors = items.find((i) => i.id === 'errors')!
    expect(errors).toMatchObject({ tone: 'danger', target: 'checks', title: '1 ошибка: Вес палубы' })
    expect(errors.label).toBe('Проверки — 1 ошибка: Вес палубы')
    expect(items.find((i) => i.id === 'warnings')).toMatchObject({ tone: 'warn', title: '2 предупреждения: Зоны т/м², Крепление' })
    expect(texts({ ...base, checks: [check('capacity', 'Вместимость и рейсы', 'ok')] })).toEqual(['81%', '16.6 т', '22/22 ед.'])
  })

  it('leads each item to its section', () => {
    const targets = Object.fromEntries(
      statusItems({ ...base, tripCount: 2, gm: { valueM: 1, status: 'ok', estimated: false, state: 'departure' } }).map((i) => [i.id, i.target])
    )
    expect(targets).toEqual({ load: 'placement', weight: 'vessel', units: 'cargo', trips: 'placement', gm: 'stability' })
  })
})
