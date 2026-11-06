import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { toast } from 'sonner'
import { CargoTable } from './CargoTable'
import { clearCalculatorHistory, useCalculator } from '@/store/calculator'

// The table's delete, like the list row's, is a step of the history of its
// own: «Отменить» in its toast undoes the delete and nothing before it.

const initial = useCalculator.getState()
const items = () => useCalculator.getState().items

describe('CargoTable', () => {
  beforeEach(() => {
    useCalculator.setState({ ...initial, items: [] })
    clearCalculatorHistory()
    vi.spyOn(toast, 'info').mockImplementation(() => '')
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('«Отменить» brings back a cargo deleted a moment after it was added', () => {
    render(<CargoTable placedAcrossTrips={[]} unit="m" hoveredItemId={null} onHover={() => {}} />)
    act(() => useCalculator.getState().addItem({ name: 'Ящик' }))
    fireEvent.click(screen.getByRole('button', { name: 'Удалить: Ящик' }))
    expect(items()).toEqual([])
    const options = vi.mocked(toast.info).mock.calls.at(-1)?.[1] as unknown as { action: { onClick: () => void } }
    act(() => options.action.onClick())
    expect(items().map((i) => i.name)).toEqual(['Ящик'])
  })
})
