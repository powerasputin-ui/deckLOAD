import { describe, expect, it } from 'vitest'
import { capitalised, placementProblem, type PlacementSurroundings } from './placementProblem'

// Stage 3, group D (spec 7.1): one answer for the click and for the shadow
// under the cursor.

const deck = (patch: Partial<PlacementSurroundings> = {}): PlacementSurroundings => ({ others: [], gap: 0.1, unitLabel: 'м', ...patch })
const box = { x: 2, y: 2, width: 2, length: 1 }

describe('placementProblem', () => {
  it('lets a stack go on free deck', () => {
    expect(placementProblem(box, deck())).toBeNull()
  })

  it('says the place is taken by another stack', () => {
    expect(placementProblem(box, deck({ others: [{ x: 3, y: 2.5, width: 2, length: 1 }] }))).toBe('место занято другим грузом')
  })

  it('keeps the gap between stacks', () => {
    // 0.05 apart: closer than the 0.1 gap.
    expect(placementProblem(box, deck({ others: [{ x: 4.05, y: 2, width: 1, length: 1 }] }))).toBe('место занято другим грузом')
    expect(placementProblem(box, deck({ others: [{ x: 4.2, y: 2, width: 1, length: 1 }] }))).toBeNull()
  })

  it('says the stack would stand off a deck that isn\'t a rectangle', () => {
    const triangle = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }]
    expect(placementProblem({ x: 7, y: 6, width: 2, length: 1 }, deck({ usableOutline: triangle }))).toBe('груз выходит за пределы палубы')
    expect(placementProblem(box, deck({ usableOutline: triangle }))).toBeNull()
  })

  it('keeps out of another stack\'s clearance zone', () => {
    const zoned = { x: 5, y: 2, width: 1, length: 1, clearanceMargin: { top: 0, right: 0, bottom: 0, left: 1.5 } }
    expect(placementProblem(box, deck({ others: [zoned] }))).toBe('зона отступа другого груза')
  })

  it('keeps a lashing point free', () => {
    expect(placementProblem(box, deck({ lashingPoints: [{ x: 3, y: 2.5 }] }))).toBe('рядом точка крепления')
  })

  it('names the obstacle in the way', () => {
    const crane = { id: 'z', name: 'Кран', shapeType: 'rect' as const, x: 3, y: 0, width: 2, length: 5 }
    expect(placementProblem(box, deck({ restrictionZones: [crane] }))).toBe('препятствие «Кран»')
  })

  it('names the separation rule broken, with its categories and distance', () => {
    const rules = [{ id: 'r', categoryA: 'Опасный груз', categoryB: 'Обычный', minDistance: 3 }]
    const other = { x: 6, y: 2, width: 1, length: 1, category: 'Обычный' }
    expect(placementProblem({ ...box, category: 'Опасный груз' }, deck({ others: [other], separationRules: rules }))).toBe(
      'нарушена сепарация груза: «Опасный груз» и «Обычный» ближе 3 м'
    )
    // 3 m clear: allowed; no category of its own: no rule applies.
    expect(placementProblem({ ...box, category: 'Опасный груз' }, deck({ others: [{ ...other, x: 7 }], separationRules: rules }))).toBeNull()
    expect(placementProblem(box, deck({ others: [other], separationRules: rules }))).toBeNull()
  })

  it('gives the first reason in the order the click checks them', () => {
    const crane = { id: 'z', name: 'Кран', shapeType: 'rect' as const, x: 0, y: 0, width: 10, length: 10 }
    expect(placementProblem(box, deck({ others: [{ ...box }], restrictionZones: [crane] }))).toBe('место занято другим грузом')
  })
})

describe('capitalised', () => {
  it('capitalises the reason to stand on its own', () => {
    expect(capitalised('препятствие «Кран»')).toBe('Препятствие «Кран»')
  })
})
