import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { toast } from 'sonner'
import Home from './page'
import { useCalculator } from '@/store/calculator'
import { useProjects } from '@/store/projects'

// page.tsx's orchestration logic (handleRemovePinned, handleModeChange,
// handleRotatePinned/Manual, autosave, hover-throttle) has no dedicated
// export — it only exists as closures inside the Home component. These
// tests exercise it by rendering the real component and driving it through
// the DOM/store, the same way the manual browser verification did during
// development, but automated.

// The demo project auto-loaded on mount ships with ~22 pre-placed items;
// tests need a clean slate to seed their own scenario without the demo
// data's items/placements interfering with counts and array indices.
function clearDemoCargo() {
  act(() => {
    useCalculator.setState({
      items: [],
      manualPlacements: [],
      pinnedPlacementsByTrip: {},
      selectedPinIds: [],
      selectedManualIds: [],
    })
  })
}

function stubLocalStorage() {
  const storage: Record<string, string> = {}
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage[k] ?? null,
    setItem: (k: string, v: string) => { storage[k] = v },
    removeItem: (k: string) => { delete storage[k] },
  } as Storage)
  return storage
}

describe('Home (page.tsx)', () => {
  beforeEach(() => {
    stubLocalStorage()
    useProjects.setState({ projects: [], activeId: null, hydrated: false })
    vi.spyOn(toast, 'success').mockImplementation(() => '')
    vi.spyOn(toast, 'info').mockImplementation(() => '')
    vi.spyOn(toast, 'warning').mockImplementation(() => '')
    vi.spyOn(toast, 'error').mockImplementation(() => '')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('handleRemovePinned deletes the cargo (decrements quantity), not just unpins it', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, quantity: 2 })
    })
    const item = useCalculator.getState().items[0]
    act(() => {
      const pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: item.id, name: item.name, x: 1, y: 1, width: 2, length: 1, layers: 1, rotated: false, color: item.color,
      })
      useCalculator.setState({ selectedPinIds: [pinId] })
    })

    const deleteButton = document.querySelector('.absolute.left-2.top-2 button[title="Удалить"]')
    expect(deleteButton).toBeTruthy()
    fireEvent.click(deleteButton!)

    expect(useCalculator.getState().items[0].quantity).toBe(1)
    expect(useCalculator.getState().pinnedPlacementsByTrip[0] ?? []).toHaveLength(0)
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('удалён'))
  })

  it('handleLayerChangePinned("-") decrements quantity (regression: freed layer used to get auto-placed elsewhere)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, quantity: 3, height: 1 })
    })
    const item = useCalculator.getState().items[0]
    act(() => {
      const pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: item.id, name: item.name, x: 1, y: 1, width: 2, length: 1, layers: 2, rotated: false, color: item.color,
      })
      useCalculator.setState({ selectedPinIds: [pinId] })
    })

    const minusButton = document.querySelector('.absolute.left-2.top-2 button[title^="Убрать"]')
    expect(minusButton).toBeTruthy()
    fireEvent.click(minusButton!)

    // The old bug: quantity stayed at 3, so the auto-packer immediately
    // placed the freed unit somewhere else on the deck - making "-" look
    // like it moved the layer onto a different (often edge) container
    // instead of removing it. The fix must shrink quantity by 1, same as
    // the delete button does.
    expect(useCalculator.getState().items[0].quantity).toBe(2)
    const pins = Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat()
    expect(pins).toHaveLength(1)
    expect(pins[0].layers).toBe(1)
  })

  it('handleRotatePinned respects allowRotation (regression: canvas rotate used to bypass the lock)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, quantity: 1, allowRotation: false })
    })
    const item = useCalculator.getState().items[0]
    act(() => {
      const pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: item.id, name: item.name, x: 1, y: 1, width: 2, length: 1, layers: 1, rotated: false, color: item.color,
      })
      useCalculator.setState({ selectedPinIds: [pinId] })
    })

    const rotateButton = document.querySelector('.absolute.left-2.top-2 button[title="Повернуть"]')
    expect(rotateButton).toBeTruthy()
    fireEvent.click(rotateButton!)

    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('не разрешает поворот'))
    const pin = Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat()[0]
    expect(pin.rotated).toBe(false)
    expect(pin.width).toBe(2)
    expect(pin.length).toBe(1)
  })

  it('handleModeChange (auto -> manual) converts pinned placements to manual and clears pins', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, quantity: 1 })
    })
    const item = useCalculator.getState().items[0]
    act(() => {
      useCalculator.getState().pinFromPlaced(0, {
        itemId: item.id, name: item.name, x: 1, y: 1, width: 2, length: 1, layers: 1, rotated: false, color: item.color,
      })
    })
    expect(useCalculator.getState().pinnedPlacementsByTrip[0]).toHaveLength(1)

    fireEvent.click(screen.getByText('Ручной'))

    expect(useCalculator.getState().mode).toBe('manual')
    expect(useCalculator.getState().pinnedPlacementsByTrip).toEqual({})
    expect(useCalculator.getState().manualPlacements).toHaveLength(1)
    expect(useCalculator.getState().manualPlacements[0].itemId).toBe(item.id)
  })

  it('handleModeChange (manual -> auto) converts manual placements back to trip-0 pins', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    act(() => {
      useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, quantity: 1 })
    })
    const item = useCalculator.getState().items[0]
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'm1', itemId: item.id, name: item.name, x: 1, y: 1, width: 2, length: 1, layers: 1, rotated: false, color: item.color,
      })
    })

    fireEvent.click(screen.getByText('Авто'))

    expect(useCalculator.getState().mode).toBe('auto')
    expect(useCalculator.getState().manualPlacements).toHaveLength(0)
    expect(useCalculator.getState().pinnedPlacementsByTrip[0]).toHaveLength(1)
    expect(useCalculator.getState().pinnedPlacementsByTrip[0][0].itemId).toBe(item.id)
  })

  it('autosaves the active project after the debounce window', () => {
    vi.useFakeTimers()
    render(<Home />)
    clearDemoCargo()
    const activeId = useProjects.getState().activeId
    expect(activeId).toBeTruthy()

    act(() => {
      useCalculator.getState().addItem({ name: 'Autosave check', width: 3, length: 3, quantity: 1 })
    })
    // Not persisted yet — still inside the debounce window.
    expect(
      useProjects.getState().projects.find((p) => p.id === activeId)?.items.some((it) => it.name === 'Autosave check')
    ).toBe(false)

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(
      useProjects.getState().projects.find((p) => p.id === activeId)?.items.some((it) => it.name === 'Autosave check')
    ).toBe(true)
  })

  it('coalesces rapid list-hover events into a single requestAnimationFrame per burst', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 1, length: 1, quantity: 1 })
      useCalculator.getState().addItem({ name: 'B', width: 1, length: 1, quantity: 1 })
      useCalculator.getState().addItem({ name: 'C', width: 1, length: 1, quantity: 1 })
    })

    const rafSpy = vi.spyOn(window, 'requestAnimationFrame')
    const rows = document.querySelectorAll('.rounded-lg.border.bg-card.p-3')
    expect(rows.length).toBeGreaterThan(1)
    act(() => {
      rows.forEach((row) => {
        fireEvent.mouseOver(row)
        fireEvent.mouseOut(row)
      })
    })

    expect(rafSpy).toHaveBeenCalledTimes(1)
  })
})
