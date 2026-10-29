import { describe, it, expect } from 'vitest'
import { buildChecks, checkCounts, checkDetails, type PlanFacts, type TripFacts, type TripFindings } from './checks'

const trip = (partial: Partial<TripFacts> = {}): TripFacts => ({
  weightKg: 16_600,
  overloadedZones: 0,
  separationViolations: 0,
  ...partial,
})

// A plan where nothing is set up beyond the cargo: everything placed, no
// limits, zones, rules, lashing or vessel data.
const facts = (partial: Partial<PlanFacts> = {}): PlanFacts => ({
  mode: 'auto',
  totalUnits: 22,
  unplacedUnits: 0,
  trips: [trip()],
  zoneCount: 0,
  separationRuleCount: 0,
  lashing: { securedStacks: 0, shortStacks: 0, dangerousGoodsStacks: 0 },
  hasVessel: false,
  attention: { malformed: 0, legacyUnknown: 0, rejectedPins: 0, manualConflicts: 0 },
  ...partial,
})

const check = (f: PlanFacts, id: string) => buildChecks(f).find((c) => c.id === id)

describe('buildChecks', () => {
  it('lists the six checks of 8.4 in order, «Требуют внимания» only when there is something', () => {
    expect(buildChecks(facts()).map((c) => c.title)).toEqual([
      'Вместимость и рейсы',
      'Вес палубы',
      'Зоны т/м²',
      'Сепарация',
      'Крепление',
      'Остойчивость',
    ])
    const withAttention = buildChecks(facts({ attention: { malformed: 1, legacyUnknown: 0, rejectedPins: 0, manualConflicts: 0 } }))
    expect(withAttention.at(-1)).toMatchObject({ title: 'Требуют внимания', status: 'error', detail: 'Повреждённые штабели: 1' })
  })

  it('without data a check is «—», not a warning', () => {
    const f = facts({ totalUnits: 0, trips: [trip({ weightKg: 0 })] })
    expect(buildChecks(f).map((c) => [c.id, c.status, c.detail])).toEqual([
      ['capacity', 'none', 'Груза нет'],
      ['deck-weight', 'none', 'Лимит не задан'],
      ['zones', 'none', 'Зон нет'],
      ['separation', 'none', 'Правил нет'],
      ['lashing', 'none', 'Точки крепления не заданы'],
      ['stability', 'none', 'Нет данных судна'],
    ])
    expect(checkCounts(buildChecks(f))).toEqual({ errors: 0, warnings: 0 })
  })

  describe('capacity', () => {
    it('is fine when everything is placed, naming the trips', () => {
      expect(check(facts(), 'capacity')).toMatchObject({ status: 'ok', detail: 'Всё размещено' })
      expect(check(facts({ trips: [trip(), trip()] }), 'capacity')).toMatchObject({ detail: 'Всё размещено за 2 рейса' })
    })

    it('is an error in auto mode when cargo fits in no trip, a warning in manual mode', () => {
      expect(check(facts({ unplacedUnits: 3 }), 'capacity')).toMatchObject({
        status: 'error',
        detail: '3 ед. не помещаются ни в один рейс',
        target: 'placement',
      })
      expect(check(facts({ mode: 'manual', unplacedUnits: 3 }), 'capacity')).toMatchObject({
        status: 'warn',
        detail: 'Не размещено 3 ед.',
      })
    })
  })

  describe('deck weight', () => {
    it('compares the heaviest trip with the limit and names the trips over it', () => {
      expect(check(facts({ maxDeckCargoT: 2550 }), 'deck-weight')).toMatchObject({ status: 'ok', detail: '16.6 из 2550 т' })
      expect(check(facts({ maxDeckCargoT: 15 }), 'deck-weight')).toMatchObject({ status: 'error', detail: '16.6 из 15 т' })
      const trips = [trip({ weightKg: 14_000 }), trip({ weightKg: 17_200 })]
      expect(check(facts({ maxDeckCargoT: 15, trips }), 'deck-weight')).toMatchObject({
        status: 'error',
        detail: '17.2 из 15 т (рейс 2)',
        target: 'vessel',
      })
    })

    it('accepts exactly the limit', () => {
      expect(check(facts({ maxDeckCargoT: 16.6 }), 'deck-weight')).toMatchObject({ status: 'ok' })
    })
  })

  describe('zones', () => {
    it('is an error with an overloaded zone, naming the trips', () => {
      const trips = [trip({ overloadedZones: 1 }), trip(), trip({ overloadedZones: 2 })]
      expect(check(facts({ zoneCount: 3, trips }), 'zones')).toMatchObject({
        status: 'error',
        detail: 'Перегружено зон: 2 (рейсы 1, 3)',
      })
    })

    it('warns while a library vessel\'s deck strength is not chosen, even with no zones yet', () => {
      expect(check(facts({ deckStrength: 'pending' }), 'zones')).toMatchObject({
        status: 'warn',
        detail: 'Не выбран лимит прочности палубы',
      })
      expect(check(facts({ zoneCount: 1, deckStrength: 'unchecked' }), 'zones')).toMatchObject({ status: 'warn' })
    })

    it('is fine when every zone is within its limit', () => {
      expect(check(facts({ zoneCount: 2 }), 'zones')).toMatchObject({ status: 'ok', detail: 'Все зоны в лимите' })
    })

    // Stage 4, group B: the load statistics said so in red; the check didn't.
    it('is an error when a stack presses harder than its zone allows', () => {
      const trips = [trip(), trip({ overPressureStacks: 1 })]
      expect(check(facts({ zoneCount: 1, trips }), 'zones')).toMatchObject({
        status: 'error',
        detail: 'Давление под грузом выше лимита: 1 штабель (рейс 2)',
      })
    })
  })

  describe('separation', () => {
    it('counts violations over every trip', () => {
      const trips = [trip({ separationViolations: 1 }), trip({ separationViolations: 2 })]
      expect(check(facts({ separationRuleCount: 1, trips }), 'separation')).toMatchObject({
        status: 'error',
        detail: 'Нарушений: 3 (рейсы 1, 2)',
      })
      expect(check(facts({ separationRuleCount: 1 }), 'separation')).toMatchObject({ status: 'ok', detail: 'Нарушений нет' })
    })
  })

  describe('lashing', () => {
    it('judges only stacks with lashing points', () => {
      expect(check(facts({ lashing: { securedStacks: 4, shortStacks: 0, dangerousGoodsStacks: 0 } }), 'lashing')).toMatchObject({
        status: 'ok',
        detail: 'Крепления хватает: 4 штабеля',
      })
      expect(check(facts({ lashing: { securedStacks: 4, shortStacks: 1, dangerousGoodsStacks: 0 } }), 'lashing')).toMatchObject({
        status: 'warn',
        detail: 'Не хватает крепления: 1 штабель',
      })
    })

    it('warns about dangerous goods even without lashing points', () => {
      expect(check(facts({ lashing: { securedStacks: 0, shortStacks: 0, dangerousGoodsStacks: 2 } }), 'lashing')).toMatchObject({
        status: 'warn',
        detail: 'Опасный груз: крепление и сегрегация — по IMDG Code, отдельно',
      })
    })
  })

  describe('stability', () => {
    const both: ('departure' | 'arrival')[] = ['departure', 'arrival']
    const fine = { verdict: 'ok' as const, reasons: [] }
    const noLimit = { verdict: 'warn' as const, reasons: [{ status: 'warn' as const, text: 'Предел по формуляру не задан', states: both }] }

    it('needs the vessel\'s data and its hydrostatics', () => {
      expect(check(facts({ hasVessel: true }), 'stability')).toMatchObject({ status: 'none', detail: 'Нет гидростатики судна' })
      expect(check(facts({ hasVessel: true, trips: [trip({ stability: fine })] }), 'stability')).toMatchObject({
        status: 'ok',
        detail: 'Выполнено по формуляру',
      })
    })

    // Spec 2026-10-24, 5: «Рейс 2, приход: GM 1.12 м ниже предела…».
    const low = {
      verdict: 'error' as const,
      reasons: [
        { status: 'error' as const, text: 'GM 1.12 м ниже предела 1.30 м при осадке 5.90 м', states: ['arrival' as const] },
        { status: 'warn' as const, text: 'Танки и запасы не заданы', states: both },
      ],
    }

    it('is an error when any trip fails the booklet check, naming why, on which trip and in which state', () => {
      expect(check(facts({ hasVessel: true, trips: [trip({ stability: fine }), trip({ stability: low })] }), 'stability')).toMatchObject({
        status: 'error',
        detail: 'Рейс 2, приход: GM 1.12 м ниже предела 1.30 м при осадке 5.90 м',
        lines: [
          { status: 'error', text: 'Рейс 2, приход: GM 1.12 м ниже предела 1.30 м при осадке 5.90 м' },
          { status: 'warn', text: 'Рейс 2: танки и запасы не заданы' },
        ],
        target: 'stability',
      })
    })

    it('names no trip when there is one, and the state only when the reason holds in one', () => {
      expect(check(facts({ hasVessel: true, trips: [trip({ stability: low })] }), 'stability')?.lines).toEqual([
        { status: 'error', text: 'Приход: GM 1.12 м ниже предела 1.30 м при осадке 5.90 м' },
        { status: 'warn', text: 'Танки и запасы не заданы' },
      ])
    })

    it('warns once for a reason every trip shares, with the trips', () => {
      const trips = [trip({ stability: noLimit }), trip({ stability: noLimit })]
      expect(check(facts({ hasVessel: true, trips }), 'stability')).toMatchObject({
        status: 'warn',
        detail: 'Рейсы 1, 2: предел по формуляру не задан',
      })
    })
  })

  it('lists every kind of case that needs attention', () => {
    const f = facts({ attention: { malformed: 1, legacyUnknown: 2, rejectedPins: 1, manualConflicts: 3 } })
    expect(check(f, 'attention')?.detail).toBe(
      'Повреждённые штабели: 1 · Штабели с неизвестным составом: 2 · Недопустимые закреплённые позиции: 1 · Штабели там, где стоять нельзя: 3'
    )
  })
})

describe('checkCounts', () => {
  it('counts ✕ and ⚠, never «—»', () => {
    const f = facts({
      unplacedUnits: 2,
      maxDeckCargoT: 10,
      deckStrength: 'pending',
      lashing: { securedStacks: 0, shortStacks: 0, dangerousGoodsStacks: 1 },
    })
    expect(checkCounts(buildChecks(f))).toEqual({ errors: 2, warnings: 2 })
  })
})

// Stage 4, group B (spec 8.4): a click on a check says what it found and
// lights up the stacks at fault.
describe('checkDetails', () => {
  const none: TripFindings = {
    zones: [], pressure: [], separation: [], lashingShort: [], dangerousGoods: [],
    unknownMakeup: [], conflicts: [], rejectedPins: [], quarantined: [],
  }
  const found = (partial: Partial<TripFindings>) => ({ ...none, ...partial })
  const box = { key: 'box@1', name: 'Ящик' }
  const drum = { key: 'drum@2', name: 'Бочка' }

  it('names the zone and its load; the stacks in it are at fault', () => {
    const f = facts({ trips: [trip({ found: found({ zones: [{ label: 'Зона 1', densityTPerM2: 6.2, limitTPerM2: 5, stacks: [box, drum] }] }) })] })
    const d = checkDetails(f, 'zones')
    expect(d.lines).toEqual([{ status: 'error', text: 'Зона 1: 6.20 из 5 т/м²' }])
    expect(d.stacks).toEqual(new Map([[0, new Set(['box@1', 'drum@2'])]]))
  })

  it('names the trip when there is more than one, and blames stacks trip by trip', () => {
    const pair = { a: box, b: drum, distance: 1.2, minDistance: 3 }
    const f = facts({ unitLabel: 'м', trips: [trip(), trip({ found: found({ separation: [pair] }) })] })
    const d = checkDetails(f, 'separation')
    expect(d.lines).toEqual([{ status: 'error', text: '«Ящик» и «Бочка»: 1.20 из 3 м', trip: 1 }])
    expect([...d.stacks.keys()]).toEqual([1])
  })

  it('says what a secured stack lacks; dangerous goods are left to the IMDG Code', () => {
    const f = facts({
      trips: [
        trip({
          found: found({
            lashingShort: [{ stack: box, required: 4, attached: 2, balanceFails: true }],
            dangerousGoods: [drum],
          }),
        }),
      ],
    })
    expect(checkDetails(f, 'lashing').lines.map((l) => l.text)).toEqual([
      '«Ящик»: нужно 4, задано 2; не держит по расчёту сил',
      '«Бочка»: опасный груз — крепление и сегрегация по IMDG Code',
    ])
  })

  it('lists what fits nowhere first, then each trip\'s 10-foot units', () => {
    const f = facts({ unfit: [{ name: 'Кран', reason: 'Больше палубы' }], tenFoot: { capacity: 70, byTrip: [12] } })
    expect(checkDetails(f, 'capacity').lines).toEqual([
      { status: 'error', text: '«Кран»: больше палубы' },
      { status: 'info', text: '10-футовых контейнеров: 12 из 70' },
    ])
  })

  it('weighs each trip against the limit when there are several', () => {
    const f = facts({ maxDeckCargoT: 20, trips: [trip({ weightKg: 25_000 }), trip({ weightKg: 10_000 })] })
    expect(checkDetails(f, 'deck-weight').lines).toEqual([
      { status: 'error', text: '25 из 20 т', trip: 0 },
      { status: 'info', text: '10 из 20 т', trip: 1 },
    ])
    expect(checkDetails(facts({ maxDeckCargoT: 20 }), 'deck-weight').lines).toEqual([])
  })

  it('names every case needing a decision; those on the deck are at fault', () => {
    const f = facts({
      trips: [
        trip({
          found: found({
            quarantined: [{ recordId: 'q', name: 'Груз 1' }],
            unknownMakeup: [{ stack: box, recordId: 'p1' }],
            rejectedPins: [{ recordId: 'p2', name: 'Бочка', reason: 'Вне палубы' }],
            conflicts: [{ stack: drum, recordId: 'm1', reason: 'В зоне ограничения' }],
          }),
        }),
      ],
    })
    const d = checkDetails(f, 'attention')
    expect(d.lines.map((l) => l.text)).toEqual([
      '«Груз 1»: данные штабеля повреждены, на палубе его нет',
      '«Ящик»: состав неизвестен',
      '«Бочка»: закреплённая позиция недопустима — вне палубы',
      '«Бочка»: в зоне ограничения',
    ])
    expect(d.stacks.get(0)).toEqual(new Set(['box@1', 'drum@2']))
  })
})
