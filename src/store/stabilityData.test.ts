import { describe, it, expect, beforeEach } from 'vitest'
import { normalizeProject, type Project } from './projects'
import { useCalculator } from './calculator'
import { VESSEL_TEMPLATES } from '@/lib/vesselTemplates'
import { singleFigureMinGM, weightsInState, type VesselStabilityData } from '@/lib/stability'

// Stage 2a, group A1: the stability data the booklet check needs, and how
// calculations saved before it are carried over (spec 3.4).

const particulars = {
  lengthBpp: 77.2,
  breadth: 20,
  lightshipWeightKg: 4_048_700,
  lightshipKG: 7.758,
  lightshipLCG: 41.213,
  lightshipTCG: 0,
  longitudinalOrigin: 'aft-perpendicular' as const,
}

function project(deck: Record<string, unknown>, rest: Record<string, unknown> = {}): Project {
  return normalizeProject({ deck: { width: 16.9, length: 49.1, unit: 'm', ...deck }, ...rest } as Partial<Project>)
}

describe('the limit from the booklet', () => {
  it('moves a single minGM into a one-row table at the draught of the one hydrostatic point', () => {
    const p = project({
      vessel: {
        particulars: { ...particulars, minGM: 1.22 },
        hydrostatics: { points: [{ displacementKg: 7_456_680, draftM: 5.873, KM: 9.604 }] },
        variableWeights: [],
      },
    })
    expect(p.deck.vessel?.limit).toEqual({
      kind: 'min-gm-by-draft',
      rows: [{ arg: 5.873, value: 1.22 }],
      source: 'Перенесено из «Мин. GM» — одно значение для одного случая загрузки',
    })
    expect(p.deck.vessel?.particulars.minGM).toBeUndefined()
    expect(singleFigureMinGM(p.deck.vessel!)).toBe(1.22)
  })

  it('keeps minGM as a hint when its draught is unknown', () => {
    const p = project({
      vessel: {
        particulars: { ...particulars, minGM: 1.22 },
        hydrostatics: {
          points: [
            { displacementKg: 6_000_000, draftM: 5, KM: 9.8 },
            { displacementKg: 8_000_000, draftM: 6.2, KM: 9.5 },
          ],
        },
        variableWeights: [],
      },
    })
    expect(p.deck.vessel?.limit).toBeUndefined()
    expect(p.deck.vessel?.particulars.minGM).toBe(1.22)
  })

  it('keeps a valid table and drops rows that are not numbers or are negative', () => {
    const p = project({
      vessel: {
        particulars,
        hydrostatics: { points: [] },
        variableWeights: [],
        limit: {
          kind: 'max-kg-by-displacement',
          rows: [{ arg: 6_000_000, value: 8.1 }, { arg: -1, value: 8 }, { arg: 7_000_000, value: 'x' }, null, { arg: 8_000_000, value: 7.9 }],
          source: 'Информация об остойчивости, табл. 5',
        },
      },
    })
    expect(p.deck.vessel?.limit).toEqual({
      kind: 'max-kg-by-displacement',
      rows: [{ arg: 6_000_000, value: 8.1 }, { arg: 8_000_000, value: 7.9 }],
      source: 'Информация об остойчивости, табл. 5',
    })
  })

  it('reads a table with an unknown kind or no rows left as no limit', () => {
    const vessel = (limit: unknown) => ({ particulars, hydrostatics: { points: [] }, variableWeights: [], limit })
    expect(project({ vessel: vessel({ kind: 'by-trim', rows: [{ arg: 5, value: 1 }] }) }).deck.vessel?.limit).toBeUndefined()
    expect(project({ vessel: vessel({ kind: 'min-gm-by-draft', rows: [{ arg: 'a', value: 1 }] }) }).deck.vessel?.limit).toBeUndefined()
  })

  it('comes with the library vessel as one row', () => {
    const tpl = VESSEL_TEMPLATES.find((t) => t.id === 'aleksey-kuznetsov')!
    expect(tpl.vessel?.particulars.minGM).toBeUndefined()
    expect(tpl.vessel?.limit?.rows).toEqual([{ arg: 5.873, value: 1.22 }])
    const p = project({ vessel: tpl.vessel })
    expect(p.deck.vessel?.limit).toEqual(tpl.vessel?.limit)
  })
})

describe('the vessel and voyage fields', () => {
  it('keeps the new particulars and drops impossible values', () => {
    const p = project({
      vessel: {
        particulars: {
          ...particulars,
          maxDraftM: 6.4,
          loadLineLengthM: 86,
          criteriaSet: 'osv-b245',
          otherExposedDeckAreaM2: 0,
          otherExposedDeckVcgM: 14.2,
        },
        hydrostatics: { points: [] },
        variableWeights: [],
      },
      icing: true,
    })
    expect(p.deck.vessel?.particulars).toMatchObject({
      maxDraftM: 6.4,
      loadLineLengthM: 86,
      criteriaSet: 'osv-b245',
      otherExposedDeckAreaM2: 0,
      otherExposedDeckVcgM: 14.2,
    })
    expect(p.deck.icing).toBe(true)

    const bad = project({
      vessel: {
        particulars: { ...particulars, maxDraftM: 0, loadLineLengthM: -5, criteriaSet: 'weather', otherExposedDeckAreaM2: -1 },
        hydrostatics: { points: [] },
        variableWeights: [],
      },
      icing: 'yes',
    })
    expect(bad.deck.vessel?.particulars.maxDraftM).toBeUndefined()
    expect(bad.deck.vessel?.particulars.loadLineLengthM).toBeUndefined()
    expect(bad.deck.vessel?.particulars.criteriaSet).toBeUndefined()
    expect(bad.deck.vessel?.particulars.otherExposedDeckAreaM2).toBeUndefined()
    expect(bad.deck.icing).toBeUndefined()
  })

  it('reads arrival tanks when given, and leaves arrival as departure when not', () => {
    const tank = { id: 't', name: 'Fuel', weightKg: 1000, vcgM: 2, tcgM: 0, lcgM: 30 }
    const withArrival = project({
      vessel: { particulars, hydrostatics: { points: [] }, variableWeights: [tank], arrivalWeights: [{ ...tank, weightKg: 100 }] },
    })
    expect(withArrival.deck.vessel?.arrivalWeights?.[0].weightKg).toBe(100)
    expect(weightsInState(withArrival.deck.vessel!, 'arrival')[0].weightKg).toBe(100)

    const without = project({ vessel: { particulars, hydrostatics: { points: [] }, variableWeights: [tank] } })
    expect(without.deck.vessel?.arrivalWeights).toBeUndefined()
    expect(weightsInState(without.deck.vessel!, 'arrival')).toEqual(without.deck.vessel!.variableWeights)
  })
})

describe('pipe cargo', () => {
  const nest = {
    pipeOuterDiameterM: 0.957,
    pipeLengthM: 12.38,
    pipeWeightKg: 15000,
    usableWidthM: 16.9,
    pipesPerRow: 17,
    tierCounts: [17, 16],
    pipeCount: 33,
    heightM: 2.064,
    vcgAboveDeckM: 1.107,
    crateHeightM: 0.15,
    limited: false,
    requestedPipeCount: 33,
    requestedTiers: 2,
  }

  it('moves water carried in a nest\'s weight to its own field, with the placements that copied the weight', () => {
    const p = project(
      {},
      {
        items: [{ id: 'n', name: 'Штабель', width: 16.9, length: 12.38, height: 2.064, quantity: 1, color: '#57534e', allowRotation: false, weight: 33 * 15000 + 29000, shape: 'pipe-nest', nest }],
        pinnedPlacementsByTrip: {
          0: [{ id: 'p', itemId: 'n', name: 'Штабель', x: 0, y: 0, width: 16.9, length: 12.38, layers: 1, rotated: false, color: '#57534e', weight: 33 * 15000 + 29000 }],
        },
        manualPlacements: [{ id: 'm', itemId: 'n', name: 'Штабель', x: 0, y: 20, width: 16.9, length: 12.38, layers: 1, rotated: false, color: '#57534e', weight: 33 * 15000 + 29000 }],
      }
    )
    expect(p.items[0].weight).toBe(33 * 15000)
    expect(p.items[0].trappedWaterT).toBeCloseTo(29, 6)
    const pin = p.pinnedPlacementsByTrip[0][0]
    expect(pin.weight).toBe(33 * 15000)
    expect(pin.legacyUnknownComposition).toBeUndefined()
    expect(p.manualPlacements[0].weight).toBe(33 * 15000)
  })

  it('leaves a nest without water, or with its water already apart, as it is', () => {
    const plain = project({}, { items: [{ id: 'n', name: 'Штабель', width: 16.9, length: 12.38, height: 2, quantity: 1, color: '#000', allowRotation: false, weight: 33 * 15000, shape: 'pipe-nest', nest }] })
    expect(plain.items[0].weight).toBe(33 * 15000)
    expect(plain.items[0].trappedWaterT).toBeUndefined()

    const apart = project({}, { items: [{ id: 'n', name: 'Штабель', width: 16.9, length: 12.38, height: 2, quantity: 1, color: '#000', allowRotation: false, weight: 33 * 15000 + 29000, trappedWaterT: 5, shape: 'pipe-nest', nest }] })
    expect(apart.items[0].weight).toBe(33 * 15000 + 29000)
    expect(apart.items[0].trappedWaterT).toBe(5)
  })

  it('gives pipes added from a preset the preset\'s inside diameter, keeping one entered by hand', () => {
    const p = project(
      {},
      {
        items: [
          { id: 'a', name: 'Труба Ø813×30,2 НУБП-72', width: 12.38, length: 0.957, height: 0.957, quantity: 4, color: '#000', allowRotation: true, weight: 15000, shape: 'cylinder' },
          { id: 'b', name: 'Труба Ø813×30,2 НУБП-72 — штабель 33 шт', width: 16.9, length: 12.38, height: 2, quantity: 1, color: '#000', allowRotation: false, weight: 33 * 15000, shape: 'pipe-nest', nest },
          { id: 'c', name: 'Труба Ø219,1×12,7 (без НУБП)', width: 12.38, length: 0.219, height: 0.219, quantity: 1, color: '#000', allowRotation: true, shape: 'cylinder', pipeInnerDiameterMm: 200 },
          { id: 'd', name: 'Ящик', width: 1, length: 1, height: 1, quantity: 1, color: '#000', allowRotation: true },
        ],
      }
    )
    expect(p.items.map((it) => it.pipeInnerDiameterMm)).toEqual([752.6, 752.6, 200, undefined])
  })
})

describe('tanks at departure and arrival', () => {
  const tank = { id: 'fuel', name: 'Fuel', weightKg: 100_000, vcgM: 4.7, tcgM: 0.2, lcgM: 50, freeSurfaceMomentTm: 175.8 }

  beforeEach(() => {
    const vessel: VesselStabilityData = { particulars, hydrostatics: { points: [] }, variableWeights: [tank] }
    useCalculator.setState({ deck: { width: 16.9, length: 49.1, unit: 'm', gap: 0.1, boardOffset: 0.2, clearance: 0, vessel } })
  })

  const vessel = () => useCalculator.getState().deck.vessel!

  it('starts arrival from a copy of departure on its first change, leaving departure alone', () => {
    useCalculator.getState().updateVariableWeight('fuel', { weightKg: 10_000 }, 'arrival')
    expect(vessel().arrivalWeights).toEqual([{ ...tank, weightKg: 10_000 }])
    expect(vessel().variableWeights).toEqual([tank])

    useCalculator.getState().addVariableWeight({ name: 'Ballast' }, 'arrival')
    expect(vessel().arrivalWeights?.map((w) => w.name)).toEqual(['Fuel', 'Ballast'])
    expect(vessel().variableWeights).toHaveLength(1)

    useCalculator.getState().removeVariableWeight('fuel', 'arrival')
    expect(vessel().arrivalWeights?.map((w) => w.name)).toEqual(['Ballast'])
    expect(vessel().variableWeights).toEqual([tank])
  })

  it('changes departure by default, which arrival follows until it is entered', () => {
    useCalculator.getState().updateVariableWeight('fuel', { weightKg: 50_000 })
    expect(weightsInState(vessel(), 'departure')[0].weightKg).toBe(50_000)
    expect(weightsInState(vessel(), 'arrival')[0].weightKg).toBe(50_000)
  })

  it('copies departure into arrival on request', () => {
    useCalculator.getState().updateVariableWeight('fuel', { weightKg: 1 }, 'arrival')
    useCalculator.getState().copyDepartureToArrival()
    expect(vessel().arrivalWeights).toEqual([tank])
  })

  it('sets and clears the limit and the icing switch', () => {
    const limit = { kind: 'min-gm-by-draft' as const, rows: [{ arg: 5, value: 1.1 }, { arg: 6, value: 1.3 }] }
    useCalculator.getState().setStabilityLimit(limit)
    expect(vessel().limit).toEqual(limit)
    useCalculator.getState().setStabilityLimit(undefined)
    expect(vessel().limit).toBeUndefined()

    useCalculator.getState().setIcing(true)
    expect(useCalculator.getState().deck.icing).toBe(true)
  })

  it('keeps a preset pipe\'s inside diameter on the cargo it adds', () => {
    useCalculator.setState({ items: [] })
    useCalculator.getState().addOrIncrementCargoFromTemplate({ name: 'Труба', width: 12.38, length: 0.957, height: 0.957, shape: 'cylinder', pipeInnerDiameterMm: 752.6, trappedWaterT: 0.9 })
    expect(useCalculator.getState().items[0]).toMatchObject({ pipeInnerDiameterMm: 752.6, trappedWaterT: 0.9 })
  })
})
