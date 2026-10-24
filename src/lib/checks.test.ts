import { describe, it, expect } from 'vitest'
import { buildChecks, checkCounts, type PlanFacts, type TripFacts } from './checks'

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
    const fine = { verdict: 'ok' as const, reasons: [] }
    const noLimit = { verdict: 'warn' as const, reasons: [{ status: 'warn' as const, text: 'Предел по формуляру не задан' }] }

    it('needs the vessel\'s data and its hydrostatics', () => {
      expect(check(facts({ hasVessel: true }), 'stability')).toMatchObject({ status: 'none', detail: 'Нет гидростатики судна' })
      expect(check(facts({ hasVessel: true, trips: [trip({ stability: fine })] }), 'stability')).toMatchObject({
        status: 'ok',
        detail: 'Выполнено по формуляру',
      })
    })

    it('is an error when any trip fails the booklet check, naming why and where', () => {
      const low = {
        verdict: 'error' as const,
        reasons: [
          { status: 'error' as const, text: 'Приход: GM 1.12 м ниже предела 1.30 м при осадке 5.90 м' },
          { status: 'warn' as const, text: 'Танки и запасы не заданы' },
        ],
      }
      expect(check(facts({ hasVessel: true, trips: [trip({ stability: fine }), trip({ stability: low })] }), 'stability')).toMatchObject({
        status: 'error',
        detail: 'Приход: GM 1.12 м ниже предела 1.30 м при осадке 5.90 м (рейс 2)',
      })
    })

    it('warns once for a reason every trip shares, with the trips', () => {
      const trips = [trip({ stability: noLimit }), trip({ stability: noLimit })]
      expect(check(facts({ hasVessel: true, trips }), 'stability')).toMatchObject({
        status: 'warn',
        detail: 'Предел по формуляру не задан (рейсы 1, 2)',
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
