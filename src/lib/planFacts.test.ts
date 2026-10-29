import { describe, it, expect } from 'vitest'
import { gatherPlanFacts, type PlanInput } from './planFacts'
import { packMultiTrip, packingResultFromManual, type CargoItem, type ManualPlacement, type PinnedPlacement } from './packing'
import { VESSEL_TEMPLATES } from './vesselTemplates'
import type { DeckConfig } from '@/store/calculator'

const deck = (partial: Partial<DeckConfig> = {}): DeckConfig => ({
  width: 10,
  length: 10,
  unit: 'm',
  gap: 0,
  boardOffset: 0,
  clearance: 0,
  ...partial,
})

const item = (partial: Partial<CargoItem> & { id: string }): CargoItem => ({
  name: partial.id,
  width: 1,
  length: 1,
  height: 1,
  quantity: 1,
  color: '#000000',
  allowRotation: false,
  weight: 1000,
  ...partial,
})

const manual = (partial: Partial<ManualPlacement> & { id: string; itemId: string }): ManualPlacement => ({
  name: partial.itemId,
  x: 0,
  y: 0,
  width: 1,
  length: 1,
  layers: 1,
  rotated: false,
  color: '#000000',
  weight: 1000,
  ...partial,
})

// A manual plan: the deck takes what's placed by hand.
function manualPlan(d: DeckConfig, items: CargoItem[], placements: ManualPlacement[], extra: Partial<PlanInput> = {}): PlanInput {
  const total = items.reduce((s, it) => s + it.quantity, 0)
  const trip = packingResultFromManual(d.width, d.length, placements, total, items, d.clearance, d.outline, {
    boardOffset: d.boardOffset,
    gap: d.gap,
    restrictionZones: d.restrictionZones,
  })
  return { mode: 'manual', trips: [trip], pinnedPlacementsByTrip: {}, manualPlacements: placements, items, deck: d, separationRules: [], ...extra }
}

// An auto plan, packed the way page.tsx packs it.
function autoPlan(d: DeckConfig, items: CargoItem[], pins: Record<number, PinnedPlacement[]> = {}): PlanInput {
  const trips = packMultiTrip(d.width, d.length, items, { sortStrategy: 'area-desc', loadZones: d.loadZones, unit: d.unit }, 10, pins)
  const last = trips[trips.length - 1]
  const shown = trips.length > 1 && last.placedCount === 0 && !(pins[trips.length - 1] ?? []).length ? trips.slice(0, -1) : trips
  return { mode: 'auto', trips: shown, pinnedPlacementsByTrip: pins, manualPlacements: [], items, deck: d, separationRules: [] }
}

describe('gatherPlanFacts', () => {
  it('counts the cargo, the trips and what fits nowhere', () => {
    // A 2×2 deck takes 4 unit boxes a trip; the 3×3 crate fits no trip.
    const items = [item({ id: 'box', quantity: 6 }), item({ id: 'crate', width: 3, length: 3 })]
    const facts = gatherPlanFacts(autoPlan(deck({ width: 2, length: 2 }), items))
    expect(facts.totalUnits).toBe(7)
    expect(facts.trips).toHaveLength(2)
    expect(facts.trips.map((t) => t.weightKg)).toEqual([4000, 2000])
    expect(facts.unplacedUnits).toBe(1)
  })

  it('counts overloaded zones on every trip', () => {
    // 1 t on a 1 m² zone limited to 0.5 t/m².
    const d = deck({ loadZones: [{ id: 'z', x: 0, y: 0, width: 1, length: 1, maxLoadPerArea: 0.5 }] })
    const facts = gatherPlanFacts(manualPlan(d, [item({ id: 'box' })], [manual({ id: 'm1', itemId: 'box' })]))
    expect(facts.zoneCount).toBe(1)
    expect(facts.trips[0].overloadedZones).toBe(1)
  })

  it('counts pairs of stacks closer than a separation rule allows', () => {
    const items = [item({ id: 'acid', category: 'Химикаты' }), item({ id: 'food', category: 'Продукты' })]
    const placements = [manual({ id: 'm1', itemId: 'acid' }), manual({ id: 'm2', itemId: 'food', x: 3 })]
    const rules = [{ id: 'r', categoryA: 'Продукты', categoryB: 'Химикаты', minDistance: 5 }]
    const facts = gatherPlanFacts(manualPlan(deck(), items, placements, { separationRules: rules }))
    expect(facts.separationRuleCount).toBe(1)
    expect(facts.trips[0].separationViolations).toBe(1)
  })

  describe('lashing', () => {
    const items = [item({ id: 'pipe', category: 'Металлопродукция', weight: 100_000 })]
    // A strong point at the corner, pulling out at 45° in both directions.
    const point = (id: string) => ({ id, x: 3, y: 3, placementId: 'm1', cornerX: 1, cornerY: 1, mslKg: 50_000 })

    it('judges only stacks with points attached', () => {
      const facts = gatherPlanFacts(manualPlan(deck(), items, [manual({ id: 'm1', itemId: 'pipe', weight: 100_000 })]))
      expect(facts.lashing).toEqual({ securedStacks: 0, shortStacks: 0, dangerousGoodsStacks: 0 })
    })

    it('is short with fewer points than required and no justification', () => {
      // 100 t of metal needs 2 lashings of the default 203 kN wire (РД 31.11.21.23-96:
      // 0.3 × 100 t / 20.7 t, rounded up).
      const d = deck({ lashingPoints: [point('p1')] })
      const facts = gatherPlanFacts(manualPlan(d, items, [manual({ id: 'm1', itemId: 'pipe', weight: 100_000 })]))
      expect(facts.lashing).toEqual({ securedStacks: 1, shortStacks: 1, dangerousGoodsStacks: 0 })

      const justified = manual({ id: 'm1', itemId: 'pipe', weight: 100_000, lashingJustification: 'Стоит в клети' })
      expect(gatherPlanFacts(manualPlan(d, items, [justified])).lashing.shortStacks).toBe(0)

      const enough = deck({ lashingPoints: [point('p1'), point('p2')] })
      expect(gatherPlanFacts(manualPlan(enough, items, [manual({ id: 'm1', itemId: 'pipe', weight: 100_000 })])).lashing).toEqual({
        securedStacks: 1,
        shortStacks: 0,
        dangerousGoodsStacks: 0,
      })
    })

    it('is short when the force balance fails, whatever the count', () => {
      const weak = { ...point('p1'), mslKg: 100 }
      const d = deck({ lashingPoints: [weak, { ...weak, id: 'p2' }] })
      const facts = gatherPlanFacts(manualPlan(d, items, [manual({ id: 'm1', itemId: 'pipe', weight: 100_000 })]))
      expect(facts.lashing.shortStacks).toBe(1)
    })

    it('counts stacks holding dangerous goods', () => {
      const dg = [item({ id: 'dg', category: 'Опасный груз', quantity: 2 })]
      const facts = gatherPlanFacts(autoPlan(deck(), dg))
      expect(facts.lashing.dangerousGoodsStacks).toBe(2)
    })
  })

  describe('stability', () => {
    const kuznetsov = VESSEL_TEMPLATES.find((t) => t.id === 'aleksey-kuznetsov')!

    it('reads each trip with the vessel\'s data, by the booklet check', () => {
      const d = deck({ width: 16.9, length: 49.1, vessel: kuznetsov.vessel, shipFrame: kuznetsov.shipFrame })
      const facts = gatherPlanFacts(autoPlan(d, [item({ id: 'box', quantity: 4, weight: 20_000 })]))
      expect(facts.hasVessel).toBe(true)
      const s = facts.trips[0].stability!
      // The library vessel's hydrostatics are one point, so any other
      // displacement is read off it as an estimate: a warning, never a tick,
      // even though the draught (held at that point's) meets its one-row
      // limit.
      expect(s.verdict).toBe('warn')
      expect(s.reasons).toEqual([{ status: 'warn', text: 'Водоизмещение 5200 т вне таблицы гидростатики — числа оценочные', states: ['departure', 'arrival'] }])
    })

    it('has nothing to read without the vessel\'s data', () => {
      const facts = gatherPlanFacts(autoPlan(deck(), [item({ id: 'box' })]))
      expect(facts.hasVessel).toBe(false)
      expect(facts.trips[0].stability).toBeUndefined()
    })
  })

  it('says when a library vessel\'s deck strength is not chosen or not checked', () => {
    const strong = VESSEL_TEMPLATES.find((t) => t.limits?.deckStrengthTPerM2)!
    const base = deck({ vesselTemplateId: strong.id })
    expect(gatherPlanFacts(autoPlan(base, [])).deckStrength).toBe('pending')
    expect(gatherPlanFacts(autoPlan({ ...base, deckStrengthChoiceTPerM2: 5 }, [])).deckStrength).toBe('unchecked')
    const zone = { id: 'z', x: 0, y: 0, width: 10, length: 10, maxLoadPerArea: 5 }
    expect(gatherPlanFacts(autoPlan({ ...base, deckStrengthChoiceTPerM2: 5, loadZones: [zone] }, [])).deckStrength).toBeUndefined()
    expect(gatherPlanFacts(autoPlan(deck(), [])).deckStrength).toBeUndefined()
  })

  describe('attention', () => {
    it('counts a locked pin the packer cannot use, not a layout one', () => {
      const items = [item({ id: 'box', quantity: 2 })]
      const pin = (id: string, locked: boolean): PinnedPlacement => ({
        id, itemId: 'box', name: 'box', x: 20, y: 20, width: 1, length: 1, layers: 1, rotated: false, color: '#000000', locked,
      })
      const facts = gatherPlanFacts(autoPlan(deck(), items, { 0: [pin('a', true), pin('b', false)] }))
      expect(facts.attention.rejectedPins).toBe(1)
    })

    it('counts manual stacks standing where they may not, and flagged records', () => {
      const d = deck({
        restrictionZones: [{ id: 'crane', name: 'Кран', shapeType: 'rect', x: 0, y: 0, width: 2, length: 2 }],
      })
      const placements = [
        manual({ id: 'm1', itemId: 'box' }),
        manual({ id: 'm2', itemId: 'box', x: 5, legacyUnknownComposition: true }),
      ]
      const facts = gatherPlanFacts(manualPlan(d, [item({ id: 'box', quantity: 2 })], placements))
      expect(facts.attention).toEqual({ malformed: 0, legacyUnknown: 1, rejectedPins: 0, manualConflicts: 1 })
    })
  })

  // Stage 4, group B (spec 8.4): what each check found, stack by stack —
  // the counts above, itemised, with the keys the deck finds stacks by.
  describe('findings', () => {
    const key = (itemId: string, x: number, y: number) => `${itemId}@${x.toFixed(3)},${y.toFixed(3)}`

    it('names the overloaded zone and the stacks in it', () => {
      const d = deck({ loadZones: [{ id: 'z', x: 0, y: 0, width: 10, length: 10, maxLoadPerArea: 0.005 }] })
      const facts = gatherPlanFacts(manualPlan(d, [item({ id: 'box' })], [manual({ id: 'm1', itemId: 'box', x: 2, y: 3 })]))
      expect(facts.trips[0].found!.zones).toEqual([
        { label: 'Зона 1 (вся палуба)', densityTPerM2: 0.01, limitTPerM2: 0.005, stacks: [{ key: key('box', 2, 3), name: 'box' }] },
      ])
    })

    it('finds a stack pressing harder than its zone allows, though the zone holds', () => {
      // 2 t on 1 m² over a 10 × 10 m zone of 1 t/m²: the zone carries 0.02 t/m².
      const d = deck({ loadZones: [{ id: 'z', x: 0, y: 0, width: 10, length: 10, maxLoadPerArea: 1 }] })
      const facts = gatherPlanFacts(manualPlan(d, [item({ id: 'box', weight: 2000 })], [manual({ id: 'm1', itemId: 'box', weight: 2000 })]))
      expect(facts.trips[0].overloadedZones).toBe(0)
      expect(facts.trips[0].overPressureStacks).toBe(1)
      expect(facts.trips[0].found!.pressure).toEqual([{ stack: { key: key('box', 0, 0), name: 'box' }, pressureTPerM2: 2, limitTPerM2: 1 }])
    })

    it('names both stacks of a separation pair and how far apart they are', () => {
      const items = [item({ id: 'acid', category: 'Химикаты' }), item({ id: 'food', category: 'Продукты' })]
      const placements = [manual({ id: 'm1', itemId: 'acid' }), manual({ id: 'm2', itemId: 'food', x: 3 })]
      const rules = [{ id: 'r', categoryA: 'Продукты', categoryB: 'Химикаты', minDistance: 5 }]
      const facts = gatherPlanFacts(manualPlan(deck(), items, placements, { separationRules: rules }))
      expect(facts.trips[0].found!.separation).toEqual([
        { a: { key: key('acid', 0, 0), name: 'acid' }, b: { key: key('food', 3, 0), name: 'food' }, distance: 2, minDistance: 5 },
      ])
    })

    it('says how a secured stack falls short', () => {
      const items = [item({ id: 'pipe', category: 'Металлопродукция', weight: 100_000 })]
      const d = deck({ lashingPoints: [{ id: 'p1', x: 3, y: 3, placementId: 'm1', cornerX: 1, cornerY: 1, mslKg: 50_000 }] })
      const facts = gatherPlanFacts(manualPlan(d, items, [manual({ id: 'm1', itemId: 'pipe', weight: 100_000 })]))
      expect(facts.trips[0].found!.lashingShort).toEqual([
        { stack: { key: key('pipe', 0, 0), name: 'pipe' }, required: 2, attached: 1, balanceFails: false },
      ])
    })

    it('lists the cases needing a decision with the records they are about', () => {
      const d = deck({ restrictionZones: [{ id: 'crane', name: 'Кран', shapeType: 'rect', x: 0, y: 0, width: 2, length: 2 }] })
      const placements = [
        manual({ id: 'm1', itemId: 'box' }),
        manual({ id: 'm2', itemId: 'box', x: 5, legacyUnknownComposition: true }),
      ]
      const found = gatherPlanFacts(manualPlan(d, [item({ id: 'box', quantity: 2 })], placements)).trips[0].found!
      expect(found.unknownMakeup).toEqual([{ stack: { key: key('box', 5, 0), name: 'box' }, recordId: 'm2' }])
      expect(found.conflicts).toEqual([{ stack: { key: key('box', 0, 0), name: 'box' }, recordId: 'm1', reason: 'В зоне ограничения' }])

      const pin: PinnedPlacement = { id: 'a', itemId: 'box', name: 'box', x: 20, y: 20, width: 1, length: 1, layers: 1, rotated: false, color: '#000000', locked: true }
      const auto = gatherPlanFacts(autoPlan(deck(), [item({ id: 'box' })], { 0: [pin] })).trips[0].found!
      expect(auto.rejectedPins).toEqual([{ recordId: 'a', name: 'box', reason: expect.any(String) }])
    })

    it('says what fits in no trip, and the 10-foot units against the vessel\'s capacity', () => {
      const items = [item({ id: 'box', name: "Контейнер 10'", quantity: 2 }), item({ id: 'crate', width: 3, length: 3 })]
      const facts = gatherPlanFacts(autoPlan(deck({ width: 2, length: 2, tenFootContainerCapacity: 70 }), items))
      expect(facts.unfit).toEqual([{ name: 'crate', reason: expect.any(String) }])
      expect(facts.tenFoot).toEqual({ capacity: 70, byTrip: [2] })
    })
  })
})
