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

  // Round 16 — composition-aware handleRemovePinned. Before this fix, the
  // whole pin's layer count (5) was decremented from the NOMINAL itemId's
  // (A) own quantity, leaving B's quantity completely untouched even though
  // 3 real units of B are physically inside this pin — this test pins the
  // exact classic bug the review named: [A2,B3] -> old code did A-=5, B-=0;
  // correct is A-=2, B-=3.
  it('handleRemovePinned (composition-aware): a composed pin decreases EACH constituent\'s own quantity, not just the nominal itemId\'s', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, quantity: 5 })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, quantity: 5 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      const pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      // Hand-built composition, same technique used throughout the
      // migration's test suite since Round 13 — no real merge UI creates
      // this yet.
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
      })
      useCalculator.setState({ selectedPinIds: [pinId] })
    })

    const xCircle = document.querySelector('svg circle[fill="#ef4444"]')
    expect(xCircle).toBeTruthy()
    fireEvent.click(xCircle!)

    expect(useCalculator.getState().items.find((it) => it.id === itemA.id)?.quantity).toBe(3) // 5 - 2
    expect(useCalculator.getState().items.find((it) => it.id === itemB.id)?.quantity).toBe(2) // 5 - 3
    expect(useCalculator.getState().pinnedPlacementsByTrip[0] ?? []).toHaveLength(0)
  })

  // Round 16 acceptance scenario D — full placement removal with a
  // non-adjacent same-itemId composition: [A2,B3,A1]. Deleting this ONE
  // placement must decrement A by 3 (2+1, BOTH A segments summed, not just
  // the first one encountered) and B by 3 — proves the aggregation-by-
  // itemId step in handleRemovePinned (needed because a composition can
  // list the same itemId more than once) actually runs correctly end-to-end
  // through the real ✕-button click handler, not just in isolation.
  it('handleRemovePinned (composition-aware): [A2,B3,A1] — non-adjacent A segments are summed before decrementing, not just the first one', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, quantity: 5 })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, quantity: 5 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      const pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 6, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }, { itemId: itemA.id, layers: 1 }],
      })
      useCalculator.setState({ selectedPinIds: [pinId] })
    })

    const xCircle = document.querySelector('svg circle[fill="#ef4444"]')
    expect(xCircle).toBeTruthy()
    fireEvent.click(xCircle!)

    expect(useCalculator.getState().items.find((it) => it.id === itemA.id)?.quantity).toBe(2) // 5 - (2+1)
    expect(useCalculator.getState().items.find((it) => it.id === itemB.id)?.quantity).toBe(2) // 5 - 3
    expect(useCalculator.getState().pinnedPlacementsByTrip[0] ?? []).toHaveLength(0)
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

  // Round 17 (capacity verification) — investigate-first scenarios 1-4 from
  // the review: wouldExceedMaxDeckCargo (page.tsx) actually gates the "+"
  // button's fresh-unit path (no merge source available) in BOTH modes,
  // exactly at the limit (allowed) and just over it (blocked). This is the
  // real end-to-end wiring, not just the underlying wouldExceedDeckCapacity
  // arithmetic (already exhaustively unit-tested in cargoValidation.test.ts).
  it('wouldExceedMaxDeckCargo (MANUAL): "+" is allowed exactly at the limit, blocked just over it', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, clearance: 5, maxDeckCargoT: 1 } }) // 1000kg cap
      useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, quantity: 2, height: 1, weight: 500 })
    })
    const item = useCalculator.getState().items[0]
    act(() => {
      // ONE placement only — no merge source, so "+" must pull a fresh
      // unplaced unit and go through the capacity guard.
      useCalculator.getState().addManualPlacement({
        id: 'mA', itemId: item.id, name: item.name, x: 1, y: 1, width: 2, length: 1, layers: 1, rotated: false, color: item.color, weight: 500,
      })
      useCalculator.setState({ selectedManualIds: ['mA'] })
    })

    // 500 (placed) + 500 (new) = 1000 kg = exactly the 1t cap -> allowed.
    const plusCircle = document.querySelector('svg circle[fill="#0ea5e9"]')
    fireEvent.click(plusCircle!)
    expect(useCalculator.getState().manualPlacements.find((m) => m.id === 'mA')?.layers).toBe(2)
    expect(toast.error).not.toHaveBeenCalled()

    // A third unit would push to 1500kg > 1000kg -> blocked, layers unchanged.
    fireEvent.click(document.querySelector('svg circle[fill="#0ea5e9"]')!)
    expect(useCalculator.getState().manualPlacements.find((m) => m.id === 'mA')?.layers).toBe(2)
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('лимит груза'))
  })

  it('wouldExceedMaxDeckCargo (AUTO/pinned): "+" is allowed exactly at the limit, blocked just over it, scoped to the CURRENT trip only', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      // Deck sized to fit exactly ONE 2x1 footprint (no room for AUTO to
      // auto-place a second, unpinned unit of the item's remaining
      // quantity) — otherwise "+" would find that free auto-placed
      // instance and MERGE it (a different, uncapped code path) instead of
      // exercising the capacity-guarded fresh-unit path this test targets.
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, width: 2.2, length: 1.2, boardOffset: 0, gap: 0.1, clearance: 5, maxDeckCargoT: 1 } })
      useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, quantity: 2, height: 1, weight: 500 })
    })
    const item = useCalculator.getState().items[0]
    let pinId = ''
    act(() => {
      pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: item.id, name: item.name, x: 0.1, y: 0.1, width: 2, length: 1, layers: 1, rotated: false, color: item.color, weight: 500,
      })
      useCalculator.setState({ selectedPinIds: [pinId] })
    })

    // 500 + 500 = 1000kg exactly at the cap -> allowed.
    fireEvent.click(document.querySelector('svg circle[fill="#0ea5e9"]')!)
    expect(useCalculator.getState().pinnedPlacementsByTrip[0].find((p) => p.id === pinId)?.layers).toBe(2)
    expect(toast.error).not.toHaveBeenCalled()

    // A third unit (1500kg) on the SAME trip -> blocked. Bump quantity so
    // checkLayerChange's own budget doesn't reject it for an unrelated
    // reason before the capacity guard even runs.
    act(() => {
      useCalculator.getState().updateItem(item.id, { quantity: 3 })
    })
    fireEvent.click(document.querySelector('svg circle[fill="#0ea5e9"]')!)
    expect(useCalculator.getState().pinnedPlacementsByTrip[0].find((p) => p.id === pinId)?.layers).toBe(2)
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('лимит груза'))
  })

  // Round 17 acceptance scenario 5: maxDeckCargoT is the vessel's own
  // PER-TRIP capacity — a trip already sitting exactly at the cap must
  // never block a "+" on a DIFFERENT trip that still has headroom.
  it('wouldExceedMaxDeckCargo (AUTO/pinned): a trip already AT its cap does not block "+" on a DIFFERENT trip', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, width: 2.2, length: 1.2, boardOffset: 0, gap: 0.1, clearance: 5, maxDeckCargoT: 1 } })
      useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, quantity: 4, height: 1, weight: 500 })
    })
    const item = useCalculator.getState().items[0]
    let trip1PinId = ''
    act(() => {
      // Trip 0: already exactly AT the 1000kg cap.
      useCalculator.getState().pinFromPlaced(0, {
        itemId: item.id, name: item.name, x: 0.1, y: 0.1, width: 2, length: 1, layers: 2, rotated: false, color: item.color, weight: 500,
      })
      // Trip 1: only 500kg so far — plenty of headroom on ITS OWN budget.
      trip1PinId = useCalculator.getState().pinFromPlaced(1, {
        itemId: item.id, name: item.name, x: 0.1, y: 0.1, width: 2, length: 1, layers: 1, rotated: false, color: item.color, weight: 500,
      })
    })

    fireEvent.click(screen.getByText(/Рейс 2/))
    act(() => {
      useCalculator.setState({ selectedPinIds: [trip1PinId] })
    })

    // Trip 1: 500 + 500 = 1000kg exactly at ITS OWN cap -> allowed, despite
    // trip 0 already sitting at its own (separate) 1000kg cap.
    fireEvent.click(document.querySelector('svg circle[fill="#0ea5e9"]')!)
    expect(useCalculator.getState().pinnedPlacementsByTrip[1].find((p) => p.id === trip1PinId)?.layers).toBe(2)
    expect(useCalculator.getState().pinnedPlacementsByTrip[0][0].layers).toBe(2) // trip 0 completely untouched
    expect(toast.error).not.toHaveBeenCalled()
  })

  // Note: composed-placement capacity (scenario 6 from the review) is
  // deliberately NOT exercised through the "+" button here — "+" invokes
  // handleLayerChangePinned, whose fresh-unit weight is `pin.weight ?? 0`
  // (undefined/0 for a composed placement, since composition is its source
  // of truth) — a composition-aware "+" is explicitly Round 21 scope
  // (push/pop segments), out of bounds for Round 17. The composed-weight
  // fix itself is verified directly and thoroughly in
  // cargoValidation.test.ts's "composition-aware weight (Round 17)" suite,
  // which is what wouldExceedMaxDeckCargo actually calls into.

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

  // Regression (Round 12): a cross-item merge folding in an item whose
  // CargoItem.allowRotation is false used to leave the merged (surviving)
  // placement's rotation permission resolved purely from ITS OWN itemId's
  // catalog allowRotation — silently forgetting the dragged item's
  // restriction the moment that item's own placement was removed by the
  // merge. rotationLocked is the persistent flag a merge sets to close
  // that gap; this proves it's actually honored by the rotate path even
  // when the placement's own itemId currently allows rotation.
  it('handleRotatePinned respects rotationLocked even when the placement\'s own item allows rotation', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, quantity: 1, allowRotation: true })
    })
    const item = useCalculator.getState().items[0]
    act(() => {
      const pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: item.id, name: item.name, x: 1, y: 1, width: 2, length: 1, layers: 1, rotated: false, color: item.color,
      })
      useCalculator.getState().updatePinned(0, pinId, { rotationLocked: true })
      useCalculator.setState({ selectedPinIds: [pinId] })
    })

    const rotateCircle = document.querySelector('svg circle[fill="#7c3aed"]')
    expect(rotateCircle).toBeTruthy()
    fireEvent.click(rotateCircle!)

    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('не разрешает поворот'))
    const pin = Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat()[0]
    expect(pin.rotated).toBe(false)
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
    // The single trip being converted is cleared (its data now lives in
    // manualPlacements) — but the map itself isn't wiped to {} anymore, see
    // the multi-trip regression test below for why that distinction matters.
    expect(useCalculator.getState().pinnedPlacementsByTrip).toEqual({ 0: [] })
    expect(useCalculator.getState().manualPlacements).toHaveLength(1)
    expect(useCalculator.getState().manualPlacements[0].itemId).toBe(item.id)
  })

  // Regression: handleModeChange used to convert ONLY the currently-viewed
  // trip and then wipe pinnedPlacementsByTrip to {} entirely (AUTO->MANUAL)
  // or hard-code everything into trip 0 (MANUAL->AUTO), silently destroying
  // every other trip's pins. A real multi-trip plan (not trip 0) is the
  // only way to catch this — the two tests above only ever exercised a
  // single trip, where wiping {} and writing {0: ...} looked identical to
  // "correct."
  it('preserves OTHER trips when switching mode while viewing a non-zero trip, both directions', () => {
    render(<Home />)
    clearDemoCargo()
    // A deck that fits exactly one 2x1 unit per trip forces packMultiTrip
    // to actually generate a second trip instead of fitting everything on
    // trip 0 alone.
    act(() => {
      useCalculator.getState().setDeck({ width: 3, length: 1, gap: 0, boardOffset: 0 })
      useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, quantity: 2 })
    })
    const item = useCalculator.getState().items[0]
    act(() => {
      useCalculator.getState().pinFromPlaced(0, {
        itemId: item.id, name: item.name, x: 0, y: 0, width: 2, length: 1, layers: 1, rotated: false, color: item.color,
      })
      useCalculator.getState().pinFromPlaced(1, {
        itemId: item.id, name: item.name, x: 0, y: 0, width: 2, length: 1, layers: 1, rotated: false, color: item.color,
      })
    })
    expect(useCalculator.getState().pinnedPlacementsByTrip[0]).toHaveLength(1)
    expect(useCalculator.getState().pinnedPlacementsByTrip[1]).toHaveLength(1)

    // Switch to trip 2 (index 1) before switching mode.
    fireEvent.click(screen.getByText(/Рейс 2/))
    fireEvent.click(screen.getByText('Ручной'))

    expect(useCalculator.getState().mode).toBe('manual')
    // Trip 0's pin must survive completely untouched.
    expect(useCalculator.getState().pinnedPlacementsByTrip[0]).toHaveLength(1)
    expect(useCalculator.getState().pinnedPlacementsByTrip[0][0].itemId).toBe(item.id)
    // Trip 1 (the one being edited) is now represented as manual instead.
    expect(useCalculator.getState().pinnedPlacementsByTrip[1]).toEqual([])
    expect(useCalculator.getState().manualPlacements).toHaveLength(1)

    // Switch back to AUTO — the edit must land back in trip 1, not trip 0.
    fireEvent.click(screen.getByRole('radio', { name: 'Авто' }))

    expect(useCalculator.getState().mode).toBe('auto')
    expect(useCalculator.getState().manualPlacements).toHaveLength(0)
    expect(useCalculator.getState().pinnedPlacementsByTrip[0]).toHaveLength(1)
    expect(useCalculator.getState().pinnedPlacementsByTrip[0][0].itemId).toBe(item.id)
    expect(useCalculator.getState().pinnedPlacementsByTrip[1]).toHaveLength(1)
    expect(useCalculator.getState().pinnedPlacementsByTrip[1][0].itemId).toBe(item.id)
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

    // getByText('Авто') is now ambiguous — PlacementPanel's preset category
    // picker also has an "Авто" (vehicles) button. Scope to the mode toggle.
    fireEvent.click(screen.getByRole('radio', { name: 'Авто' }))

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
