import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StabilityPanel } from './StabilityPanel'
import type { PackingResult } from '@/lib/packing'
import type { VesselStabilityData } from '@/lib/stability'

// An empty deck: the displacement is the lightship alone, 2 000 t.
const emptyDeck: PackingResult = {
  placed: [],
  unplaced: [],
  quarantined: [],
  breakdown: [],
  requestedCount: 0,
  placedCount: 0,
  totalArea: 160,
  usedArea: 0,
  freeArea: 160,
  utilization: 0,
  totalWeight: 0,
  maxStackHeight: 0,
  deckWidth: 20,
  deckLength: 8,
}

function vessel(hydroDisplacementsKg: number[], knDisplacementsKg?: number[]): VesselStabilityData {
  return {
    particulars: {
      name: 'Тест',
      lengthBpp: 80,
      breadth: 18,
      lightshipWeightKg: 2_000_000,
      lightshipKG: 5,
      lightshipLCG: 0,
      lightshipTCG: 0,
      longitudinalOrigin: 'midships',
    },
    hydrostatics: {
      points: hydroDisplacementsKg.map((d) => ({ displacementKg: d, draftM: 4, KM: 7, LCB: 0, LCF: 0, MTC: 100 })),
    },
    knCurves: knDisplacementsKg && {
      headingAngles: [0, 10, 20, 30, 40],
      points: knDisplacementsKg.map((d) => ({ displacementKg: d, KNByAngle: [0, 1.2, 2.3, 3.1, 3.6] })),
    },
    variableWeights: [],
  }
}

function renderPanel(v: VesselStabilityData) {
  return render(<StabilityPanel result={emptyDeck} deckWidth={20} deckLength={8} unit="m" vessel={v} />)
}

// Phase 0, L12: numbers worked out from the nearest table row, not for this
// displacement, looked exactly as trustworthy as real ones — a big green GM
// and green ticks, with the caveat a small third note further down.
describe('StabilityPanel outside the vessel tables', () => {
  it('inside the tables: no «оценка», GM in its pass colour', () => {
    renderPanel(vessel([1_000_000, 3_000_000], [1_000_000, 3_000_000]))
    expect(screen.queryByText('оценка')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('2 м').className).toContain('text-emerald-600')
  })

  it('outside the hydrostatics: the warning leads the card and every number is grey «оценка»', () => {
    const { container } = renderPanel(vessel([3_000_000, 4_000_000], [3_000_000, 4_000_000]))
    const content = container.querySelector('[data-slot="card-content"]')!
    expect(content.firstElementChild?.getAttribute('role')).toBe('alert')
    expect(screen.getByRole('alert').textContent).toContain('Числа ниже — только оценка')
    // GM, list, trim and the criteria heading.
    expect(screen.getAllByText('оценка')).toHaveLength(4)
    const gm = screen.getByText('2 м')
    expect(gm.className).toContain('text-muted-foreground')
    expect(gm.className).not.toContain('text-emerald-600')
    // No green tick or red cross vouches for a criterion.
    expect(container.querySelector('.text-emerald-600')).toBeNull()
  })

  it('outside the KN table only: GM stays a real number, the criteria are «оценка»', () => {
    renderPanel(vessel([1_000_000, 3_000_000], [3_000_000, 4_000_000]))
    expect(screen.getByRole('alert').textContent).toContain('Критерии ниже — только оценка')
    expect(screen.getAllByText('оценка')).toHaveLength(1)
    expect(screen.getByText('2 м').className).toContain('text-emerald-600')
  })
})
