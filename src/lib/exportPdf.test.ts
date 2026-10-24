// Round 19 (lashing per-segment). buildLashingRequirementRows is the pure,
// composition-aware core of handleExportPdf's (page.tsx) lashing table —
// extracted specifically so it's testable without jsPDF/canvas. Sidebar.tsx
// uses the same underlying segmentLashingInputs + assessLashingRequirement
// combination for its own live verdict blocks; this file is the "PDF" half
// of the mutation gate the review asked for.
import { describe, it, expect } from 'vitest'
import { buildLashingRequirementRows, buildStabilityPdfBlock, cargoTableRows, lashingPlacementsForPlan, pdfSectionTitles } from './exportPdf'
import type { CargoItem, PackingResult, PinnedPlacement, PlacedItem } from './packing'
import { evaluateTripStability, type TripStabilityInput } from './stabilityConditions'
import type { VesselStabilityData } from './stability'
import type { LashingCatalogItem } from './placementComposition'

const METAL: LashingCatalogItem = { id: 'A', name: 'Труба', category: 'Металлопродукция', weight: 500 }
const GENERAL: LashingCatalogItem = { id: 'B', name: 'Ящик', category: 'Обычный груз', weight: 800 }
const DANGEROUS: LashingCatalogItem = { id: 'C', name: 'Реагент', category: 'Опасный груз', weight: 300 }
const catalog = [METAL, GENERAL, DANGEROUS]

describe('buildLashingRequirementRows', () => {
  it('dormancy: an uncomposed placement produces exactly one row, byte-for-byte the same shape as before Round 19', () => {
    const placements = [
      { id: 'p1', itemId: 'A', layers: 2, name: 'Труба стек', lashingWireType: 'wire_19_5_g1zhn_1670' as const, lashingJustification: undefined },
    ]
    const { rows, dangerousGoodsNames } = buildLashingRequirementRows(placements, catalog, [])
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Труба стек') // no segment suffix — single-segment placement
    expect(rows[0].category).toBe('Металлопродукция')
    expect(rows[0].methodology).toBe('metal-rd')
    expect(dangerousGoodsNames).toHaveLength(0)
  })

  it('[A(metal)x2, B(general)x3]: two independent rows, each with its OWN category/methodology, neither poisons the other', () => {
    const placements = [
      {
        id: 'p1', itemId: 'A', layers: 5, name: 'Смешанный груз',
        composition: [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }],
      },
    ]
    const { rows, dangerousGoodsNames } = buildLashingRequirementRows(placements, catalog, [])
    expect(rows).toHaveLength(2)
    const metalRow = rows.find((r) => r.category === 'Металлопродукция')
    const generalRow = rows.find((r) => r.category === 'Обычный груз')
    expect(metalRow?.methodology).toBe('metal-rd')
    expect(generalRow?.methodology).toBe('general')
    expect(metalRow?.name).toBe('Смешанный груз — Труба')
    expect(generalRow?.name).toBe('Смешанный груз — Ящик')
    expect(dangerousGoodsNames).toHaveLength(0)
  })

  it('[A(metal)x2, C(dangerous)x1]: the dangerous segment is excluded as not-applicable, the metal segment is NOT swallowed by it', () => {
    const placements = [
      {
        id: 'p1', itemId: 'A', layers: 3, name: 'Смешанный груз',
        composition: [{ itemId: 'A', layers: 2 }, { itemId: 'C', layers: 1 }],
      },
    ]
    const { rows, dangerousGoodsNames } = buildLashingRequirementRows(placements, catalog, [])
    expect(rows).toHaveLength(1)
    expect(rows[0].category).toBe('Металлопродукция')
    expect(rows[0].methodology).toBe('metal-rd')
    expect(dangerousGoodsNames).toEqual(['Смешанный груз — Реагент'])
  })

  // Mandatory reversed-order scenario from the review: the result must not
  // depend on which constituent happens to be the nominal itemId.
  it('[C(dangerous)x1, A(metal)x2] (REVERSED order): identical result to the forward order — nominal itemId never determines the verdict', () => {
    const placements = [
      {
        id: 'p1', itemId: 'C', layers: 3, name: 'Смешанный груз',
        composition: [{ itemId: 'C', layers: 1 }, { itemId: 'A', layers: 2 }],
      },
    ]
    const { rows, dangerousGoodsNames } = buildLashingRequirementRows(placements, catalog, [])
    expect(rows).toHaveLength(1)
    expect(rows[0].category).toBe('Металлопродукция')
    expect(rows[0].methodology).toBe('metal-rd')
    expect(dangerousGoodsNames).toEqual(['Смешанный груз — Реагент'])
  })

  it('attachedCount, wireLabel and justification are SHARED (placement-level) across every row of the same composed placement, never split/duplicated differently', () => {
    const placements = [
      {
        id: 'p1', itemId: 'A', layers: 5, name: 'Смешанный груз',
        composition: [{ itemId: 'A', layers: 2 }, { itemId: 'B', layers: 3 }],
        lashingWireType: 'wire_19_5_g1zhn_1670' as const,
        lashingJustification: 'закреплено по проекту №42',
      },
    ]
    const points = [{ placementId: 'p1' }, { placementId: 'p1' }, { placementId: 'other' }]
    const { rows } = buildLashingRequirementRows(placements, catalog, points)
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.attachedCount).toBe(2) // only the 2 points belonging to p1, shared across both rows
      expect(row.justification).toBe('закреплено по проекту №42')
      expect(row.wireLabel).toBeTruthy()
    }
  })

  it('multiple placements: each keeps its own rows independent, no cross-placement leakage', () => {
    const placements = [
      { id: 'p1', itemId: 'A', layers: 2, name: 'Труба' },
      {
        id: 'p2', itemId: 'B', layers: 4, name: 'Смешанный',
        composition: [{ itemId: 'B', layers: 3 }, { itemId: 'C', layers: 1 }],
      },
    ]
    const { rows, dangerousGoodsNames } = buildLashingRequirementRows(placements, catalog, [])
    expect(rows).toHaveLength(2) // p1's single row + p2's general row (p2's dangerous segment excluded)
    expect(rows.some((r) => r.name === 'Труба')).toBe(true)
    expect(rows.some((r) => r.name === 'Смешанный — Ящик')).toBe(true)
    expect(dangerousGoodsNames).toEqual(['Смешанный — Реагент'])
  })
})

// Phase 0, L16: in auto mode the lashing table took only pinned stacks, so
// cargo the packer placed by itself fell out of it; the cargo table showed
// one trip without saying which.
describe('lashingPlacementsForPlan', () => {
  const stack = (itemId: string, x: number, stackedCount: number): PlacedItem => ({
    itemId, name: itemId === 'A' ? 'Труба' : 'Ящик', x, y: 1, width: 1, length: 1, height: 1,
    layers: stackedCount, stackedCount, rotated: false, color: '#000', index: 0,
  })
  const trip = (placed: PlacedItem[]): PackingResult => ({
    placed, unplaced: [], quarantined: [], breakdown: [], requestedCount: 0, placedCount: 0,
    totalArea: 100, usedArea: 0, freeArea: 100, utilization: 0, totalWeight: 0, maxStackHeight: 0, deckWidth: 10, deckLength: 10,
  })
  const pin: PinnedPlacement = {
    id: 'pin-1', itemId: 'A', name: 'Труба', x: 1, y: 1, width: 1, length: 1, layers: 2, rotated: false, color: '#000',
    lashingWireType: 'wire_19_5_g1zhn_1670', lashingJustification: 'Принайтовлено к соседнему',
  }

  it('auto mode takes every placed stack of every trip, pinned or not', () => {
    const list = lashingPlacementsForPlan('auto', [], [trip([stack('A', 1, 2), stack('B', 3, 1)]), trip([stack('A', 1, 3)])], { 0: [pin] })
    expect(list).toHaveLength(3)
    expect(list[0]).toMatchObject({ id: 'pin-1', layers: 2, lashingJustification: 'Принайтовлено к соседнему' })
    expect(new Set(list.map((p) => p.id)).size).toBe(3)
  })

  it('a stack the packer placed by itself gets its lashing row', () => {
    const { rows } = buildLashingRequirementRows(lashingPlacementsForPlan('auto', [], [trip([stack('A', 1, 2)])], {}), catalog, [])
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Труба')
  })

  it('manual mode takes the hand-placed stacks, except a quarantined one', () => {
    const manual = [
      { id: 'm1', itemId: 'A', name: 'Труба', x: 1, y: 1, width: 1, length: 1, layers: 1, rotated: false, color: '#000' },
      { id: 'm2', itemId: 'A', name: 'Труба', x: 3, y: 1, width: 1, length: 1, layers: 1, rotated: false, color: '#000', malformed: { invalidComposition: true as const } },
    ]
    expect(lashingPlacementsForPlan('manual', manual, [], { 0: [pin] }).map((p) => p.id)).toEqual(['m1'])
  })
})

describe('pdfSectionTitles', () => {
  it('one trip: the plain titles', () => {
    expect(pdfSectionTitles()).toEqual({ scheme: 'Схема палубы', cargo: 'Учёт по грузам', stability: 'Остойчивость', lashing: 'Крепление груза' })
  })

  it('several trips: which trip the plan shows, and that the lashing covers the whole operation', () => {
    expect(pdfSectionTitles({ index: 1, count: 3 })).toEqual({
      scheme: 'Схема палубы — рейс 2 из 3',
      cargo: 'Учёт по грузам — рейс 2 из 3',
      stability: 'Остойчивость — рейс 2 из 3',
      lashing: 'Крепление груза — вся операция, 3 рейса',
    })
  })
})

// Stage 1 (spec 6.2): the cargo's number in the PDF's «Учёт по грузам».
describe('cargoTableRows', () => {
  const row = (itemId: string, name: string) => ({
    itemId, name, color: '#000', requested: 2, placed: 2, footprints: 1, layers: 2, area: 3, weight: 1000, unitWeight: 500,
  })

  it('leads with the cargo number and lists cargo in list order', () => {
    const rows = cargoTableRows([row('b', 'Ящик'), row('a', 'Труба')], new Map([['a', 1], ['b', 2]]))
    expect(rows.map((r) => r.slice(0, 2))).toEqual([['1', 'Труба'], ['2', 'Ящик']])
    expect(rows[0].slice(2)).toEqual(['×2', '1', '2/2', '3', '1000'])
  })

  it('a cargo missing from the list gets a dash and goes last', () => {
    const rows = cargoTableRows([row('x', 'Старое'), row('a', 'Труба')], new Map([['a', 1]]))
    expect(rows.map((r) => r[0])).toEqual(['1', '—'])
  })
})

// Stage 2a (spec 2026-10-24, 7): the «Остойчивость» block of the PDF.
describe('buildStabilityPdfBlock', () => {
  // 1000 t lightship at KG 5, KM 8 at 1000–3000 t; 500 t of ballast at
  // departure and 100 t at arrival, low down; a 100 t box on the deck at the
  // LCB — no list, no trim. Departure 1600 t, KG 3.875, GM 4.125, draught
  // 3.2 m; arrival 1200 t, GM 3.167, draught 2.4 m.
  const vessel = (over: Partial<VesselStabilityData> = {}): VesselStabilityData => ({
    particulars: { lengthBpp: 60, breadth: 14, lightshipWeightKg: 1_000_000, lightshipKG: 5, lightshipLCG: 30, lightshipTCG: 0, longitudinalOrigin: 'aft-perpendicular' },
    hydrostatics: {
      points: [
        { displacementKg: 1_000_000, draftM: 2, KM: 8, LCB: 30, LCF: 30, MTC: 50 },
        { displacementKg: 3_000_000, draftM: 6, KM: 8, LCB: 30, LCF: 30, MTC: 50 },
      ],
    },
    variableWeights: [{ id: 'b', name: 'Балласт', weightKg: 500_000, vcgM: 1, tcgM: 0, lcgM: 30, freeSurfaceMomentTm: 0 }],
    arrivalWeights: [{ id: 'b', name: 'Балласт', weightKg: 100_000, vcgM: 1, tcgM: 0, lcgM: 30, freeSurfaceMomentTm: 0 }],
    limit: { kind: 'min-gm-by-draft', rows: [{ arg: 2, value: 1 }, { arg: 6, value: 1 }], source: 'Информация об остойчивости, табл. 5' },
    ...over,
  })
  const box: CargoItem = { id: 'box', name: 'Ящик', width: 2, length: 2, height: 2, quantity: 1, color: '#000', allowRotation: true, weight: 100_000 }
  const evaluate = (v: VesselStabilityData) => {
    const input: TripStabilityInput = {
      vessel: v,
      shipFrame: { originOffsetFromCenterlineM: 0, originOffsetFromMidshipsM: 30, heightAboveBaselineM: 6 },
      deck: { width: 10, length: 20, unit: 'm' },
      deckForwardIsPositiveY: true,
      placements: [{ itemId: 'box', x: 4, y: 9, width: 2, length: 2, height: 2, layers: 1, weight: 100_000 }],
      items: [box],
      icing: false,
    }
    return evaluateTripStability(input)
  }

  it('is one line without the vessel\'s data or its hydrostatics', () => {
    expect(buildStabilityPdfBlock(undefined, undefined)).toMatchObject({ only: 'Остойчивость: данные судна не заданы', rows: [] })
    const noHydro = vessel({ hydrostatics: { points: [] } })
    expect(buildStabilityPdfBlock(evaluate(noHydro), noHydro)).toMatchObject({ only: 'Остойчивость: гидростатика судна не задана' })
  })

  it('gives departure and arrival a row each, the verdict in words', () => {
    const v = vessel()
    const block = buildStabilityPdfBlock(evaluate(v), v, { index: 1, count: 2 })
    expect(block.title).toBe('Остойчивость — рейс 2 из 2')
    expect(block.head).toEqual(['Состояние', 'Водоизм., т', 'Осадка ср. / нос / корма, м', 'Крен, °', 'Дифферент, м', 'GM, м', 'Предел GM, м', 'Вода в трубах, т', 'Лёд, т', 'Итог'])
    expect(block.rows).toEqual([
      ['Отход', '1600', '3.20 / 3.20 / 3.20', '0', '0', '4.13', '1.00', '0', '—', 'выполнено'],
      ['Приход', '1200', '2.40 / 2.40 / 2.40', '0', '0', '3.17', '1.00', '0', '—', 'выполнено'],
    ])
    expect(block.verdicts).toEqual(['ok', 'ok'])
    expect(block.notes[0]).toBe('Предел по формуляру: мин. GM по осадке, 2 строки. Источник: Информация об остойчивости, табл. 5.')
    expect(block.notes.at(-2)).toBe('Оценка по введённым данным. Не заменяет одобренную Информацию об остойчивости и прибор загрузки судна.')
    expect(block.notes.at(-1)).toMatch(/^Не проверяется: критерий погоды/)
  })

  it('says when there is no limit, and gives the reasons with what they mean', () => {
    const v = vessel({ limit: undefined, arrivalWeights: [] })
    const block = buildStabilityPdfBlock(evaluate(v), v)
    expect(block.title).toBe('Остойчивость')
    expect(block.rows.map((r) => r[6])).toEqual(['—', '—'])
    expect(block.notes.slice(0, 2)).toEqual([
      'Предел по формуляру не задан — проверено только по общему минимуму GM 0.15 м.',
      'Нужна проверка: предел по формуляру не задан.',
    ])
  })

  it('stars the numbers read off the edge of the hydrostatic table, and turns a KG limit into GM', () => {
    const v = vessel({
      hydrostatics: { points: [{ displacementKg: 1_000_000, draftM: 2, KM: 8 }] },
      limit: { kind: 'max-kg-by-displacement', rows: [{ arg: 1_000_000, value: 6 }, { arg: 2_000_000, value: 6 }] },
    })
    const block = buildStabilityPdfBlock(evaluate(v), v)
    // Departure: GM 8 − 3.875, against KM 8 − KG 6 = 2.
    expect(block.rows[0].slice(1, 7)).toEqual(['*1600', '*2.00 / — / —', '*0', '*—', '*4.13', '2.00'])
    expect(block.notes).toContain('* Водоизмещение вне таблицы гидростатики: число взято по её крайней строке, это оценка.')
    // A reason of one state says which.
    const failing = vessel({ limit: { kind: 'min-gm-by-draft', rows: [{ arg: 2, value: 3.5 }, { arg: 6, value: 3.5 }] } })
    expect(buildStabilityPdfBlock(evaluate(failing), failing).notes).toContain('Не выполнено (приход): GM 3.17 м ниже предела 3.50 м при осадке 2.40 м.')
    expect(block.notes[0]).toBe('Предел по формуляру: макс. KG по водоизмещению, в таблице пересчитан в GM как KM − KG предельный, 2 строки.')
  })
})
