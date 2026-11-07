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

  it('a platform\'s line speaks of its deck, not of trips', () => {
    const items = statusItems({ ...base, platform: true, maxDeckCargoT: 300 })
    expect(items.map((i) => i.text)).toEqual(['81%', '16.6 из 300 т', '22/22 ед.'])
    expect(items.map((i) => i.title)).toEqual(['Загрузка площади палубы', 'Груз на палубе после рейса и допускаемая нагрузка', 'Размещено на палубе из всего, что на борту и в приходе'])
  })

  it('a semi-submersible\'s line has its VDL and KG after the run, red when over', () => {
    const semiSub = {
      netT: 500,
      momentTm: 0,
      vdlAfterT: 4_500,
      vdlMaxOperatingT: 5_000,
      kgOperatingM: 20.36,
      kgOperatingMaxM: 20.9,
      checks: [
        { id: 'semi-vdl' as const, title: 'VDL', status: 'ok' as const, detail: '' },
        { id: 'semi-kg' as const, title: 'KG', status: 'error' as const, detail: '' },
      ],
    }
    const items = statusItems({ ...base, platform: true, semiSub })
    expect(items.map((i) => i.text)).toContain('VDL 4500 из 5000 т')
    expect(items.find((i) => i.id === 'kg')).toMatchObject({ text: 'KG 20.36 из 20.90 м', tone: 'danger', target: 'vessel' })
    expect(statusItems({ ...base, platform: true, semiSub: { netT: 0, momentTm: 0, checks: [] } }).map((i) => i.id)).not.toContain('vdl')
  })

  // Audit 2026-11-07: red on a figure within its limit read as a fault of
  // the line; the line shows the limit that is broken.
  it('a semi-submersible\'s line shows the storm\'s figures when only they are over, amber without some cargo\'s weight', () => {
    const semiSub = {
      netT: 500,
      momentTm: 0,
      vdlAfterT: 4_700,
      vdlMaxOperatingT: 5_000,
      vdlMaxSurvivalT: 4_600,
      kgOperatingM: 20.36,
      kgOperatingMaxM: 20.9,
      kgSurvivalM: 22.1,
      kgSurvivalMaxM: 21.8,
      checks: [
        { id: 'semi-vdl' as const, title: 'VDL', status: 'error' as const, detail: '' },
        { id: 'semi-kg' as const, title: 'KG', status: 'error' as const, detail: '' },
      ],
    }
    const items = statusItems({ ...base, platform: true, semiSub })
    expect(items.find((i) => i.id === 'vdl')).toMatchObject({ text: 'VDL 4700 из 4600 т в шторм', tone: 'danger' })
    expect(items.find((i) => i.id === 'kg')).toMatchObject({ text: 'KG в шторм 22.10 из 21.80 м', tone: 'danger' })
    const unweighed = { ...semiSub, vdlAfterT: 4_000, kgSurvivalM: 21, checks: [{ id: 'semi-vdl' as const, title: 'VDL', status: 'warn' as const, detail: '' }] }
    expect(statusItems({ ...base, platform: true, semiSub: unweighed }).find((i) => i.id === 'vdl')).toMatchObject({ text: 'VDL 4000 из 5000 т', tone: 'warn' })
  })

  it('a self-elevating unit\'s line has its VDL and the most loaded leg, or its KG afloat', () => {
    const legs = [
      { id: 'a', name: 'Опора 1', reportT: 4_000, addedT: 37.5, afterT: 4_037.5 },
      { id: 'b', name: 'Опора 2', reportT: 4_000, addedT: 12.5, afterT: 4_012.5 },
    ]
    const elevated = {
      mode: 'elevated' as const,
      netT: 50,
      vdlAfterT: 2_850,
      vdlMaxT: 3_500,
      legs,
      maxLegLoadT: 4_030,
      checks: [{ id: 'jack-legs' as const, title: 'Нагрузки на опоры', status: 'error' as const, detail: '' }],
    }
    const items = statusItems({ ...base, platform: true, jackUp: elevated })
    expect(items.map((i) => i.text)).toContain('VDL 2850 из 3500 т')
    expect(items.find((i) => i.id === 'legs')).toMatchObject({ text: 'Опора до 4038 из 4030 т', tone: 'danger' })
    const afloat = { mode: 'afloat' as const, netT: 0, kgAfterM: 11.86, kgMaxM: 12.35, checks: [] }
    expect(statusItems({ ...base, platform: true, jackUp: afloat }).find((i) => i.id === 'kg')!.text).toBe('KG 11.86 из 12.35 м')
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
