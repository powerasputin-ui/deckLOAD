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

  // Round 21 — composed "+"/"-" wiring (C2). handleLayerChangePinned/Manual
  // branch on `composition` and call placementPush/placementPop directly
  // instead of the merge-lookup path above. Hand-built composition, same
  // technique used throughout the migration's test suite since Round 13 —
  // no real merge UI creates this yet (dormant in production until Round 24).
  it('handleLayerChangePinned("+"/"-") on a composed pin: pushes the NOMINAL itemId (K#7c), pops the PHYSICAL top segment, and reverses cleanly (K#7)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, clearance: 5 } })
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 10, weight: 100 })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 10, weight: 200 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    let pinId = ''
    act(() => {
      pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        layers: 5,
      })
      useCalculator.setState({ selectedPinIds: [pinId] })
    })

    // "+" pushes ONE MORE unit of the placement's own NOMINAL itemId (A) —
    // the top segment is B, so it does NOT coalesce; a new trailing A
    // segment is appended instead.
    fireEvent.click(document.querySelector('svg circle[fill="#0ea5e9"]')!)
    let pin = useCalculator.getState().pinnedPlacementsByTrip[0].find((p) => p.id === pinId)!
    expect(pin.composition).toEqual([
      { itemId: itemA.id, layers: 2 },
      { itemId: itemB.id, layers: 3 },
      { itemId: itemA.id, layers: 1 },
    ])
    expect(pin.layers).toBe(6)
    expect(pin.weight).toBeCloseTo((2 * 100 + 3 * 200 + 1 * 100) / 6) // per-unit average, not total
    expect(toast.error).not.toHaveBeenCalled()

    // "-" pops the PHYSICALLY topmost segment (the A,1 just pushed), not
    // the placement's nominal itemId in the abstract — reverses the "+"
    // exactly, back to the original two-segment composition.
    fireEvent.click(document.querySelector('svg circle[fill="#f59e0b"]')!)
    pin = useCalculator.getState().pinnedPlacementsByTrip[0].find((p) => p.id === pinId)!
    expect(pin.composition).toEqual([{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }])
    expect(pin.layers).toBe(5)
    expect(pin.weight).toBeCloseTo((2 * 100 + 3 * 200) / 5)
    // The freed A unit stands up as its own independent single-layer pin,
    // same standup behavior as the uncomposed "-" path.
    const others = Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat().filter((p) => p.id !== pinId)
    expect(others).toHaveLength(1)
    expect(others[0].itemId).toBe(itemA.id)
    expect(others[0].layers).toBe(1)
    // Round 21 corrective pass: Round 16's quantity-direction invariant —
    // composed "+"/"-" must not introduce any NEW items[].quantity
    // mutation (freeing a unit just redistributes it across placements,
    // it never touches the catalog's own count). Both items' quantity
    // must read exactly as seeded, unchanged by the whole "+" then "-"
    // sequence above.
    expect(useCalculator.getState().items.find((it) => it.id === itemA.id)?.quantity).toBe(10)
    expect(useCalculator.getState().items.find((it) => it.id === itemB.id)?.quantity).toBe(10)
  })

  // K#8: popping the physically topmost segment can free a DIFFERENT item
  // than the placement's own nominal itemId, and popping down to exactly
  // one remaining constituent must un-compose the placement back to an
  // ordinary single-item one (identity transferring to the survivor).
  it('handleLayerChangeManual("-") on a composed placement pops the top segment even when it is NOT the nominal itemId, and un-composes at one constituent left (K#8)', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, quantity: 10, weight: 100 })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, quantity: 10, weight: 200 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'mComp', itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 3, rotated: false, color: itemA.color,
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 1 }],
      })
      useCalculator.setState({ selectedManualIds: ['mComp'] })
    })

    // Top segment is B (layers: 1) — popping removes it ENTIRELY, freeing a
    // B unit, not an A unit, even though the placement's nominal itemId is A.
    fireEvent.click(document.querySelector('svg circle[fill="#f59e0b"]')!)

    const placements = useCalculator.getState().manualPlacements
    const composed = placements.find((p) => p.id === 'mComp')!
    // Only A (layers: 2) survives -> un-composed back to an ordinary
    // placement, composition gone, itemId/layers/weight independently set.
    expect(composed.composition).toBeUndefined()
    expect(composed.itemId).toBe(itemA.id)
    expect(composed.layers).toBe(2)
    expect(composed.weight).toBe(100)

    const freed = placements.find((p) => p.id !== 'mComp')
    expect(freed).toBeTruthy()
    expect(freed?.itemId).toBe(itemB.id) // freed unit is B, not A
    expect(freed?.layers).toBe(1)
    // Round 21 corrective pass: same quantity-direction invariant as the
    // pinned test above — no new updateItem(...quantity...) introduced.
    expect(useCalculator.getState().items.find((it) => it.id === itemA.id)?.quantity).toBe(10)
    expect(useCalculator.getState().items.find((it) => it.id === itemB.id)?.quantity).toBe(10)
  })

  // Round 21 corrective pass — real FAIL found by acceptance review:
  // findMergeSourcePinned/Manual filtered candidates by `p.itemId ===
  // itemId` alone, with no check for `.composition`. A composed
  // placement's NOMINAL itemId can coincidentally match a separate,
  // ordinary placement's itemId — before this fix, clicking "+" on that
  // ordinary placement would find the COMPOSED one as a merge source and
  // feed it straight into handleMergePinned/Manual, which is still the old
  // composition-BLIND writer: it blends `weight`/`layers` as flat fields
  // and deletes the dragged placement outright, permanently discarding
  // every non-nominal constituent's provenance and quantity attribution
  // (here, all 3 units of B would silently vanish from tracking).
  it('handleLayerChangePinned("+") on an ORDINARY placement never absorbs a composed placement sharing its nominal itemId (findMergeSourcePinned FAIL fix)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      // Deck sized to fit EXACTLY the two 2x1 footprints below and no
      // third one anywhere — this keeps findMergeSourcePinned's SECOND
      // branch (an auto-placed "free instance" of remaining unplaced A
      // quantity) deterministically empty, so the only thing this test
      // exercises is the FIRST branch (scanning existing pins), which is
      // exactly what the guard fixes. Quantity is deliberately generous
      // (10, far above what's placed) so that WITHOUT the guard, the old
      // code's merge into the composed pin would actually succeed (not
      // get coincidentally blocked by an unrelated quantity/height cap) —
      // a weaker version of this test with quantity=3 passed even against
      // the pre-fix code, for the wrong reason (merge blocked by the
      // shared-quantity cap either way); this version's headroom makes the
      // guard itself the only thing standing between pass and fail.
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, width: 4.3, length: 1.2, boardOffset: 0, gap: 0.1, clearance: 20 } })
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 10, weight: 100 })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 10, weight: 200 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    let composedPinId = ''
    let plainPinId = ''
    act(() => {
      // The composed placement's NOMINAL itemId is A — the exact scenario
      // the review flagged: a plain A pin exists separately.
      composedPinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 0.1, y: 0.1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, composedPinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        layers: 5,
      })
      plainPinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 2.2, y: 0.1, width: 2, length: 1, layers: 1, rotated: false, color: itemA.color, weight: 100,
      })
      useCalculator.setState({ selectedPinIds: [plainPinId] })
    })

    // "+" on the PLAIN pin — before the fix, findMergeSourcePinned(A, ...)
    // returned the composed pin (its own itemId is also A) as the merge
    // source, and handleMergePinned — still composition-blind — absorbed
    // it: blended `layers`/`weight` as flat fields and DELETED the
    // composed placement outright, discarding B's provenance/quantity
    // permanently. With generous quantity and no competing auto-placed
    // instance, that merge would have gone through cleanly under the old
    // code, making this assertion fail without the guard.
    fireEvent.click(document.querySelector('svg circle[fill="#0ea5e9"]')!)

    const pins = Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat()
    // The composed placement must still exist, completely untouched — not
    // absorbed, not blended, composition intact.
    const composed = pins.find((p) => p.id === composedPinId)
    expect(composed).toBeTruthy()
    expect(composed?.composition).toEqual([{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }])
    expect(composed?.layers).toBe(5)
    // No valid uncomposed merge source and no free instance (deck full) —
    // "+" falls through to the ordinary fresh-unit pull, exactly +1 layer.
    const plain = pins.find((p) => p.id === plainPinId)
    expect(plain?.layers).toBe(2)
    expect(pins).toHaveLength(2) // composed + plain — nothing deleted, nothing new created
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.warning).not.toHaveBeenCalled()
  })

  // K#7d-strong: the SAME scenario as K#7d below but with quantity set so
  // the two possible implementations give DIFFERENT answers — proving
  // checkLayerChange is actually called with the nominal itemId's OWN
  // count within this placement (placementLayersOfItem, 2), not the
  // placement's flat total `layers` (5). With quantity=4: own-count-based
  // reasoning (2+1=3) correctly ALLOWS the push; a total-layers-based
  // reasoning (5+1=6) would have wrongly BLOCKED it. K#7d below (a
  // genuinely exhausted quantity=2) blocks under BOTH reasonings, so it
  // alone can't prove which one is actually used — this test can.
  it('handleLayerChangePinned("+") on a composed pin: quantity-check uses the nominal itemId\'s OWN layer count in this placement, not the flat total (K#7d-strong)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, clearance: 5 } })
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 4, weight: 100 })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 10, weight: 200 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    let pinId = ''
    act(() => {
      pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        layers: 5,
      })
      useCalculator.setState({ selectedPinIds: [pinId] })
    })

    fireEvent.click(document.querySelector('svg circle[fill="#0ea5e9"]')!)

    const pin = useCalculator.getState().pinnedPlacementsByTrip[0].find((p) => p.id === pinId)!
    expect(pin.composition).toEqual([{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }, { itemId: itemA.id, layers: 1 }])
    expect(pin.layers).toBe(6)
    expect(toast.warning).not.toHaveBeenCalled()
  })

  // Same guard, manual-mode path (findMergeSourceManual).
  it('handleLayerChangeManual("+") on an ORDINARY placement never absorbs a composed placement sharing its nominal itemId (findMergeSourceManual FAIL fix)', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, clearance: 5 } })
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 10, weight: 100 })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 10, weight: 200 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'mComposed', itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
      })
      useCalculator.getState().addManualPlacement({
        id: 'mPlain', itemId: itemA.id, name: itemA.name, x: 4, y: 1, width: 2, length: 1, layers: 1, rotated: false, color: itemA.color, weight: 100,
      })
      useCalculator.setState({ selectedManualIds: ['mPlain'] })
    })

    fireEvent.click(document.querySelector('svg circle[fill="#0ea5e9"]')!)

    const placements = useCalculator.getState().manualPlacements
    const composed = placements.find((p) => p.id === 'mComposed')
    expect(composed?.composition).toEqual([{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }])
    expect(composed?.layers).toBe(5)
    const plain = placements.find((p) => p.id === 'mPlain')
    expect(plain?.layers).toBe(2)
    expect(placements).toHaveLength(2)
  })

  // K#7a: bare pop directly on a fresh composed placement (no prior "+"),
  // decrementing a top segment that has more than one layer — distinct
  // from the push-then-pop reversibility test above, which only ever pops
  // a freshly-pushed single-layer segment (the removal sub-branch, not the
  // decrement sub-branch).
  it('handleLayerChangePinned("-") on [A2,B3] directly: decrements the top segment B, freeing a standalone B1 (K#7a)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 10, weight: 100 })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 10, weight: 200 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    let pinId = ''
    act(() => {
      pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        layers: 5,
      })
      useCalculator.setState({ selectedPinIds: [pinId] })
    })

    fireEvent.click(document.querySelector('svg circle[fill="#f59e0b"]')!)

    const pin = useCalculator.getState().pinnedPlacementsByTrip[0].find((p) => p.id === pinId)!
    expect(pin.composition).toEqual([{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 2 }])
    expect(pin.layers).toBe(4)
    expect(pin.weight).toBeCloseTo((2 * 100 + 2 * 200) / 4)
    const freed = Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat().find((p) => p.id !== pinId)
    expect(freed?.itemId).toBe(itemB.id)
    expect(freed?.layers).toBe(1)
    expect(useCalculator.getState().items.find((it) => it.id === itemA.id)?.quantity).toBe(10)
    expect(useCalculator.getState().items.find((it) => it.id === itemB.id)?.quantity).toBe(10)
  })

  // K#7b: two sequential "-" clicks (no "+" in between) on a three-
  // constituent composed placement, verifying the PHYSICAL top segment is
  // popped correctly at EACH step: first the top segment is removed
  // entirely (layers===1), then the new top is decremented (layers>1).
  it('handleLayerChangeManual("-") twice in a row on [A1,B2,C1]: pops C entirely, then decrements B — each step frees the correct physical top (K#7b)', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, quantity: 10, weight: 100 })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, quantity: 10, weight: 200 })
      useCalculator.getState().addItem({ name: 'C', width: 2, length: 1, quantity: 10, weight: 300 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    const itemC = useCalculator.getState().items.find((it) => it.name === 'C')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'mComp', itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 4, rotated: false, color: itemA.color,
        composition: [{ itemId: itemA.id, layers: 1 }, { itemId: itemB.id, layers: 2 }, { itemId: itemC.id, layers: 1 }],
      })
      useCalculator.setState({ selectedManualIds: ['mComp'] })
    })

    // Step 1: top is C (layers: 1) -> removed entirely, freeing C1.
    fireEvent.click(document.querySelector('svg circle[fill="#f59e0b"]')!)
    let comp = useCalculator.getState().manualPlacements.find((p) => p.id === 'mComp')!
    expect(comp.composition).toEqual([{ itemId: itemA.id, layers: 1 }, { itemId: itemB.id, layers: 2 }])
    let freedIds = useCalculator.getState().manualPlacements.filter((p) => p.id !== 'mComp').map((p) => p.itemId)
    expect(freedIds).toEqual([itemC.id])

    // Step 2: new top is B (layers: 2) -> decremented to 1, freeing B1 —
    // NOT C again, and NOT A (the nominal itemId).
    fireEvent.click(document.querySelector('svg circle[fill="#f59e0b"]')!)
    comp = useCalculator.getState().manualPlacements.find((p) => p.id === 'mComp')!
    expect(comp.composition).toEqual([{ itemId: itemA.id, layers: 1 }, { itemId: itemB.id, layers: 1 }])
    freedIds = useCalculator.getState().manualPlacements.filter((p) => p.id !== 'mComp').map((p) => p.itemId).sort()
    expect(freedIds).toEqual([itemB.id, itemC.id].sort())

    expect(useCalculator.getState().items.find((it) => it.id === itemA.id)?.quantity).toBe(10)
    expect(useCalculator.getState().items.find((it) => it.id === itemB.id)?.quantity).toBe(10)
    expect(useCalculator.getState().items.find((it) => it.id === itemC.id)?.quantity).toBe(10)
  })

  // K#7d: "+" on a composed placement when the nominal item's OWN quantity
  // is already fully placed — must block, leaving composition/state
  // completely untouched (mirrors the existing uncomposed quantity-cap
  // behavior, just routed through the composed branch's own checkLayerChange
  // call using placementLayersOfItem instead of the flat `pin.layers`).
  it('handleLayerChangePinned("+") on a composed pin is blocked when the nominal item\'s quantity is exhausted, and changes nothing (K#7d)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 2, weight: 100 }) // exactly matches composition's own A count
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 3, weight: 200 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    let pinId = ''
    act(() => {
      pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        layers: 5,
      })
      useCalculator.setState({ selectedPinIds: [pinId] })
    })

    fireEvent.click(document.querySelector('svg circle[fill="#0ea5e9"]')!)

    const pin = useCalculator.getState().pinnedPlacementsByTrip[0].find((p) => p.id === pinId)!
    expect(pin.composition).toEqual([{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }])
    expect(pin.layers).toBe(5)
    expect(Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat()).toHaveLength(1) // no new pin created
    expect(toast.warning).toHaveBeenCalled()
  })

  // K#7e: "+" on a composed placement must gate capacity on the weight of
  // ONE unit of the NOMINAL constituent being added — not `pin.weight`
  // (deliberately seeded with a wrong/stale value below), not the
  // composition's average per-unit weight, and not the full placement
  // weight. B is deliberately much heavier than A so the three candidate
  // weights (nominal A=50, average≈366.7, full=1100) are all clearly
  // distinct — only the nominal-weight-based check produces the expected
  // block here.
  it('handleLayerChangePinned("+") on a composed pin gates maxDeckCargoT on ONE unit of the nominal constituent\'s catalog weight (K#7e)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, clearance: 5, maxDeckCargoT: 1.14 } }) // 1140kg cap
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 10, weight: 50 })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 10, weight: 1000 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    let pinId = ''
    act(() => {
      // Composition total weight = 2*50 + 1*1000 = 1100kg (already sitting
      // near the 1140kg cap). Deliberately seed `weight` with a WRONG
      // stale value (5) — if the implementation used `pin.weight` instead
      // of a fresh catalog lookup, 1100+5=1105 <= 1140 would WRONGLY pass.
      pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 3, rotated: false, color: itemA.color, weight: 5,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 1 }],
        layers: 3,
        weight: 5,
      })
      useCalculator.setState({ selectedPinIds: [pinId] })
    })

    // Nominal A's own catalog weight is 50 -> 1100+50=1150 > 1140 -> must
    // block. (An average-weight calc, ~366.7, or the stale `pin.weight`
    // of 5, would each give a DIFFERENT allow/block answer than this.)
    fireEvent.click(document.querySelector('svg circle[fill="#0ea5e9"]')!)

    const pin = useCalculator.getState().pinnedPlacementsByTrip[0].find((p) => p.id === pinId)!
    expect(pin.composition).toEqual([{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 1 }])
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('лимит груза'))
  })

  // Multi-trip isolation: "-" on a composed pin in trip 2 must not touch
  // trip 1's placements at all (same per-trip guarantee every other pin
  // mutation already has — Round 21 introduces no new cross-trip code
  // path, this locks that in for the composed branch specifically).
  it('handleLayerChangePinned("-") on a composed pin in trip 2 does not affect trip 1 (multi-trip isolation)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      // Same weight/quantity recipe as the existing "a trip already AT its
      // cap does not block '+' on a DIFFERENT trip" test above (proven to
      // force trips.length > 1 so the "Рейс 2" tab actually renders): a
      // 1t/trip cap with 4 units at 500kg each needs two trips. Widened to
      // 4.3 (vs that test's 2.2) so there's room for a SECOND 2x1
      // footprint next to the composed pin — otherwise findFreeSpotForItem
      // has nowhere to stand the freed B unit up and the pop's "stand up a
      // new placement" step silently no-ops, which a too-cramped deck was
      // masking in an earlier version of this test.
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, width: 4.3, length: 1.2, boardOffset: 0, gap: 0.1, clearance: 5, maxDeckCargoT: 1 } })
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 4, weight: 500 })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 10, weight: 200 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    let trip1PinId = ''
    let trip2PinId = ''
    act(() => {
      trip1PinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 0.1, y: 0.1, width: 2, length: 1, layers: 2, rotated: false, color: itemA.color, weight: 500,
      })
      trip2PinId = useCalculator.getState().pinFromPlaced(1, {
        itemId: itemA.id, name: itemA.name, x: 0.1, y: 0.1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(1, trip2PinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        layers: 5,
      })
    })
    const trip1Before = JSON.stringify(useCalculator.getState().pinnedPlacementsByTrip[0])

    // Switches the ACTIVE trip to trip 2 (index 1) — the "Рейс 2" tab
    // click drives page.tsx's own `activeTripIndex` React state, which
    // `clampedTripIndex` (and therefore every `updatePinned`/`pinFromPlaced`
    // call the production handler below makes) is derived from.
    fireEvent.click(screen.getByText(/Рейс 2/))
    act(() => {
      useCalculator.setState({ selectedPinIds: [trip2PinId] })
    })
    // The real "-" click -> handleLayerChangePinned's composed branch,
    // exactly the production path (not a direct store call).
    fireEvent.click(document.querySelector('svg circle[fill="#f59e0b"]')!)

    // Trip 2's composed pin popped correctly.
    const trip2 = useCalculator.getState().pinnedPlacementsByTrip[1]
    const composedTrip2 = trip2.find((p) => p.id === trip2PinId)!
    expect(composedTrip2.composition).toEqual([{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 2 }])
    // The freed standalone B unit lands in TRIP 2 specifically (the active
    // trip the handler ran against), not trip 1 or some other trip.
    const freedInTrip2 = trip2.find((p) => p.id !== trip2PinId)
    expect(freedInTrip2?.itemId).toBe(itemB.id)
    expect(freedInTrip2?.layers).toBe(1)
    expect(trip2).toHaveLength(2) // composed + freed, both in trip 2
    // Trip 1's own pin is completely untouched — same array contents,
    // same length (no freed unit leaked in here) — and no B-item pin of
    // any kind exists in trip 1.
    expect(JSON.stringify(useCalculator.getState().pinnedPlacementsByTrip[0])).toBe(trip1Before)
    expect(useCalculator.getState().pinnedPlacementsByTrip[0]).toHaveLength(1)
    expect(useCalculator.getState().pinnedPlacementsByTrip[0].find((p) => p.id === trip1PinId)?.layers).toBe(2)
    expect(useCalculator.getState().pinnedPlacementsByTrip[0].some((p) => p.itemId === itemB.id)).toBe(false)
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

  // Round 20 (composition-only preservation). handleModeChange's AUTO->MANUAL
  // branch sources from `result.placed` (PlacedItem[]) — PlacedItem already
  // carries `composition` (Round 14, copy-through only), so this is a
  // straight passthrough that was simply missing before this round.
  it('handleModeChange (AUTO -> MANUAL) preserves composition on a composed pin', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      // quantity exactly matching what the composed pin's own composition
      // consumes (2 of A, 3 of B) — otherwise AUTO auto-packs the remaining
      // unplaced quantity of both items alongside the pin, polluting
      // manualPlacements with unrelated extra placements after the switch.
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, quantity: 2 })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, quantity: 3 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      const pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
      })
    })

    fireEvent.click(screen.getByText('Ручной'))

    expect(useCalculator.getState().manualPlacements).toHaveLength(1)
    expect(useCalculator.getState().manualPlacements[0].composition).toEqual([
      { itemId: itemA.id, layers: 2 },
      { itemId: itemB.id, layers: 3 },
    ])
  })

  // Round 20: handleModeChange's MANUAL->AUTO branch sources from raw stored
  // ManualPlacements directly — same passthrough, different source.
  it('handleModeChange (MANUAL -> AUTO) preserves composition on a composed manual placement', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, quantity: 5 })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, quantity: 5 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'm1', itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1,
        layers: 5, rotated: false, color: itemA.color,
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
      })
    })

    fireEvent.click(screen.getByRole('radio', { name: 'Авто' }))

    const pins = Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat()
    expect(pins).toHaveLength(1)
    expect(pins[0].composition).toEqual([
      { itemId: itemA.id, layers: 2 },
      { itemId: itemB.id, layers: 3 },
    ])
  })

  // Round 20: handleAutoRedistribute's frozenPinned freezes a LOCKED
  // composed pin in place, and applyVariant's AUTO branch (auto-applied
  // immediately after redistribute) must carry its composition through.
  // Together these cover BOTH the frozenPinned passthrough AND applyVariant
  // AUTO in one real end-to-end interaction.
  it('handleAutoRedistribute + applyVariant (AUTO): a LOCKED composed pin survives redistribute with composition intact', () => {
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
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        locked: true,
      })
    })

    fireEvent.click(screen.getByRole('button', { name: /Автораспределение/ }))

    // applyVariant assigns a brand-new id to every placed item (including
    // the frozen one), so match by the frozen/locked position instead —
    // freezing means it must not have moved.
    const pins = Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat()
    const survivor = pins.find((p) => Math.abs(p.x - 1) < 0.01 && Math.abs(p.y - 1) < 0.01)
    expect(survivor?.composition).toEqual([
      { itemId: itemA.id, layers: 2 },
      { itemId: itemB.id, layers: 3 },
    ])
  })

  // Round 20: same redistribute flow, but starting from MANUAL mode — covers
  // frozenPinned's OTHER source (manualPlacements, not pinnedPlacements) and
  // applyVariant's MANUAL branch. A manual placement has no `locked` field,
  // so `clearanceMargin` is what freezes it for handleAutoRedistribute here.
  it('handleAutoRedistribute + applyVariant (MANUAL): a clearance-zoned composed placement survives redistribute with composition intact', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, quantity: 5 })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, quantity: 5 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'm1', itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1,
        layers: 5, rotated: false, color: itemA.color,
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        clearanceMargin: { top: 0, right: 0, bottom: 0, left: 0 },
      })
    })

    fireEvent.click(screen.getByRole('button', { name: /Автораспределение/ }))

    const survivor = useCalculator.getState().manualPlacements.find((p) => Math.abs(p.x - 1) < 0.01 && Math.abs(p.y - 1) < 0.01)
    expect(survivor?.composition).toEqual([
      { itemId: itemA.id, layers: 2 },
      { itemId: itemB.id, layers: 3 },
    ])
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

  // Round 19 (lashing per-segment) — the Sidebar half of the mutation gate
  // (the PDF half lives in exportPdf.test.ts, unit-testing
  // buildLashingRequirementRows directly). A composed [A(metal)x2,B(general)x3]
  // pin must render TWO independent verdict blocks, not one verdict computed
  // from only the nominal itemId's category.
  it('Sidebar lashing section renders one verdict block PER SEGMENT for a composed placement', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'Труба', width: 2, length: 1, quantity: 5, category: 'Металлопродукция', weight: 500 })
      useCalculator.getState().addItem({ name: 'Ящик', width: 2, length: 1, quantity: 5, category: 'Обычный груз', weight: 800 })
    })
    const metal = useCalculator.getState().items.find((it) => it.name === 'Труба')!
    const general = useCalculator.getState().items.find((it) => it.name === 'Ящик')!
    let pinId = ''
    act(() => {
      pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: metal.id, name: metal.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: metal.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: metal.id, layers: 2 }, { itemId: general.id, layers: 3 }],
      })
      useCalculator.setState({ selectedPinIds: [pinId] })
    })

    fireEvent.click(screen.getByText('Крепление груза'))

    // Both segment labels appear (2 ед./3 ед. — the segment's own layers,
    // not the placement's combined 5).
    expect(screen.getByText(/Труба \(2 ед\., \d+ кг\)/)).toBeTruthy()
    expect(screen.getByText(/Ящик \(3 ед\., \d+ кг\)/)).toBeTruthy()
    // The metal segment's own РД 31.11.21.23-96 verdict is present and NOT
    // suppressed by the general-cargo segment sharing the same placement.
    expect(screen.getByText(/РД 31.11.21.23-96/)).toBeTruthy()
    expect(screen.getByText(/Ориентировочное количество найтовов/)).toBeTruthy()
  })

  it('Sidebar lashing section: a dangerous-goods segment is excluded per-segment without hiding the other segment\'s verdict, regardless of which one is nominal', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'Реагент', width: 2, length: 1, quantity: 5, category: 'Опасный груз', weight: 300 })
      useCalculator.getState().addItem({ name: 'Труба', width: 2, length: 1, quantity: 5, category: 'Металлопродукция', weight: 500 })
    })
    const dangerous = useCalculator.getState().items.find((it) => it.name === 'Реагент')!
    const metal = useCalculator.getState().items.find((it) => it.name === 'Труба')!
    let pinId = ''
    act(() => {
      // Dangerous goods is the NOMINAL itemId here — the old (pre-Round-19)
      // code would have classified the WHOLE placement as dangerous goods,
      // silently dropping the metal segment's own РД-31.11.21.23-96 verdict.
      pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: dangerous.id, name: dangerous.name, x: 1, y: 1, width: 2, length: 1, layers: 3, rotated: false, color: dangerous.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: dangerous.id, layers: 1 }, { itemId: metal.id, layers: 2 }],
      })
      useCalculator.setState({ selectedPinIds: [pinId] })
    })

    fireEvent.click(screen.getByText('Крепление груза'))

    expect(screen.getAllByText(/IMDG Code/).length).toBeGreaterThan(0) // dangerous segment's own not-applicable notice
    // "требуется найтовов" appears ONLY in the calculated-verdict block
    // (unlike "РД 31.11.21.23-96", which the not-applicable explanation
    // text also happens to mention) — a real, specific check that the metal
    // segment's own verdict actually rendered, not just incidental text.
    expect(screen.getByText(/требуется найтовов/)).toBeTruthy()
  })
})
