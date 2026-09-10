import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ItemList } from './ItemList'
import { useCalculator } from '@/store/calculator'
import type { PackingResult } from '@/lib/packing'

function emptyResult(): PackingResult {
  return {
    placed: [],
    unplaced: [],
    quarantined: [],
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
  }
}

describe('ItemList', () => {
  beforeEach(() => {
    useCalculator.setState({
      items: [],
      globalRotation: true,
    })
  })

  it('shows empty state when no items', () => {
    render(<ItemList result={emptyResult()} unit="m" hoveredItemId={null} onHover={() => {}} />)
    expect(screen.getByText('Список грузов пуст')).toBeInTheDocument()
  })

  it('renders items from the store', () => {
    useCalculator.setState({
      items: [
        { id: 'i1', name: 'Box', width: 2, length: 1, height: 0.5, quantity: 5, color: '#0ea5e9', allowRotation: true, weight: 100 },
      ],
      globalRotation: true,
    })
    render(<ItemList result={emptyResult()} unit="m" hoveredItemId={null} onHover={() => {}} />)
    expect(screen.getByText('Box')).toBeInTheDocument()
    expect(screen.getByText('0/5 разм.')).toBeInTheDocument()
  })

  it('displays placed count per item', () => {
    useCalculator.setState({
      items: [
        { id: 'i1', name: 'Box', width: 2, length: 1, height: 0.5, quantity: 5, color: '#0ea5e9', allowRotation: true, weight: 100 },
      ],
      globalRotation: true,
    })
    render(
      <ItemList
        result={{
          ...emptyResult(),
          placed: [
            { itemId: 'i1', name: 'Box', x: 0, y: 0, width: 2, length: 1, height: 0, layers: 2, stackedCount: 2, rotated: false, color: '#0ea5e9', weight: 100, index: 0 },
          ],
        }}
        unit="m"
        hoveredItemId={null}
        onHover={() => {}}
      />
    )
    expect(screen.getByText('2/5 разм.')).toBeInTheDocument()
  })
})
