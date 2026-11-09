import { describe, it, expect } from 'vitest'
import { EMPTY_JACK_UP, evaluateJackUp, legPoint, legShares, type JackUpData } from './jackUp'

// Spec 2026-11-06, 11.3.

describe('legShares', () => {
  it('on three legs is the exact static answer', () => {
    const k = legShares([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }], 2, 3)!
    expect(k[0]).toBeCloseTo(0.5, 12)
    expect(k[1]).toBeCloseTo(0.2, 12)
    expect(k[2]).toBeCloseTo(0.3, 12)
  })

  it('on four legs is the plane: the spec\'s example, 100 t at (5; 0) on a 20 × 16 m rectangle', () => {
    const legs = [{ x: 10, y: 8 }, { x: -10, y: 8 }, { x: -10, y: -8 }, { x: 10, y: -8 }]
    const k = legShares(legs, 5, 0)!.map((s) => s * 100)
    expect(k[0]).toBeCloseTo(37.5, 9)
    expect(k[1]).toBeCloseTo(12.5, 9)
    expect(k[2]).toBeCloseTo(12.5, 9)
    expect(k[3]).toBeCloseTo(37.5, 9)
    // At the legs' centre, equal shares.
    for (const s of legShares(legs, 0, 0)!) expect(s).toBeCloseTo(0.25, 12)
  })

  it('keeps the equilibrium for any legs and any point', () => {
    let seed = 7
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 60 - 10
    for (let trial = 0; trial < 200; trial++) {
      const legs = Array.from({ length: 3 + (trial % 4) }, () => ({ x: rand(), y: rand() }))
      const x = rand()
      const y = rand()
      const k = legShares(legs, x, y)
      if (!k) continue
      expect(k.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 8)
      expect(k.reduce((s, v, i) => s + v * legs[i].x, 0)).toBeCloseTo(x, 6)
      expect(k.reduce((s, v, i) => s + v * legs[i].y, 0)).toBeCloseTo(y, 6)
    }
  })

  it('has no answer on fewer than three legs or on legs in one line', () => {
    expect(legShares([{ x: 0, y: 0 }, { x: 10, y: 0 }], 5, 0)).toBeNull()
    expect(legShares([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }], 5, 1)).toBeNull()
    expect(legShares([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 }], 5, 1)).toBeNull()
  })
})

describe('legPoint', () => {
  it('reads from the stern by the bow\'s end', () => {
    const leg = { id: 'l', name: '1', fromSternM: 5, fromPortM: 3 }
    expect(legPoint(leg, { lengthM: 40, forwardIsPositiveY: true })).toEqual({ x: 3, y: 5 })
    expect(legPoint(leg, { lengthM: 40, forwardIsPositiveY: false })).toEqual({ x: 3, y: 35 })
    expect(legPoint({ ...leg, fromPortM: undefined }, { lengthM: 40, forwardIsPositiveY: true })).toBeNull()
  })
})

// Legs at the corners of 20 × 16 m about (15; 20) on a deck 40 m long.
const unit: JackUpData = {
  mode: 'elevated',
  afloat: { vdlMaxT: 2_500, tpcTPerCm: 20, maxDraftM: 4.5, kgLimit: [{ draftM: 4, kgMaxM: 12.5 }, { draftM: 4.5, kgMaxM: 12 }] },
  elevated: { vdlMaxT: 3_500, vdlStormMaxT: 3_000, maxLegLoadT: 4_040 },
  legs: [
    { id: 'a', name: 'Опора 1', fromSternM: 28, fromPortM: 25 },
    { id: 'b', name: 'Опора 2', fromSternM: 28, fromPortM: 5 },
    { id: 'c', name: 'Опора 3', fromSternM: 12, fromPortM: 5 },
    { id: 'd', name: 'Опора 4', fromSternM: 12, fromPortM: 25 },
  ],
  report: { draftM: 4, displacementT: 8_000, kgM: 12, vdlT: 2_800, legLoadsT: { a: 4_000, b: 4_000, c: 4_000, d: 4_000 } },
  transfers: [],
}
const deck = { lengthM: 40, forwardIsPositiveY: true }
const check = (r: ReturnType<typeof evaluateJackUp>, id: string) => r.checks.find((c) => c.id === id)!

describe('evaluateJackUp, elevated', () => {
  it('adds each leg\'s share of the cargo to the report\'s loads', () => {
    // 100 t 5 m to starboard of the legs' centre: 37.5 t on the two near legs.
    const r = evaluateJackUp(unit, [{ weightT: 100, vcgM: 0, x: 20, y: 20 }], [], deck, true)
    expect(r.legs!.map((l) => Math.round(l.afterT! * 10) / 10)).toEqual([4_037.5, 4_012.5, 4_012.5, 4_037.5])
    expect(check(r, 'jack-legs')).toMatchObject({ status: 'ok', detail: 'наибольшая — «Опора 1»: 4038 т при допустимой 4040 т' })
    expect(check(r, 'jack-vdl')).toMatchObject({ status: 'ok', detail: 'на опорах 2900 т при допустимом 3500 т · в шторм 2900 т при допустимом 3000 т' })
  })

  // Audit 2026-11-09: a leg taken below nothing showed under a tick.
  it('fails a leg the cargo lifts off — beyond the legs, its share is negative — whatever the limit', () => {
    // Light legs, and 400 t at the deck's corner, 15 m beyond the legs on
    // either axis from the far leg: (0; 0) against legs at x 5…25, y 12…28.
    const light = { ...unit, report: { ...unit.report, legLoadsT: { a: 100, b: 100, c: 100, d: 100 } } }
    const r = evaluateJackUp(light, [{ weightT: 400, vcgM: 0, x: 0, y: 0 }], [], deck, true)
    const after = r.legs!.map((l) => l.afterT!)
    // The shares still hold the load: 400 t in all, its moment about both axes.
    expect(after.reduce((s, v) => s + v, 0)).toBeCloseTo(800, 9)
    const lifted = r.legs!.filter((l) => l.afterT! < 0)
    expect(lifted.map((l) => l.name)).toEqual(['Опора 1'])
    expect(check(r, 'jack-legs')).toMatchObject({ status: 'error' })
    expect(check(r, 'jack-legs').detail).toMatch(/^«Опора 1» −\d+ т — опора отрывается/)
    // With no limit given it is an error all the same.
    const noLimit = evaluateJackUp({ ...light, elevated: { ...light.elevated, maxLegLoadT: undefined } }, [{ weightT: 400, vcgM: 0, x: 0, y: 0 }], [], deck, true)
    expect(check(noLimit, 'jack-legs').status).toBe('error')
    // Over the legs' centre the same 400 t lifts nothing.
    expect(check(evaluateJackUp(light, [{ weightT: 400, vcgM: 0, x: 15, y: 20 }], [], deck, true), 'jack-legs').status).toBe('ok')
    // Below nothing by a whole tonne, as the loads are shown: a leg left at
    // −0.3 t reads 0 t, and is not called lifted.
    const first = after[0]
    const unlimited = { ...light, elevated: { ...light.elevated, maxLegLoadT: undefined } }
    const touching = { ...unlimited, report: { ...unlimited.report, legLoadsT: { ...unlimited.report.legLoadsT, a: 100 - first - 0.3 } } }
    const t = evaluateJackUp(touching, [{ weightT: 400, vcgM: 0, x: 0, y: 0 }], [], deck, true)
    expect(t.legs![0].afterT).toBeCloseTo(-0.3, 9)
    expect(check(t, 'jack-legs').status).toBe('none')
  })

  it('names the legs over their load, and the VDL over its storm limit', () => {
    // 300 t: 112.5 t on each near leg, 37.5 t on each far one.
    const r = evaluateJackUp({ ...unit, elevated: { ...unit.elevated, maxLegLoadT: 4_100 } }, [{ weightT: 300, vcgM: 0, x: 20, y: 20 }], [], deck, true)
    expect(check(r, 'jack-legs')).toMatchObject({ status: 'error', detail: '«Опора 1» 4113 т, «Опора 4» 4113 т при допустимой 4100 т — больше допустимой' })
    expect(check(r, 'jack-vdl')).toMatchObject({ status: 'error', detail: 'на опорах 3100 т при допустимом 3500 т · в шторм 3100 т при допустимом 3000 т — в шторм придётся снимать груз' })
  })

  it('shares fuel brought at the legs\' centre equally, and subtracts nothing leaving from the legs', () => {
    const r = evaluateJackUp(
      { ...unit, transfers: [{ id: 'f', name: 'Топливо', weightT: 200, vcgM: 5, at: 'centre' }, { id: 'w', name: 'Вода', weightT: -80, vcgM: 3 }] },
      [],
      [{ weightT: 50, vcgM: 30 }],
      deck,
      true
    )
    expect(r.legs!.map((l) => l.afterT)).toEqual([4_050, 4_050, 4_050, 4_050])
    expect(r.vdlAfterT).toBe(2_800 - 50 + 200 - 80)
  })

  // Audit 2026-11-07: tanks by one leg load it far more than an equal share.
  it('puts fuel brought by a leg on that leg as the plane has it, and works no legs out without saying where', () => {
    // 200 t at «Опора 1»'s own point of the 20 × 16 m rectangle: 3/4 on it,
    // 1/4 on each neighbour, −1/4 on the diagonal one.
    const by = evaluateJackUp({ ...unit, transfers: [{ id: 'f', name: 'Топливо', weightT: 200, vcgM: 5, at: 'a' }] }, [], [], deck, true)
    expect(by.legs!.map((l) => Math.round(l.addedT * 1e6) / 1e6)).toEqual([150, 50, -50, 50])
    const nowhere = evaluateJackUp({ ...unit, transfers: [{ id: 'f', name: 'Топливо', weightT: 200, vcgM: 5 }] }, [], [], deck, true)
    expect(check(nowhere, 'jack-legs')).toMatchObject({ status: 'none', detail: 'Прочий приход: не указано, где «Топливо» — у опоры или в центре опор' })
    expect(nowhere.legs!.every((l) => l.afterT === undefined)).toBe(true)
    // A leg since removed is no place either; fuel taken needs none.
    expect(check(evaluateJackUp({ ...unit, transfers: [{ id: 'f', name: 'Топливо', weightT: 200, vcgM: 5, at: 'gone' }] }, [], [], deck, true), 'jack-legs').status).toBe('none')
    expect(check(evaluateJackUp({ ...unit, transfers: [{ id: 'f', name: 'Топливо', weightT: -200, vcgM: 5 }] }, [], [], deck, true), 'jack-legs').status).toBe('ok')
  })

  it('says what is missing rather than judging without it', () => {
    expect(check(evaluateJackUp(EMPTY_JACK_UP, [], [], deck, true), 'jack-legs').detail).toBe('Опоры не заданы')
    expect(check(evaluateJackUp({ ...unit, legs: [...unit.legs.slice(0, 3), { id: 'd', name: 'Опора 4' }] }, [], [], deck, true), 'jack-legs').detail).toBe('У опоры «Опора 4» не задано положение')
    expect(check(evaluateJackUp({ ...unit, report: { ...unit.report, legLoadsT: { a: 4_000 } } }, [], [], deck, true), 'jack-legs').detail).toBe('Нет нагрузки на опору «Опора 2» из суточного отчёта')
    const inLine = { ...unit, legs: [0, 10, 20].map((y, i) => ({ id: String(i), name: `Опора ${i + 1}`, fromSternM: y, fromPortM: 5 })) }
    expect(check(evaluateJackUp(inLine, [], [], deck, true), 'jack-legs').detail).toBe('Меньше трёх опор или опоры на одной линии — нагрузки не определить')
    expect(check(evaluateJackUp({ ...unit, report: { ...unit.report, vdlT: undefined } }, [], [], deck, true), 'jack-vdl').detail).toBe('Нет VDL из суточного отчёта')
  })
})

describe('evaluateJackUp, afloat', () => {
  const afloat: JackUpData = { ...unit, mode: 'afloat' }

  it('lets the cargo change the draught, and judges the KG at the new one', () => {
    // 300 t at 8 m: Δ 8 300 t, KG (96 000 + 2 400) / 8 300, draught 4 + 300 / 2 000.
    const r = evaluateJackUp(afloat, [{ weightT: 300, vcgM: 8, x: 0, y: 0 }], [], deck, true)
    expect(r.kgAfterM).toBeCloseTo(98_400 / 8_300, 9)
    expect(r.draftAfterM).toBeCloseTo(4.15, 9)
    expect(r.kgMaxM).toBeCloseTo(12.35, 9)
    expect(check(r, 'jack-kg')).toMatchObject({ status: 'ok', detail: '11.86 м при допустимом 12.35 м на осадке 4.15 м' })
    expect(check(r, 'jack-draft')).toMatchObject({ status: 'ok', detail: '4.15 м при наибольшей 4.50 м' })
    expect(check(r, 'jack-vdl')).toMatchObject({ status: 'error', detail: 'на плаву 3100 т при допустимом 2500 т — больше предела' })
  })

  it('is over the draught, and has no KG without the TPC or the table', () => {
    const deep = evaluateJackUp({ ...afloat, afloat: { ...afloat.afloat, maxDraftM: 4.1 } }, [{ weightT: 300, vcgM: 8, x: 0, y: 0 }], [], deck, true)
    expect(check(deep, 'jack-draft')).toMatchObject({ status: 'error', detail: '4.15 м при наибольшей 4.10 м — больше наибольшей' })
    const noTpc = evaluateJackUp({ ...afloat, afloat: { ...afloat.afloat, tpcTPerCm: undefined } }, [{ weightT: 300, vcgM: 8, x: 0, y: 0 }], [], deck, true)
    expect(check(noTpc, 'jack-kg').detail).toBe('11.86 м: не задан TPC')
    expect(check(noTpc, 'jack-draft').detail).toBe('Не посчитана: не задан TPC')
    const noTable = evaluateJackUp({ ...afloat, afloat: { ...afloat.afloat, kgLimit: undefined } }, [], [], deck, true)
    expect(check(noTable, 'jack-kg').detail).toBe('12.00 м: нет таблицы допустимого KG')
    expect(check(evaluateJackUp(afloat, [{ weightT: 300, vcgM: 8, x: 0, y: 0 }], [], deck, false), 'jack-kg').detail).toBe('Не задана высота палубы над основной плоскостью')
  })
})
