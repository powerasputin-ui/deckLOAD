import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatsPanel } from './StatsPanel'
import type { PackingResult } from '@/lib/packing'

function makeResult(overrides: Partial<PackingResult> = {}): PackingResult {
  return {
    placed: [],
    unplaced: [],
    breakdown: [],
    requestedCount: 0,
    placedCount: 0,
    totalArea: 100,
    usedArea: 0,
    freeArea: 100,
    utilization: 0,
    totalWeight: 0,
    maxStackHeight: 0,
    deckWidth: 10,
    deckLength: 10,
    ...overrides,
  }
}

describe('StatsPanel', () => {
  it('renders utilization percentage', () => {
    render(<StatsPanel result={makeResult({ utilization: 0.7654 })} unit="m" />)
    expect(screen.getByText('77%')).toBeInTheDocument()
  })

  it('shows 0% utilization when empty', () => {
    render(<StatsPanel result={makeResult()} unit="m" />)
    // The progress labels also contain "0%"; target the main utilization value.
    expect(screen.getByText('Коэффициент загрузки').nextElementSibling).toHaveTextContent('0%')
  })

  it('shows unplaced count', () => {
    render(
      <StatsPanel
        result={makeResult({
          requestedCount: 10,
          placedCount: 6,
          unplaced: [{ itemId: 'a', name: 'Box', width: 1, length: 1, reason: 'too big' }],
        })}
        unit="m"
      />
    )
    expect(screen.getByText('4')).toBeInTheDocument()
  })

  it('does not show negative unplaced count', () => {
    render(
      <StatsPanel
        result={makeResult({ requestedCount: 5, placedCount: 8 })}
        unit="m"
      />
    )
    expect(screen.getAllByText('0').length).toBeGreaterThan(0)
  })

  it('shows max stack height when positive', () => {
    render(<StatsPanel result={makeResult({ maxStackHeight: 4.5 })} unit="m" />)
    expect(screen.getByText(/Макс\. высота штабеля/)).toBeInTheDocument()
    const row = screen.getByText(/Макс\. высота штабеля/).closest('div')
    expect(row).toHaveTextContent('4.50 м')
  })

  it('shows breakdown row for placed items', () => {
    render(
      <StatsPanel
        result={makeResult({
          placedCount: 3,
          requestedCount: 5,
          breakdown: [
            {
              itemId: 'a',
              name: 'Box',
              color: '#0ea5e9',
              requested: 5,
              placed: 3,
              footprints: 2,
              layers: 2,
              area: 6,
              weight: 300,
              unitWeight: 100,
            },
          ],
        })}
        unit="m"
      />
    )
    expect(screen.getByText('Box')).toBeInTheDocument()
    expect(screen.getByText('3/5')).toBeInTheDocument()
  })

  it('renders dash for non-finite numbers', () => {
    render(
      <StatsPanel
        result={makeResult({ totalWeight: NaN, maxStackHeight: Infinity })}
        unit="m"
      />
    )
    // Weight tile shows dash
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })
})
