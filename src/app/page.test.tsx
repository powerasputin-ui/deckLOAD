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

    const xCircle = document.querySelector('svg circle[fill="#ef4444"]')
    expect(xCircle).toBeTruthy()
    fireEvent.click(xCircle!)

    expect(useCalculator.getState().items[0].quantity).toBe(1)
    expect(useCalculator.getState().pinnedPlacementsByTrip[0] ?? []).toHaveLength(0)
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('удалён'))
  })

it('handleLayerChangePinned("-") pins the freed unit as its own placement (regression: freed units re-stacked onto each other)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, quantity: 4, height: 1 })
    })
    const item = useCalculator.getState().items[0]
    let pinAId = ''
    let pinBId = ''
    act(() => {
      pinAId = useCalculator.getState().pinFromPlaced(0, {
        itemId: item.id, name: item.name, x: 1, y: 1, width: 2, length: 1, layers: 2, rotated: false, color: item.color,
      })
      pinBId = useCalculator.getState().pinFromPlaced(0, {
        itemId: item.id, name: item.name, x: 4, y: 1, width: 2, length: 1, layers: 2, rotated: false, color: item.color,
      })
    })

    // Reduce pin A by one layer, then pin B by one layer - same sequence as
    // the reported bug (two "-" clicks on two separate stacks of the same
    // item).
    act(() => {
      useCalculator.setState({ selectedPinIds: [pinAId] })
    })
    fireEvent.click(document.querySelector('svg circle[fill="#f59e0b"]')!)
    act(() => {
      useCalculator.setState({ selectedPinIds: [pinBId] })
    })
    fireEvent.click(document.querySelector('svg circle[fill="#f59e0b"]')!)

    // The old bug: both freed units landed in the auto-packer's shared
    // "remaining quantity" pool, which stacks same-item leftovers up to their
    // physical limit by default - so the second freed unit silently restacked
    // onto the first instead of standing on its own. Expect 4 independent
    // single-layer pins (2 originals + 2 freed), none of them stacked.
    const pins = Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat()
    expect(pins).toHaveLength(4)
    expect(pins.every((p) => p.layers === 1)).toBe(true)
    expect(useCalculator.getState().items[0].quantity).toBe(4)
  })

  it('handleLayerChangePinned("+") pulls an existing placement off the deck instead of only unplaced quantity', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, clearance: 5 } })
      useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, quantity: 2, height: 1 })
    })
    const item = useCalculator.getState().items[0]
    let pinAId = ''
    let pinBId = ''
    act(() => {
      pinAId = useCalculator.getState().pinFromPlaced(0, {
        itemId: item.id, name: item.name, x: 1, y: 1, width: 2, length: 1, layers: 1, rotated: false, color: item.color,
      })
      pinBId = useCalculator.getState().pinFromPlaced(0, {
        itemId: item.id, name: item.name, x: 4, y: 1, width: 2, length: 1, layers: 1, rotated: false, color: item.color,
      })
      useCalculator.setState({ selectedPinIds: [pinAId] })
    })

    // Both units of this item's quantity are already placed (as two separate
    // pins) - the old behavior only pulled from *unplaced* quantity, so "+"
    // would be blocked here with "all N units already placed" even though a
    // second container of the same item is sitting right there on the deck.
    const plusCircle = document.querySelector('svg circle[fill="#0ea5e9"]')
    expect(plusCircle).toBeTruthy()
    fireEvent.click(plusCircle!)

    const pins = Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat()
    expect(pins).toHaveLength(1)
    expect(pins[0].id).toBe(pinAId)
    expect(pins[0].layers).toBe(2)
    expect(pins.some((p) => p.id === pinBId)).toBe(false)
    expect(useCalculator.getState().items[0].quantity).toBe(2)
  })

  it('handleLayerChangeManual("-") stands the freed unit up as its own placement, same as the pinned version', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    act(() => {
      useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, quantity: 3, height: 1 })
    })
    const item = useCalculator.getState().items[0]
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'm1', itemId: item.id, name: item.name, x: 1, y: 1, width: 2, length: 1, layers: 2, rotated: false, color: item.color,
      })
      useCalculator.setState({ selectedManualIds: ['m1'] })
    })

    const minusCircle = document.querySelector('svg circle[fill="#f59e0b"]')
    expect(minusCircle).toBeTruthy()
    fireEvent.click(minusCircle!)

    // Same expectation as the pinned regression test: the freed unit should
    // land as its own separate single-layer placement, not vanish.
    const placements = useCalculator.getState().manualPlacements
    expect(placements).toHaveLength(2)
    expect(placements.every((p) => p.layers === 1)).toBe(true)
    expect(useCalculator.getState().items[0].quantity).toBe(3)
  })

  it('handleLayerChangeManual("+") pulls an existing placement off the deck instead of only unplaced quantity', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, clearance: 5 } })
      useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, quantity: 2, height: 1 })
    })
    const item = useCalculator.getState().items[0]
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'mA', itemId: item.id, name: item.name, x: 1, y: 1, width: 2, length: 1, layers: 1, rotated: false, color: item.color,
      })
      useCalculator.getState().addManualPlacement({
        id: 'mB', itemId: item.id, name: item.name, x: 4, y: 1, width: 2, length: 1, layers: 1, rotated: false, color: item.color,
      })
      useCalculator.setState({ selectedManualIds: ['mA'] })
    })

    const plusCircle = document.querySelector('svg circle[fill="#0ea5e9"]')
    expect(plusCircle).toBeTruthy()
    fireEvent.click(plusCircle!)

    const placements = useCalculator.getState().manualPlacements
    expect(placements).toHaveLength(1)
    expect(placements[0].id).toBe('mA')
    expect(placements[0].layers).toBe(2)
    expect(useCalculator.getState().items[0].quantity).toBe(2)
  })

  it('selecting different auto-redistribute variants actually applies each one (regression: applyVariant ignored the chosen variant in auto mode)', () => {
    render(<Home />)
    // Keep the demo cargo (~22 units across 3 item types) so packDeckVariants
    // has enough to produce multiple genuinely distinct layouts.
    fireEvent.click(screen.getByRole('button', { name: /Автораспределение/ }))

    const variantButtons = screen.getAllByText(/^Вариант \d/)
    expect(variantButtons.length).toBeGreaterThanOrEqual(2)

    fireEvent.click(variantButtons[0])
    const afterFirst = JSON.stringify(useCalculator.getState().pinnedPlacementsByTrip)

    fireEvent.click(variantButtons[1])
    const afterSecond = JSON.stringify(useCalculator.getState().pinnedPlacementsByTrip)

    // The old bug: applyVariant's auto-mode branch just cleared pins and let
    // the live recompute (using whatever sortStrategy the store already had)
    // redraw, ignoring the variant's own strategy/seed entirely - so picking
    // "Вариант 1" vs "Вариант 2" produced the identical layout every time.
    expect(afterFirst).not.toBe(afterSecond)
    // Both should actually be pinned (locked to that variant), not empty.
    expect(Object.values(JSON.parse(afterFirst)).flat().length).toBeGreaterThan(0)
    expect(Object.values(JSON.parse(afterSecond)).flat().length).toBeGreaterThan(0)
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

    const rotateCircle = document.querySelector('svg circle[fill="#7c3aed"]')
    expect(rotateCircle).toBeTruthy()
    fireEvent.click(rotateCircle!)

    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('не разрешает поворот'))
    const pin = Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat()[0]
    expect(pin.rotated).toBe(false)
    expect(pin.width).toBe(2)
    expect(pin.length).toBe(1)
  })

  it('warns (once) when a placement newly exceeds a load zone\'s density limit', async () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, quantity: 1, weight: 5000 })
    })
    const item = useCalculator.getState().items[0]
    act(() => {
      useCalculator.getState().pinFromPlaced(0, {
        itemId: item.id, name: item.name, x: 1, y: 1, width: 2, length: 1, layers: 1, rotated: false, color: item.color, weight: 5000,
      })
    })
    expect(toast.warning).not.toHaveBeenCalledWith(expect.stringContaining('Перегрузка'))

    // A zone covering the placement with a limit low enough that 5000kg/2m²
    // (2.5 t/m²) exceeds it.
    act(() => {
      useCalculator.getState().addLoadZone({ x: 0, y: 0, width: 5, length: 5, maxLoadPerArea: 0.1 })
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('Перегрузка'))

    // Re-render for an unrelated reason (toggling a display setting) should
    // NOT re-fire the warning - the overloaded count hasn't changed.
    const warningCallsAfterFirst = (toast.warning as unknown as { mock: { calls: unknown[] } }).mock.calls.length
    act(() => {
      useCalculator.getState().toggleGrid()
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect((toast.warning as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(warningCallsAfterFirst)
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
