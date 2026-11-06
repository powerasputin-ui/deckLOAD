import { describe, it, expect } from 'vitest'
import { EMPTY_SEMI_SUB, evaluateSemiSub, kgLimitAt, type SemiSubData } from './semiSub'

// Spec 2026-11-06, 7.2: the example worked through — Δ 50 000 t, KG 20.0 m,
// 500 t of pipe at 40 m, ballast at 4 m: KG₁ 20.36 m; Δшт 45 000 t: KGшт
// 22.18 m.
const unit: SemiSubData = {
  operating: { draftM: 21, displacementT: 50_000, vdlMaxT: 5_000, kgLimit: [{ draftM: 19, kgMaxM: 20.5 }, { draftM: 23, kgMaxM: 21.3 }] },
  survival: { draftM: 17, displacementT: 45_000, vdlMaxT: 4_600, kgLimit: [{ draftM: 17, kgMaxM: 22.5 }] },
  ballastVcgM: 4,
  report: { draftM: 21, displacementT: 50_000, kgM: 20, vdlT: 4_000, ballastT: 9_000 },
  transfers: [],
}
const pipe = { weightT: 500, vcgM: 40 }
const check = (r: ReturnType<typeof evaluateSemiSub>, id: string) => r.checks.find((c) => c.id === id)!

describe('evaluateSemiSub', () => {
  it('holds the draught with ballast: the example of the spec', () => {
    const r = evaluateSemiSub(unit, [pipe], [], true)
    expect(r.netT).toBe(500)
    expect(r.kgOperatingM).toBeCloseTo(20.36, 6)
    expect(r.kgSurvivalM).toBeCloseTo(998_000 / 45_000, 6)
    expect(r.kgSurvivalM!.toFixed(2)).toBe('22.18')
    expect(r.vdlAfterT).toBe(4_500)
    expect(r.ballastAfterT).toBe(8_500)
    expect(r.ballastSurvivalT).toBe(3_500)
  })

  it('judges both modes: ✓ only when both are within, ✕ when either is over', () => {
    const r = evaluateSemiSub(unit, [pipe], [], true)
    expect(check(r, 'semi-vdl')).toMatchObject({ status: 'ok', detail: 'в работе 4500 т при допустимом 5000 т · в шторм 4500 т при допустимом 4600 т' })
    // KG limit in operation at 21 m: halfway between 20.5 and 21.3 — 20.9.
    expect(check(r, 'semi-kg')).toMatchObject({ status: 'ok', detail: 'в работе 20.36 м при допустимом 20.90 м · в шторм 22.18 м при допустимом 22.50 м' })
    expect(check(r, 'semi-ballast')).toMatchObject({ status: 'ok', detail: 'После рейса 8500 т · в шторм 3500 т' })

    // 1 000 t: within in operation (KG 20.72 m of 20.90, VDL at its limit),
    // over on the way to survival (KG 22.58 m of 22.50, VDL 5 000 t of 4 600).
    const heavy = evaluateSemiSub(unit, [pipe, pipe], [], true)
    expect(heavy.kgOperatingM).toBeCloseTo(20.72, 9)
    expect(heavy.kgSurvivalM).toBeCloseTo(1_016_000 / 45_000, 9)
    expect(check(heavy, 'semi-vdl')).toMatchObject({
      status: 'error',
      detail: 'в работе 5000 т при допустимом 5000 т · в шторм 5000 т при допустимом 4600 т — в шторм придётся снимать груз',
    })
    expect(check(heavy, 'semi-kg')).toMatchObject({
      status: 'error',
      detail: 'в работе 20.72 м при допустимом 20.90 м · в шторм 22.58 м при допустимом 22.50 м — больше допустимого при уходе в шторм',
    })
  })

  it('cargo leaving and fuel taken lower the KG; fuel brought counts in the VDL', () => {
    const lighter = evaluateSemiSub(unit, [], [{ weightT: 300, vcgM: 40 }], true)
    expect(lighter.netT).toBe(-300)
    expect(lighter.kgOperatingM).toBeLessThan(20)
    const fuel = evaluateSemiSub({ ...unit, transfers: [{ id: 'f', name: 'Топливо', weightT: 200, vcgM: 6 }] }, [], [], true)
    expect(fuel.vdlAfterT).toBe(4_200)
    expect(fuel.kgOperatingM).toBeCloseTo((50_000 * 20 + 200 * 6 - 200 * 4) / 50_000, 9)
  })

  it('a transfer without its height counts in the VDL and stops the KG; a row just added changes nothing', () => {
    const water = evaluateSemiSub({ ...unit, transfers: [{ id: 't', name: 'Вода', weightT: 150 }] }, [], [], true)
    expect(water.vdlAfterT).toBe(4_150)
    expect(check(water, 'semi-kg').detail).toBe('Прочий приход и расход: не задан ЦТ у «Вода»')
    const empty = evaluateSemiSub({ ...unit, transfers: [{ id: 'e', name: '' }] }, [], [], true)
    expect(empty.vdlAfterT).toBe(4_000)
    expect(empty.kgOperatingM).toBe(20)
  })

  it('says what is missing rather than judging without it', () => {
    const r = evaluateSemiSub(EMPTY_SEMI_SUB, [pipe], [], true)
    expect(r.checks.map((c) => [c.id, c.status, c.detail])).toEqual([
      ['semi-vdl', 'none', 'Нет VDL из суточного отчёта'],
      ['semi-kg', 'none', 'Нет водоизмещения и KG из суточного отчёта'],
      ['semi-ballast', 'none', 'Балласт на борту не указан'],
    ])
    expect(check(evaluateSemiSub(unit, [pipe], [], false), 'semi-kg').detail).toBe('Не задана высота палубы над основной плоскостью')
    expect(check(evaluateSemiSub({ ...unit, ballastVcgM: undefined }, [pipe], [], true), 'semi-kg').detail).toBe('Не задана высота откачиваемого балласта')
    // One mode judged, the other not: no ✓.
    const halfway = evaluateSemiSub({ ...unit, survival: { ...unit.survival, vdlMaxT: undefined } }, [pipe], [], true)
    expect(check(halfway, 'semi-vdl')).toMatchObject({ status: 'none', detail: 'в работе 4500 т при допустимом 5000 т · в шторм: предел в шторм не задан' })
  })

  it('a draught outside the KG table is no limit, and ballast short is an error', () => {
    const off = evaluateSemiSub({ ...unit, report: { ...unit.report, draftM: 24 } }, [pipe], [], true)
    expect(check(off, 'semi-kg').detail).toContain('в работе: осадка вне таблицы KG')
    const short = evaluateSemiSub({ ...unit, report: { ...unit.report, ballastT: 5_000 } }, [pipe], [], true)
    expect(check(short, 'semi-ballast')).toMatchObject({ status: 'error', detail: 'Для ухода в шторм не хватает 500 т' })
  })
})

describe('kgLimitAt', () => {
  const rows = [{ draftM: 23, kgMaxM: 21.3 }, { draftM: 19, kgMaxM: 20.5 }]
  it('reads between rows in any order, and nothing outside the table', () => {
    expect(kgLimitAt(rows, 21)).toBeCloseTo(20.9, 9)
    expect(kgLimitAt(rows, 19)).toBe(20.5)
    expect(kgLimitAt(rows, 18)).toBeUndefined()
    expect(kgLimitAt(undefined, 21)).toBeUndefined()
  })
  it('a row counts for a draught a rounding away', () => {
    expect(kgLimitAt([{ draftM: 21, kgMaxM: 20.8 }], 21.04)).toBe(20.8)
    expect(kgLimitAt([{ draftM: 21, kgMaxM: 20.8 }], 21.2)).toBeUndefined()
  })
})
