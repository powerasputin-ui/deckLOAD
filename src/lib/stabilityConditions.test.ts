import { describe, it, expect } from 'vitest'
import {
  cargoProfile,
  draughtsOf,
  evaluateTripStability,
  iceLoad,
  knReference,
  limitAt,
  reasonText,
  stackWater,
  trappedWaterShare,
  type TripStabilityInput,
} from './stabilityConditions'
import { checkIMOCriteria, computeGZCurve, computeStabilityResult, type StabilityResult, type VesselStabilityData } from './stability'
import { VESSEL_TEMPLATES } from './vesselTemplates'
import type { CargoItem } from './packing'
import type { PipeNestSpec } from './pipeNest'

// Stage 2a, group A2: the booklet check (spec 2026-10-24, sections 4, 5 and
// 8). Expected values are worked out by hand in the comments.

const nest = (pipeCount: number, od: number, length = 12.38): PipeNestSpec => ({
  pipeOuterDiameterM: od,
  pipeLengthM: length,
  pipeWeightKg: 22_000,
  usableWidthM: 16.9,
  pipesPerRow: 17,
  tierCounts: [17, pipeCount - 17],
  pipeCount,
  heightM: 2.3,
  vcgAboveDeckM: 1.2,
  crateHeightM: 0.15,
  limited: false,
  requestedPipeCount: pipeCount,
  requestedTiers: 2,
})

const pipe = (over: Partial<CargoItem> = {}): CargoItem => ({
  id: 'pipe',
  name: 'Труба',
  width: 10,
  length: 0.5,
  height: 0.5,
  quantity: 3,
  color: '#000',
  allowRotation: true,
  weight: 1000,
  shape: 'cylinder',
  pipeInnerDiameterMm: 400,
  ...over,
})

describe('water trapped in pipes (IS Code B 2.4)', () => {
  it('takes 30 % at a freeboard of 0.015 L or less, 10 % at 0.03 L or more, linear between', () => {
    // L = 100 m: 1.5 m and 3 m.
    expect(trappedWaterShare(1.2, 100)).toBe(0.3)
    expect(trappedWaterShare(1.5, 100)).toBe(0.3)
    expect(trappedWaterShare(2.25, 100)).toBeCloseTo(0.2, 12)
    expect(trappedWaterShare(3, 100)).toBe(0.1)
    expect(trappedWaterShare(5, 100)).toBe(0.1)
    expect(trappedWaterShare(5, 0)).toBe(0.3)
  })

  it('counts the inside of the pipes and the space between them by stowage', () => {
    // A pile of 3 loose pipes, OD 0.5 m, ID 0.4 m, 10 m long:
    // inside 3 × 10 × π/4 × 0.16 = 3.7699; between (nested, √3/2 − π/4 =
    // 0.080594) 3 × 10 × 0.080594 × 0.25 = 0.60446; total 4.3744 m³.
    const pile = stackWater({ itemId: 'pipe', layers: 3 }, [pipe()], 'm')
    expect(pile.netVolumeM3).toBeCloseTo(4.3744, 3)
    // One pipe has nothing beside it: inside only, 0.25133 × 5 = 1.2566 m³.
    expect(stackWater({ itemId: 'pipe', layers: 1 }, [pipe()], 'm').netVolumeM3).toBeCloseTo(1.2566, 3)

    // A nest stacks flat (pipeNest.ts): 34 pipes Ø1073 (Ø813×30.2 with
    // 130 mm coating), 12.38 m, ID 752.6 mm: inside 34 × 12.38 × π/4 ×
    // 0.7526² = 187.25; between (1 − π/4) × 1.073² × 12.38 × 34 = 104.0;
    // 291.2 m³.
    const n = pipe({ id: 'nest', shape: 'pipe-nest', nest: nest(34, 1.073), pipeInnerDiameterMm: 752.6, width: 16.9, length: 12.38, height: 2.3 })
    expect(stackWater({ itemId: 'nest', layers: 1 }, [n], 'm').netVolumeM3).toBeCloseTo(291.2, 0)
  })

  it('takes stated water per unit instead, and names pipes it can\'t count', () => {
    const stated = stackWater({ itemId: 'pipe', layers: 3 }, [pipe({ trappedWaterT: 0.5 })], 'm')
    expect(stated).toEqual({ statedKg: 1500, netVolumeM3: 0, missing: [] })
    const unknown = stackWater({ itemId: 'pipe', layers: 3 }, [pipe({ pipeInnerDiameterMm: undefined, name: 'Обсадная труба' })], 'm')
    expect(unknown).toEqual({ statedKg: 0, netVolumeM3: 0, missing: ['Обсадная труба'] })
    // Not pipe cargo: no water at all.
    expect(stackWater({ itemId: 'box', layers: 2 }, [pipe({ id: 'box', shape: 'box', width: 2, length: 2 })], 'm').missing).toEqual([])
  })

  it('reads lengths in the deck\'s unit', () => {
    // The same pile of 3 entered in centimetres.
    const cm = pipe({ width: 1000, length: 50, height: 50 })
    expect(stackWater({ itemId: 'pipe', layers: 3 }, [cm], 'cm').netVolumeM3).toBeCloseTo(4.3744, 3)
  })

  it('lands in the range of the approved figure for the library vessel (plausibility, not a match)', () => {
    // ДВТК LC51 carries 2250 t of pipes with 87 t of water in them. Its pipe
    // and its way of counting aren't stated. Taken here: Ø813×30.2 with
    // 130 mm coating (22 t, the preset), 102 pipes ≈ 2250 t in three nests
    // of 34, L = LBP (no load line length on file). The draught is held at
    // the one hydrostatic point (5.873 m): freeboard 8.40 − 5.873 = 2.53 m ≥
    // 0.03 × 77.2 → 10 %. 3 × 291.2 m³ × 10 % × 1.025 ≈ 89.5 t.
    const k = VESSEL_TEMPLATES.find((t) => t.id === 'aleksey-kuznetsov')!
    const n = pipe({ id: 'nest', shape: 'pipe-nest', nest: nest(34, 1.073), pipeInnerDiameterMm: 752.6, width: 16.27, length: 12.38, height: 2.3, weight: 34 * 22_000 })
    const placements = [0, 1, 2].map((i) => ({ itemId: 'nest', x: 0.3, y: 5 + i * 13, width: 16.27, length: 12.38, height: 2.3, layers: 1, weight: 34 * 22_000, nest: n.nest }))
    const r = evaluateTripStability({ vessel: k.vessel!, shipFrame: k.shipFrame!, deck: { width: 16.9, length: 49.1, unit: 'm' }, deckForwardIsPositiveY: true, placements, items: [n], icing: false })!
    expect(r.departure.waterKg / 1000).toBeGreaterThan(75)
    expect(r.departure.waterKg / 1000).toBeLessThan(103)
    expect(r.departure.waterKg / 1000).toBeCloseTo(89.5, 0)
    expect(r.reasons.map((x) => x.text)).toContain('Длина L по грузовой марке не задана — для воды в трубах взята LBP')
  })
})

describe('ice', () => {
  const vessel: VesselStabilityData = {
    particulars: {
      lengthBpp: 60,
      breadth: 14,
      lightshipWeightKg: 1_000_000,
      lightshipKG: 5,
      lightshipLCG: 30,
      lightshipTCG: 0,
      longitudinalOrigin: 'aft-perpendicular',
      windageAreaM2: 100,
      windageLeverM: 5,
      otherExposedDeckAreaM2: 50,
      otherExposedDeckVcgM: 12,
    },
    hydrostatics: { points: [] },
    variableWeights: [],
  }
  const frame = { originOffsetFromCenterlineM: 0, originOffsetFromMidshipsM: 20, heightAboveBaselineM: 8 }
  const stack = { areaM2: 8, topM: 2, y0M: 0, y1M: 4, tcgM: 0, lcgM: 12 }

  it('loads decks at 30 kg/m² and both sides at 7.5 kg/m², with 5 % and 10 % for rigging', () => {
    const ice = iceLoad({ vessel, shipFrame: frame, deckForwardIsPositiveY: true, deckAreaM2: 200, deckLengthM: 20, stacks: [stack], draftM: 3 })
    // Cargo top 30 × 8 = 240 kg at 8 + 2 = 10 m; the rest of the deck
    // 30 × 192 = 5760 kg at 8 m; other decks 30 × 50 = 1500 kg at 12 m;
    // the hull's side 2 × 7.5 × 1.05 × 100 = 1575 kg at 3 + 5 × 1.1/1.05;
    // the cargo's side (4 m × 2 m) 2 × 7.5 × 1.05 × 8 = 126 kg at
    // 8 + 1 × 1.1/1.05.
    expect(ice.weightKg).toBeCloseTo(240 + 5760 + 1500 + 1575 + 126, 6)
    expect(ice.missingVesselAreas).toBe(false)
    const at = (kg: number) => ice.moments.find((m) => Math.abs(m.weightKg - kg) < 1e-6)!
    expect(at(240).vcgM).toBeCloseTo(10, 9)
    expect(at(5760).vcgM).toBeCloseTo(8, 9)
    expect(at(1500).vcgM).toBeCloseTo(12, 9)
    expect(at(1575).vcgM).toBeCloseTo(3 + (5 * 1.1) / 1.05, 9)
    expect(at(126).vcgM).toBeCloseTo(8 + 1.1 / 1.05, 9)
  })

  it('counts what it can and says so when the vessel\'s areas are missing', () => {
    const bare = { ...vessel, particulars: { ...vessel.particulars, windageAreaM2: undefined, otherExposedDeckAreaM2: undefined } }
    const ice = iceLoad({ vessel: bare, shipFrame: frame, deckForwardIsPositiveY: true, deckAreaM2: 200, deckLengthM: 20, stacks: [stack], draftM: 3 })
    expect(ice.missingVesselAreas).toBe(true)
    expect(ice.weightKg).toBeCloseTo(240 + 5760 + 126, 6)
  })

  it('takes the cargo\'s side as the tallest stack along the deck', () => {
    // 0–4 m: 2 m; 2–6 m overlapping at 3 m; so 0–2 → 2, 2–6 → 3: 4 + 12 = 16 m².
    const p = cargoProfile([
      { topM: 2, y0M: 0, y1M: 4 },
      { topM: 3, y0M: 2, y1M: 6 },
    ])
    expect(p.areaM2).toBeCloseTo(16, 9)
    // Centroids: strips (0–2, h 2) area 4 at y 1, z 1; (2–6, h 3) area 12 at y 4, z 1.5.
    expect(p.centroidYM).toBeCloseTo((4 * 1 + 12 * 4) / 16, 9)
    expect(p.centroidZM).toBeCloseTo((4 * 1 + 12 * 1.5) / 16, 9)
  })
})

describe('draughts', () => {
  const vessel = (origin: 'aft-perpendicular' | 'midships'): VesselStabilityData => ({
    particulars: { lengthBpp: 60, breadth: 14, lightshipWeightKg: 1, lightshipKG: 1, lightshipLCG: 0, lightshipTCG: 0, longitudinalOrigin: origin },
    hydrostatics: { points: [] },
    variableWeights: [],
  })
  const stability = (LCF: number) => ({ draftM: 4, trimM: 0.2, LCF }) as StabilityResult

  it('pivots the trim on LCF, from the aft perpendicular or from midships', () => {
    // LCF 30 m from AP = amidships: aft 4 − 0.2 × 30/60 = 3.9, fore 4.1.
    expect(draughtsOf(stability(30), vessel('aft-perpendicular'))).toEqual({ meanM: 4, midM: 4, foreM: 4.1, aftM: 3.9 })
    expect(draughtsOf(stability(0), vessel('midships'))).toEqual({ meanM: 4, midM: 4, foreM: 4.1, aftM: 3.9 })
    // LCF 24 m from AP: aft 4 − 0.2 × 0.4 = 3.92, fore 4.12, amidships 4.02.
    const d = draughtsOf(stability(24), vessel('aft-perpendicular'))
    expect(d.aftM).toBeCloseTo(3.92, 9)
    expect(d.foreM).toBeCloseTo(4.12, 9)
    expect(d.midM).toBeCloseTo(4.02, 9)
  })

  it('gives only the table\'s draught without LCF', () => {
    expect(draughtsOf({ draftM: 4, trimM: 0.2 } as StabilityResult, vessel('aft-perpendicular'))).toEqual({ meanM: 4, midM: 4, foreM: null, aftM: null })
  })
})

describe('the booklet\'s limit', () => {
  it('interpolates a minimum GM by draught and knows its range', () => {
    const limit = { kind: 'min-gm-by-draft' as const, rows: [{ arg: 6, value: 1.4 }, { arg: 5, value: 1.2 }] }
    expect(limitAt(limit, 5.5, 0, 0)).toMatchObject({ inRange: true, range: [5, 6] })
    expect(limitAt(limit, 5.5, 0, 0).gmMinM).toBeCloseTo(1.3, 12)
    expect(limitAt(limit, 6.2, 0, 0)).toMatchObject({ inRange: false, arg: 6.2 })
  })

  it('turns a maximum KG by displacement into a minimum GM with KM', () => {
    const limit = { kind: 'max-kg-by-displacement' as const, rows: [{ arg: 6_000_000, value: 8.2 }, { arg: 8_000_000, value: 7.8 }] }
    // At 7000 t: KG max 8.0, KM 9.6 → GM min 1.6.
    expect(limitAt(limit, 0, 7_000_000, 9.6).gmMinM).toBeCloseTo(1.6, 9)
  })
})

describe('the verdict', () => {
  // A small vessel whose numbers follow by hand: 1000 t lightship at KG 5;
  // KM 8 at 1000–3000 t; trim needs LCB and MTC.
  const vessel = (over: Partial<VesselStabilityData> = {}): VesselStabilityData => ({
    particulars: { lengthBpp: 60, breadth: 14, lightshipWeightKg: 1_000_000, lightshipKG: 5, lightshipLCG: 30, lightshipTCG: 0, longitudinalOrigin: 'aft-perpendicular', maxDraftM: 5 },
    hydrostatics: {
      points: [
        { displacementKg: 1_000_000, draftM: 2, KM: 8, LCB: 30, LCF: 30, MTC: 50 },
        { displacementKg: 3_000_000, draftM: 6, KM: 8, LCB: 30, LCF: 30, MTC: 50 },
      ],
    },
    // 500 t of ballast low down at departure; 100 t at arrival. Pressed
    // full both times: no free surface, and it says so with a 0.
    variableWeights: [{ id: 'b', name: 'Ballast', weightKg: 500_000, vcgM: 1, tcgM: 0, lcgM: 30, freeSurfaceMomentTm: 0 }],
    arrivalWeights: [{ id: 'b', name: 'Ballast', weightKg: 100_000, vcgM: 1, tcgM: 0, lcgM: 30, freeSurfaceMomentTm: 0 }],
    limit: { kind: 'min-gm-by-draft', rows: [{ arg: 2, value: 1 }, { arg: 6, value: 1 }] },
    ...over,
  })
  const box: CargoItem = { id: 'box', name: 'Ящик', width: 2, length: 2, height: 2, quantity: 1, color: '#000', allowRotation: true, weight: 100_000 }
  // A box centred on a 10 × 20 deck whose centre sits at the LCB: no trim.
  const input = (over: Partial<TripStabilityInput> = {}): TripStabilityInput => ({
    vessel: vessel(),
    shipFrame: { originOffsetFromCenterlineM: 0, originOffsetFromMidshipsM: 30, heightAboveBaselineM: 6 },
    deck: { width: 10, length: 20, unit: 'm' },
    deckForwardIsPositiveY: true,
    placements: [{ itemId: 'box', x: 4, y: 9, width: 2, length: 2, height: 2, layers: 1, weight: 100_000 }],
    items: [box],
    icing: false,
    ...over,
  })

  it('passes only against the booklet\'s limit, judged in the worse state', () => {
    // Departure: 1600 t, KG (5000 + 500 + 700)/1600 = 3.875, GM 4.125.
    // Arrival: 1200 t, KG (5000 + 100 + 700)/1200 = 4.833, GM 3.167 — worse.
    const r = evaluateTripStability(input())!
    expect(r.departure.stability.GM_fluid).toBeCloseTo(4.125, 9)
    expect(r.arrival.stability.GM_fluid).toBeCloseTo(3.1667, 4)
    expect(r.verdict).toBe('ok')
    expect(r.worst.state).toBe('arrival')
    expect(r.arrivalSameAsDeparture).toBe(false)
  })

  it('fails below the limit, naming the GM, the limit and the draught', () => {
    const r = evaluateTripStability(input({ vessel: vessel({ limit: { kind: 'min-gm-by-draft', rows: [{ arg: 2, value: 3.5 }, { arg: 6, value: 3.5 }] } }) }))!
    expect(r.verdict).toBe('error')
    expect(r.departure.verdict).toBe('ok')
    // Arrival: 1200 t → draught 2 + 4 × 200/2000 = 2.4 m.
    expect(r.reasons.map(reasonText)).toEqual(['Приход: GM 3.17 м ниже предела 3.50 м при осадке 2.40 м'])
  })

  it('fails under the general 0.15 m whatever the limit says, and over the load line draught', () => {
    const top = { ...box, weight: 1_000_000 }
    const high = input({
      vessel: vessel({ limit: undefined, particulars: { ...vessel().particulars, maxDraftM: 3 } }),
      items: [top],
      placements: [{ itemId: 'box', x: 4, y: 9, width: 2, length: 2, height: 2, layers: 1, weight: 1_000_000, stabilityOverride: { vcgAboveDeckM: 30 } }],
    })
    const r = evaluateTripStability(high)!
    const texts = r.reasons.map((x) => x.text)
    expect(r.verdict).toBe('error')
    expect(texts.some((t) => /^GM -?\d+\.\d\d м ниже общего минимума 0\.15 м$/.test(t))).toBe(true)
    expect(texts.some((t) => /^Осадка \d\.\d\d м больше предельной 3\.00 м по грузовой марке$/.test(t))).toBe(true)
  })

  it('warns without a limit, outside its table, outside the hydrostatics, and without tanks', () => {
    const texts = (i: TripStabilityInput) => evaluateTripStability(i)!.reasons.map((x) => x.text)
    expect(texts(input({ vessel: vessel({ limit: undefined }) }))).toEqual(['Предел по формуляру не задан'])
    expect(texts(input({ vessel: vessel({ limit: { kind: 'min-gm-by-draft', rows: [{ arg: 4, value: 1 }, { arg: 5, value: 1 }] } }) }))).toEqual([
      'Осадка 3.20 м вне таблицы предела (4.00–5.00 м)',
      'Осадка 2.40 м вне таблицы предела (4.00–5.00 м)',
    ])
    const hydroOnePoint = vessel({ hydrostatics: { points: [{ displacementKg: 1_000_000, draftM: 2, KM: 8 }] } })
    expect(texts(input({ vessel: hydroOnePoint }))).toContain('Водоизмещение 1600 т вне таблицы гидростатики — числа оценочные')
    expect(texts(input({ vessel: vessel({ variableWeights: [], arrivalWeights: undefined }) }))).toContain('Танки и запасы не заданы')
  })

  it('warns about pipes it can\'t count, and about icing without the vessel\'s areas', () => {
    const noId = pipe({ id: 'box', pipeInnerDiameterMm: undefined, name: 'Обсадная труба' })
    const r = evaluateTripStability(input({ items: [noId], placements: [{ itemId: 'box', x: 0, y: 5, width: 10, length: 0.5, height: 0.5, layers: 1, weight: 1000 }], icing: true }))!
    expect(r.reasons.map(reasonText)).toEqual([
      'Вода в трубах «Обсадная труба» не учтена: нет внутреннего диаметра',
      'Приход: для обледенения не заданы боковая площадь судна или площадь прочих открытых палуб',
    ])
    expect(r.arrival.iceKg).toBeGreaterThan(0)
    expect(r.departure.iceKg).toBe(0)
    expect(r.arrivalSameAsDeparture).toBe(false)
  })

  it('warns when no tank in a state has a free-surface moment, and about cargo it can\'t weigh', () => {
    const texts = (i: TripStabilityInput) => evaluateTripStability(i)!.reasons.map(reasonText)
    const unentered = vessel({ arrivalWeights: [{ id: 'b', name: 'Ballast', weightKg: 100_000, vcgM: 1, tcgM: 0, lcgM: 30 }] })
    expect(texts(input({ vessel: unentered }))).toEqual(['Приход: ни у одного танка не задан момент свободной поверхности — GM может быть завышена'])

    // A stack of 3 with no weight given, and a composed stack whose second
    // cargo has none: 3 + 2 units.
    const light: CargoItem = { ...box, id: 'light', name: 'Без веса', weight: undefined }
    const placements: TripStabilityInput['placements'] = [
      { itemId: 'light', x: 0, y: 0, width: 2, length: 2, height: 2, layers: 3 },
      { itemId: 'box', x: 4, y: 9, width: 2, length: 2, height: 2, layers: 3, weight: 100_000, composition: [{ itemId: 'box', layers: 1 }, { itemId: 'light', layers: 2 }] },
    ]
    expect(texts(input({ items: [box, light], placements }))).toEqual(['Груз без веса не учтён: 5 ед.'])
  })

  it('gives the weight and height of the water and the ice', () => {
    // The vessel's own areas set to none, so only the cargo deck ices:
    // 30 kg/m² on its 200 m² — 5880 kg on the free deck 6 m above the keel,
    // 120 kg on the box's 4 m² top at 8 m — and 7.5 kg/m² × 1.05 on both
    // sides of the box's 2 × 2 m profile, 63 kg, its centre 1 m up with
    // the moment +10 %: at 6 + 1.1/1.05.
    const iced = vessel({ particulars: { ...vessel().particulars, windageAreaM2: 0, windageLeverM: 0, otherExposedDeckAreaM2: 0 } })
    const r = evaluateTripStability(input({ vessel: iced, icing: true }))!
    expect(r.arrival.iceKg).toBeCloseTo(6063, 6)
    expect(r.arrival.iceVcgM).toBeCloseTo((5880 * 6 + 120 * 8 + 63 * (6 + 1.1 / 1.05)) / 6063, 9)
    expect(r.departure.iceVcgM).toBeUndefined()
    expect(r.departure.waterVcgM).toBeUndefined()

    // Water rides at the centre of its stack: 3 pipes of 0.5 m piled 3 high
    // on the deck at 6 m, VCG of the pile half its height of 1.5 m → 6.75 m.
    const piped = evaluateTripStability(input({ items: [pipe({ id: 'box' })], placements: [{ itemId: 'box', x: 0, y: 5, width: 10, length: 0.5, height: 0.5, layers: 3, weight: 1000 }] }))!
    expect(piped.departure.waterVcgM).toBeCloseTo(6.75, 9)
  })

  it('reads a limit table emptied while it is edited as no limit', () => {
    const r = evaluateTripStability(input({ vessel: vessel({ limit: { kind: 'min-gm-by-draft', rows: [] } }) }))!
    expect(r.reasons.map((x) => x.text)).toEqual(['Предел по формуляру не задан'])
  })

  it('is the same at arrival as at departure when arrival has nothing of its own', () => {
    const r = evaluateTripStability(input({ vessel: vessel({ arrivalWeights: undefined }) }))!
    expect(r.arrivalSameAsDeparture).toBe(true)
    expect(r.arrival.stability.GM_fluid).toBeCloseTo(r.departure.stability.GM_fluid, 12)
  })

  it('settles the water against the draught it causes', () => {
    // 3 pipes of 4.3744 m³ net, 1000 kg each, on the deck 6 m above keel.
    // Freeboard 6 − draught is well over 0.03 L (1.8 m): 10 %.
    const r = evaluateTripStability(input({ items: [pipe({ id: 'box' })], placements: [{ itemId: 'box', x: 0, y: 5, width: 10, length: 0.5, height: 0.5, layers: 3, weight: 1000 }] }))!
    expect(r.departure.waterKg).toBeCloseTo(4.3744 * 0.1 * 1025, 0)
  })
})

describe('the KN reference', () => {
  const vessel: VesselStabilityData = {
    particulars: { lengthBpp: 60, breadth: 14, lightshipWeightKg: 1_000_000, lightshipKG: 5, lightshipLCG: 30, lightshipTCG: 0, longitudinalOrigin: 'aft-perpendicular' },
    hydrostatics: { points: [{ displacementKg: 2_000_000, draftM: 4, KM: 7 }] },
    variableWeights: [],
    knCurves: { headingAngles: [0, 10, 20, 30, 40, 50], points: [{ displacementKg: 2_000_000, KNByAngle: [0, 1.2, 2.3, 3.2, 3.8, 4.1] }] },
  }

  it('shortens every arm by TCG·cos θ toward the side it lies on', () => {
    const upright = computeGZCurve(vessel, { totalDisplacementKg: 2_000_000, KG: 6, overallTCG: 0, overallLCG: 30 })!
    const listed = computeGZCurve(vessel, { totalDisplacementKg: 2_000_000, KG: 6, overallTCG: -0.3, overallLCG: 30 })!
    listed.curve.forEach((p, i) => {
      expect(p.GZ).toBeCloseTo(upright.curve[i].GZ - 0.3 * Math.cos((p.heelDeg * Math.PI) / 180), 12)
    })
    expect(listed.curve[0].GZ).toBeCloseTo(-0.3, 12)
  })

  it('takes «0.2 m at 30° or more» as the largest arm from 30° on', () => {
    const loading = { totalDisplacementKg: 2_000_000, KG: 6, overallTCG: 0, overallLCG: 30 }
    const gz = computeGZCurve(vessel, loading)!
    // GZ at 30°: 3.2 − 6 × 0.5 = 0.2; at 40°: 3.8 − 6 × 0.6428 = −0.0567.
    // Lower KN at 30° so only 40° clears it: the largest from 30° on counts.
    const later = { ...gz, curve: gz.curve.map((p) => (p.heelDeg === 30 ? { ...p, GZ: 0.1 } : p.heelDeg === 40 ? { ...p, GZ: 0.25 } : p)) }
    const stability = computeStabilityResult(vessel, loading)!
    const criterion = checkIMOCriteria(later, stability).find((c) => c.id === 'gz-max-at-30')!
    expect(criterion.actualValue).toBeCloseTo(0.25, 12)
    expect(criterion.pass).toBe(true)
  })

  it('is worked out per state from its own tanks and loading, and absent without KN curves', () => {
    const shipFrame = { originOffsetFromCenterlineM: 0, originOffsetFromMidshipsM: 30, heightAboveBaselineM: 6 }
    // 1000 t lightship + 1000 t of ballast at departure, at KG 5 and 7: KG 6,
    // the case of the test above. Arrival has no ballast.
    const ballast = { id: 'b', name: 'Ballast', weightKg: 1_000_000, vcgM: 7, tcgM: 0, lcgM: 30, freeSurfaceMomentTm: 0 }
    const v: VesselStabilityData = { ...vessel, variableWeights: [ballast], arrivalWeights: [] }
    const base: TripStabilityInput = { vessel: v, shipFrame, deck: { width: 10, length: 20, unit: 'm' }, deckForwardIsPositiveY: true, placements: [], items: [], icing: false }
    const r = evaluateTripStability(base)!
    const ref = knReference(r.departure)!
    // GZ at 30°: 3.2 − 6 × 0.5 = 0.2.
    expect(ref.gz.curve.find((p) => p.heelDeg === 30)!.GZ).toBeCloseTo(0.2, 9)
    expect(ref.criteria.map((c) => c.id)).toContain('area-0-30')
    expect(knReference(r.arrival)!.gz.curve.find((p) => p.heelDeg === 30)!.GZ).toBeCloseTo(3.2 - 5 * 0.5, 9)
    expect(knReference(evaluateTripStability({ ...base, vessel: { ...v, knCurves: undefined } })!.departure)).toBeNull()
  })

  it('checks a supply vessel by IS Code B 2.4.5 when asked', () => {
    const loading = { totalDisplacementKg: 2_000_000, KG: 6, overallTCG: 0, overallLCG: 30 }
    const gz = computeGZCurve(vessel, loading)!
    const stability = computeStabilityResult(vessel, loading)!
    const criteria = checkIMOCriteria({ ...gz, angleOfMaxGZ: 20 }, stability, undefined, 'osv-b245')
    expect(criteria.map((c) => c.id)).toEqual(['area-to-max', 'area-30-40', 'gz-max-at-30', 'angle-of-max-gz', 'initial-gm'])
    // Maximum at 20°: the area up to 20° needs 0.055 + 0.001 × 10 = 0.065.
    const area = criteria[0]
    expect(area.requiredValue).toBeCloseTo(0.065, 12)
    expect(area.description).toContain('до 20°')
    expect(criteria.find((c) => c.id === 'angle-of-max-gz')).toMatchObject({ requiredValue: 15, pass: true })
  })
})
