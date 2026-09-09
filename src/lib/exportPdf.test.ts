// Round 19 (lashing per-segment). buildLashingRequirementRows is the pure,
// composition-aware core of handleExportPdf's (page.tsx) lashing table —
// extracted specifically so it's testable without jsPDF/canvas. Sidebar.tsx
// uses the same underlying segmentLashingInputs + assessLashingRequirement
// combination for its own live verdict blocks; this file is the "PDF" half
// of the mutation gate the review asked for.
import { describe, it, expect } from 'vitest'
import { buildLashingRequirementRows } from './exportPdf'
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
