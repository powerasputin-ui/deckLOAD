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

// Text content of every SVG <text> node on the deck — scoped this way
// because plain labels like a category name ("Обычный") or the lock badge
// glyph ("🔒") also appear elsewhere on the page (datalist options, other
// UI chrome), making a page-wide screen.getByText ambiguous.
function svgTextContents(): string[] {
  return Array.from(document.querySelectorAll('svg text')).map((el) => el.textContent ?? '')
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

    // "+" on the PLAIN pin — before this Round 21 fix, findMergeSourcePinned(A, ...)
    // returned the composed pin (its own itemId is also A) as the merge
    // source, and handleMergePinned — composition-blind at the time (this
    // predates Round 24's composition-aware rewrite) — absorbed it: blended
    // `layers`/`weight` as flat fields and DELETED the composed placement
    // outright, discarding B's provenance/quantity permanently. With
    // generous quantity and no competing auto-placed instance, that merge
    // would have gone through cleanly under the old code, making this
    // assertion fail without the guard.
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

  // R29 corrective pass: a Tier-2 malformed placement (no valid composition
  // to trust) is excluded from packing/capacity, but checkLayerChange's own
  // quantity scan reads the raw store arrays directly — before this fix it
  // still phantom-counted the malformed placement's raw, untrustworthy
  // `layers` toward A's "already placed" sum (its own itemId is genuinely
  // 'A'), wrongly blocking a real, legitimate "+" click on a separate,
  // ordinary placement of the same item. Manual mode (not pinned/AUTO) so
  // there's no auto-fill of A's own remaining quantity to confound the
  // merge-source lookup — this isolates checkLayerChange's own fix.
  it('handleLayerChangeManual("+") is not blocked by a co-existing Tier-2 malformed placement of the same item', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, clearance: 5 } })
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 8 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    act(() => {
      // Target: 2 real layers. Malformed sibling: raw layers=6, itemId
      // genuinely 'A', excluded from packing/merge-source lookup (see the
      // R29 findMergeSourceManual guard fix) but NOT from this old bug's
      // phantom quantity count. 2 (real) + 6 (phantom, if wrongly counted)
      // + 1 (new) = 9 > 8 (blocked, bug). 2 (real) + 1 (new) = 3 <= 8 (fixed).
      useCalculator.getState().addManualPlacement({
        id: 'target', itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 2, rotated: false, color: itemA.color,
      })
      useCalculator.getState().addManualPlacement({
        id: 'ghost', itemId: itemA.id, name: 'Ghost', x: 5, y: 5, width: 2, length: 1, layers: 6, rotated: false, color: itemA.color,
        malformed: { invalidComposition: true, rawComposition: [{ itemId: itemA.id, layers: 6 }, { itemId: 'garbage', layers: 1 }] },
      })
      useCalculator.setState({ selectedManualIds: ['target'] })
    })

    fireEvent.click(document.querySelector('svg circle[fill="#0ea5e9"]')!)

    const target = useCalculator.getState().manualPlacements.find((m) => m.id === 'target')!
    expect(target.layers).toBe(3) // succeeded
    expect(toast.warning).not.toHaveBeenCalledWith(expect.stringContaining('уже размещены'))
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

  // Round 22 — DeckVisualization mixed-load / multi-category rendering.
  // Before this round, a composed placement rendered indistinguishably
  // from an ordinary placement of its nominal item: one solid nominal
  // color, and a corner category label resolved only via
  // `categoryByItemId.get(p.itemId)` (nominal itemId), silently hiding
  // any non-nominal constituent's own category. `#475569` is the mixed-
  // load marker's own unique fill (DeckVisualization.tsx) — not used
  // anywhere else in the file, so it's a safe, specific selector.
  it('DeckVisualization: uncomposed placement never renders the mixed-load marker (regression)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 5, color: '#ff0000', category: 'Обычный' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    act(() => {
      useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 3, rotated: false, color: itemA.color,
      })
    })

    expect(document.querySelector('svg circle[fill="#475569"]')).toBeNull()
    // Existing rendering is untouched: base fill is still the item's own
    // color, category label still shows the single real category. Scoped
    // to `svg text` — "Обычный" also appears elsewhere on the page (e.g.
    // the category datalist), so a page-wide text query would be ambiguous.
    expect(document.querySelector('svg rect[fill="#ff0000"]')).toBeTruthy()
    expect(svgTextContents()).toContain('Обычный')
  })

  it('DeckVisualization: composed [A2,B3] with the SAME category shows the mixed-load marker but keeps the single category label (K#R22-same-category)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 5, color: '#ff0000', category: 'Обычный' })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 5, color: '#0000ff', category: 'Обычный' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      const pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        layers: 5,
      })
    })

    expect(document.querySelector('svg circle[fill="#475569"]')).toBeTruthy()
    // Both constituents share "Обычный" -> no "Смешанный груз" label, the
    // single real category still shows (not replaced just because the
    // placement happens to be composed).
    const texts = svgTextContents()
    expect(texts).toContain('Обычный')
    expect(texts).not.toContain('Смешанный груз')
    // Base nominal rendering (color) is untouched.
    expect(document.querySelector('svg rect[fill="#ff0000"]')).toBeTruthy()
  })

  // R29 corrective pass: category for a composed placement must be
  // determined ONLY from `constituentCategories` (composition-derived),
  // never falling back to `categoryByItemId?.get(p.itemId)` — a Tier-1
  // placement's nominal itemId isn't guaranteed to resolve, and the old
  // fallback would silently show NO category label even though the real
  // constituents share one.
  it('Tier-1: category still shows the single shared constituent category even with a broken nominal itemId', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      // quantity EXACTLY matches what the composition below consumes (2, 3)
      // so nothing is left for the AUTO packer to auto-fill elsewhere —
      // an auto-filled leftover of the same category would render its OWN
      // correct label and mask a broken fix in THIS placement's own
      // category computation.
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 2, color: '#ff0000', category: 'Опасный груз' })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 3, color: '#0000ff', category: 'Опасный груз' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      const pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: 'P', x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        itemId: 'deleted-item', // broken nominal — old code's fallback would find nothing here
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        layers: 5,
      })
    })

    const texts = svgTextContents()
    expect(texts).toContain('Опасный груз') // NOT blank/missing despite the broken nominal id
    expect(texts).not.toContain('Смешанный груз')
  })

  it('DeckVisualization: composed [A2,B3] with DIFFERENT categories shows "Смешанный груз" instead of the nominal-only category (K#R22-mixed-category)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      // Quantities set to EXACTLY what the composition uses (2 and 3) —
      // otherwise AUTO auto-places the leftover unplaced units of A
      // elsewhere on the deck as their own genuine (uncomposed) A
      // placement, which would legitimately show "Обычный" too and make
      // the "no longer appears" assertion below a false failure.
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 2, color: '#ff0000', category: 'Обычный' })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 3, color: '#0000ff', category: 'Опасный груз' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      const pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        layers: 5,
      })
    })

    expect(document.querySelector('svg circle[fill="#475569"]')).toBeTruthy()
    const texts = svgTextContents()
    expect(texts).toContain('Смешанный груз')
    // The old nominal-only category text no longer appears BY ITSELF as
    // the placement's label (it would have silently hidden B's category).
    expect(texts).not.toContain('Обычный')
  })

  // Corrective pass (post-review): A has a real category, B has NONE set.
  // Per the existing project-wide contract for an absent category
  // (violatesSeparation/lashingMethodologyFor in packing.ts both treat "no
  // category" as "doesn't participate", never as its own distinct
  // category that can conflict with a real one), this must NOT show
  // "Смешанный груз" — it shows A's real category alone, same as it
  // always would for a single-category composition. This is a deliberate,
  // contract-derived decision, not an oversight — see the `.filter(Boolean)`
  // comment in DeckVisualization.tsx for the full reasoning.
  it('DeckVisualization: composed [A2,B3] where B has NO category set does not show "Смешанный груз" — undefined is not a distinct category (K#R22-undefined-category)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 2, color: '#ff0000', category: 'Металл' })
      // No `category` passed for B — matches CargoItem.category's optional
      // contract (free text, absent = not set).
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 3, color: '#0000ff' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    expect(itemB.category).toBeUndefined()
    act(() => {
      const pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        layers: 5,
      })
    })

    // Still composed -> mixed-load marker present (that part is unrelated
    // to category logic — driven purely by segment count).
    expect(document.querySelector('svg circle[fill="#475569"]')).toBeTruthy()
    const texts = svgTextContents()
    expect(texts).toContain('Металл')
    expect(texts).not.toContain('Смешанный груз')
  })

  // Corrective pass: [A2,A3] — two NON-ADJACENT segments of the SAME
  // itemId (a real, reachable shape once merge/push start producing
  // composition — see the migration plan's merge examples, e.g.
  // composed(A2+B3) + single(A1) never coalescing across a B boundary).
  // The mixed-load marker is driven purely by segment COUNT
  // (segmentsOf(p).length > 1), not by distinct item identity — so it
  // still shows here even though physically only ONE CargoItem is
  // involved. This is the user-specified expected behavior: the marker
  // signals "this placement's composition is segmented", not strictly
  // "contains more than one distinct item type". Category and the ×N
  // total-count badge are unaffected either way, since both are already
  // itemId/count-based, not segment-count-based.
  it('DeckVisualization: composed [A2,A3] (same itemId, non-adjacent segments) still shows the mixed-load marker, but category and ×N stay normal (K#R22-same-item-composed)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 5, color: '#ff0000', category: 'Металл' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    act(() => {
      const pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemA.id, layers: 3 }],
        layers: 5,
      })
    })

    // Marker present (segment count > 1) despite only one real item type.
    expect(document.querySelector('svg circle[fill="#475569"]')).toBeTruthy()
    const texts = svgTextContents()
    expect(texts).toContain('Металл')
    expect(texts).not.toContain('Смешанный груз')
    // ×N still reads the true total unit count (5), unaffected by how
    // many composition segments make it up.
    expect(texts).toContain('×5')
  })

  it('DeckVisualization: composed placement with different constituent COLORS still renders the nominal base fill unchanged, marker present (K#R22-colors)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 5, color: '#ff0000' })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 5, color: '#00ff00' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      const pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        layers: 5,
      })
    })

    expect(document.querySelector('svg circle[fill="#475569"]')).toBeTruthy()
    // Base fill stays the nominal color — no product decision was made to
    // split/change item.color itself, only to ADD the marker.
    expect(document.querySelector('svg rect[fill="#ff0000"]')).toBeTruthy()
  })

  // Geometry corrective pass — the un-clamped marker position
  // (x + w - 30) placed the marker ENTIRELY outside the placement's own
  // footprint at the mixed-load gate's own minimum width (w=16, marker
  // span [x-20, x-8]). This forces a placement rendered right at/near
  // that minimum width and checks the marker's actual DOM geometry stays
  // attached to the box, rather than asserting presence alone (which the
  // pre-fix code already satisfied — the marker was there, just floating
  // off to the side).
  //
  // Deck sized to 500x300 (deck units) puts scale at
  // min(836/500, 496/300) ≈ 1.653 px/unit; a 10x10 unit item then renders
  // at ≈16.53 screen px — just above the w>=16 && h>=16 gate, the
  // smallest production-reachable size at which the marker (or the
  // existing ×N badge) renders at all.
  it('DeckVisualization: mixed-load marker geometry stays attached to the placement at the gate\'s minimum width (K#R22-geometry-boundary)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, width: 500, length: 300 } })
      useCalculator.getState().addItem({ name: 'A', width: 10, length: 10, height: 1, quantity: 5, color: '#ff0000' })
      useCalculator.getState().addItem({ name: 'B', width: 10, length: 10, height: 1, quantity: 5, color: '#0000ff' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      const pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 10, y: 10, width: 10, length: 10, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        layers: 5,
      })
    })

    const box = document.querySelector('svg rect[fill="#ff0000"]')
    const marker = document.querySelector('svg circle[fill="#475569"]')
    expect(box).toBeTruthy()
    expect(marker).toBeTruthy()
    const boxX = Number(box!.getAttribute('x'))
    const boxW = Number(box!.getAttribute('width'))
    // Sanity check this test actually landed at the intended boundary size
    // — if this fails, the deck/item dimensions above no longer produce a
    // ~16-17px box and the test isn't exercising the gate's minimum.
    expect(boxW).toBeGreaterThanOrEqual(16)
    expect(boxW).toBeLessThan(20)
    const mcx = Number(marker!.getAttribute('cx'))
    const mr = Number(marker!.getAttribute('r'))
    // The core assertion: the marker's circle must overlap the placement's
    // own horizontal extent [boxX, boxX + boxW] — NOT be entirely to the
    // left of it (which the pre-fix formula produced: mcx+mr = -8 at
    // boxX=0, strictly less than boxX).
    expect(mcx + mr).toBeGreaterThanOrEqual(boxX)
    expect(mcx - mr).toBeLessThanOrEqual(boxX + boxW)
  })

  // Same scenario at a normal (non-boundary) width — proves the clamp is a
  // no-op there and the marker renders at EXACTLY the original formula's
  // position, i.e. adaptive positioning does not regress the existing
  // appearance for the vast majority of real placements.
  it('DeckVisualization: mixed-load marker keeps its original (unclamped) position at normal placement width (K#R22-geometry-normal-width)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 5, color: '#ff0000' })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 5, color: '#0000ff' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      const pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        layers: 5,
      })
    })

    const box = document.querySelector('svg rect[fill="#ff0000"]')
    const marker = document.querySelector('svg circle[fill="#475569"]')
    expect(box).toBeTruthy()
    expect(marker).toBeTruthy()
    const boxX = Number(box!.getAttribute('x'))
    const boxW = Number(box!.getAttribute('width'))
    // Confirms this is genuinely a "normal" (non-boundary) width, well
    // clear of the gate's own minimum.
    expect(boxW).toBeGreaterThan(40)
    const mcx = Number(marker!.getAttribute('cx'))
    // Exact original formula: x + w - 30 — the clamp must be a no-op here.
    expect(mcx).toBeCloseTo(boxX + boxW - 30, 5)
  })

  it('DeckVisualization: mixed-load marker coexists with the locked badge without replacing it (interaction regression)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 5, color: '#ff0000' })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 5, color: '#0000ff' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      const pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        layers: 5,
        locked: true,
      })
    })

    expect(document.querySelector('svg circle[fill="#475569"]')).toBeTruthy()
    expect(svgTextContents()).toContain('🔒')
  })

  it('DeckVisualization: mixed-load marker coexists with selection highlight without changing the selection stroke (interaction regression)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 5, color: '#ff0000' })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 5, color: '#0000ff' })
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

    expect(document.querySelector('svg circle[fill="#475569"]')).toBeTruthy()
    // Selection still drives the existing violet stroke — untouched by
    // the marker addition (marker is a separate <g>, doesn't touch stroke
    // props on the underlying shape).
    expect(document.querySelector('svg [stroke="#7c3aed"]')).toBeTruthy()
  })

  // Round 23 — composition-aware quantity attribution in ItemList,
  // PlacementPanel, and onPlace's quantity gate. Before this round, all
  // three independently grouped `result.placed`/store placements by
  // nominal `itemId` alone, so a composed [A2,B3] (nominal itemId=A)
  // showed "A: 5 placed, B: 0 placed" instead of "A: 2, B: 3".
  it('ItemList: composed [A2,B3] shows 2/2 placed for A and 3/3 for B, not 5/2 and 0/3 (K#R23-itemlist)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 2, weight: 100 })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 3, weight: 200 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      const pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        layers: 5,
      })
    })

    // ItemRow's name button carries `title={item.name}` — its parent flex
    // container also holds the "N/M разм." badge, scoped this way since
    // plain item names ("A"/"B") are not unique page-wide (PlacementPanel
    // renders them too).
    const aRow = screen.getByTitle('A')
    const bRow = screen.getByTitle('B')
    expect(aRow.parentElement?.textContent).toContain('2/2 разм.')
    expect(bRow.parentElement?.textContent).toContain('3/3 разм.')
  })

  it('PlacementPanel: composed [A2,B3] attributes remaining quantity per constituent, not to the nominal itemId alone (K#R23-placementpanel)', () => {
    render(<Home />)
    clearDemoCargo()
    // Manual mode — AUTO would auto-place A's 2 genuinely-remaining units
    // somewhere else on the deck on its own (nothing wrong with that, but
    // it would then make the true "remaining" legitimately 0, defeating
    // the point of this test), so this needs a mode where nothing places
    // itself without an explicit action.
    fireEvent.click(screen.getByText('Ручной'))
    act(() => {
      // A: 2 used by the composition, 2 more genuinely available.
      // B: 3 used by the composition, fully consumed.
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 4, weight: 100 })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 3, weight: 200 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'm1', itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
      })
    })

    // StampRow renders as a single <button> containing both the item name
    // and "Не распределено" — scanning for a button whose text includes
    // both disambiguates it from ItemList's own (differently-shaped) row.
    const stampRowText = (name: string) =>
      Array.from(document.querySelectorAll('button')).find(
        (btn) => btn.textContent?.includes(name) && btn.textContent?.includes('Не распределено')
      )?.textContent
    // Pre-fix, A would wrongly show 0 remaining (over-counted at 5 placed
    // against quantity 4) and B would wrongly show 3 remaining (never
    // credited with its 3 units at all).
    expect(stampRowText('A')).toContain('Не распределено: 2')
    expect(stampRowText('B')).toContain('Не распределено: 0')
  })

  // onPlace's quantity gate (page.tsx) — functional, not just display: it
  // decides whether a stamp click is allowed to actually place a unit.
  //
  // The deck click path (DeckVisualization's handleDeckClick) converts
  // clientX/clientY to deck coordinates via `svg.createSVGPoint()` /
  // `svg.getScreenCTM()` — real SVG geometry APIs jsdom doesn't implement
  // (no layout engine), so an un-mocked click would silently no-op before
  // ever reaching onPlace, making the test pass for the wrong reason (it
  // did nothing). These two tests install a local identity-transform
  // polyfill for exactly this pair of methods so clientX/clientY behave
  // as literal deck-space screen coordinates once translated through the
  // deck's own offX/offY/scale — restored after each test so no other
  // test's environment is affected.
  const withIdentitySvgTransform = (fn: () => void) => {
    const proto = SVGSVGElement.prototype as unknown as {
      createSVGPoint?: () => { x: number; y: number; matrixTransform: (m: unknown) => { x: number; y: number } }
      getScreenCTM?: () => { inverse: () => unknown } | null
    }
    const origCreateSVGPoint = proto.createSVGPoint
    const origGetScreenCTM = proto.getScreenCTM
    proto.createSVGPoint = function (this: { __x?: number; __y?: number }) {
      const pt = {
        x: 0,
        y: 0,
        matrixTransform: () => ({ x: pt.x, y: pt.y }),
      }
      return pt
    }
    proto.getScreenCTM = () => ({ inverse: () => ({}) })
    try {
      fn()
    } finally {
      proto.createSVGPoint = origCreateSVGPoint
      proto.getScreenCTM = origGetScreenCTM
    }
  }
  // Deck is fixed at 10x10 (deck units) with the default clearance for
  // both tests below, so the same offX/offY/scale (and thus the same
  // clientX/clientY -> deck-space mapping) applies to both. scale =
  // min((900-64)/10, (560-64)/10) = min(83.6, 49.6) = 49.6; deck not
  // "rotated" (length == width); offX = (900 - 10*49.6)/2 = 202,
  // offY = (560 - 10*49.6)/2 = 32. clientX=450/clientY=280 maps to
  // deck-space (5,5) — clear of the existing pin at [1,3]x[1,2].
  const DECK_CLICK_CLIENT_X = 450
  const DECK_CLICK_CLIENT_Y = 280

  it('onPlace quantity gate: composed [A2,B3] blocks placing more B once its own 3 units are accounted for (K#R23-onplace-block-B)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, width: 10, length: 10, clearance: 5 } })
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 4, weight: 100 })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 3, weight: 200 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      const pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        layers: 5,
      })
    })

    // Arm B's stamp and click empty deck space — B's own 3 units are
    // already fully accounted for (composition-aware), so this must be
    // BLOCKED. Pre-fix, B's flat `pin.itemId === B` filter found nothing
    // (the composed pin's own itemId is A) and would have wrongly ALLOWED
    // this, silently over-placing B past its declared quantity.
    act(() => {
      useCalculator.getState().setActiveStamp(itemB.id)
    })
    const before = Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat().length
    withIdentitySvgTransform(() => {
      fireEvent.click(document.querySelector('svg.w-full.h-auto')!, { clientX: DECK_CLICK_CLIENT_X, clientY: DECK_CLICK_CLIENT_Y })
    })
    expect(Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat().length).toBe(before)
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('уже размещены'))
  })

  it('onPlace quantity gate: composed [A2,B3] still allows placing more A when A\'s true remaining quantity is positive (K#R23-onplace-allow-A)', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, width: 10, length: 10, clearance: 5 } })
      // A: quantity 4, only 2 used by the composition -> 2 genuinely remain.
      // Pre-fix, the flat filter would have summed this ONE placement's
      // full `pin.layers` (5, the total) as "A placed", wrongly reporting
      // 5 >= 4 and blocking this click outright.
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 4, weight: 100 })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, height: 1, quantity: 3, weight: 200 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      const pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: itemA.name, x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        layers: 5,
      })
    })

    act(() => {
      useCalculator.getState().setActiveStamp(itemA.id)
    })
    const before = Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat().length
    withIdentitySvgTransform(() => {
      fireEvent.click(document.querySelector('svg.w-full.h-auto')!, { clientX: DECK_CLICK_CLIENT_X, clientY: DECK_CLICK_CLIENT_Y })
    })
    expect(Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat().length).toBe(before + 1)
    expect(toast.warning).not.toHaveBeenCalledWith(expect.stringContaining('уже размещены'))
  })

  // R29 corrective pass: onPlace's own quantity gate (the third of three
  // identical `layersOfIdIn` scanners) must not phantom-count a Tier-2
  // malformed placement's raw layers either — same fix, same reason as
  // checkLayerChange/updateItem above.
  it('onPlace quantity gate (MANUAL) is not blocked by a co-existing Tier-2 malformed placement of the same item', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, width: 10, length: 10, clearance: 5 } })
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, height: 1, quantity: 6, weight: 100 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    act(() => {
      // Malformed sibling: raw layers=6, itemId genuinely 'A', excluded
      // from packing/capacity. Nothing genuinely placed. If wrongly
      // phantom-counted, 6 (phantom) + 1 (new) = 7 > 6 (quantity) -> blocked.
      // Correctly excluded: 0 (real) + 1 (new) = 1 <= 6 -> allowed.
      useCalculator.getState().addManualPlacement({
        id: 'ghost', itemId: itemA.id, name: 'Ghost', x: 5, y: 5, width: 2, length: 1, layers: 6, rotated: false, color: itemA.color,
        malformed: { invalidComposition: true, rawComposition: [{ itemId: itemA.id, layers: 6 }, { itemId: 'garbage', layers: 1 }] },
      })
      useCalculator.getState().setActiveStamp(itemA.id)
    })
    const before = useCalculator.getState().manualPlacements.length
    withIdentitySvgTransform(() => {
      fireEvent.click(document.querySelector('svg.w-full.h-auto')!, { clientX: DECK_CLICK_CLIENT_X, clientY: DECK_CLICK_CLIENT_Y })
    })
    expect(useCalculator.getState().manualPlacements.length).toBe(before + 1)
    expect(toast.warning).not.toHaveBeenCalledWith(expect.stringContaining('уже размещены'))
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

  // R29 corrective pass: `rotationLocked` alone is NOT proven authoritative
  // for every composed placement (only for ones created through the live
  // merge/+/- pipeline) — a hydrated/imported composed placement can carry
  // a stale/absent `rotationLocked` even though a real constituent
  // disallows rotation. Rotation permission for a composed placement must
  // be checked LIVE from composition + the current catalog.
  it('Tier-1: rotation is blocked for a composed placement via LIVE composition + catalog, even with a broken nominal itemId and rotationLocked unset', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, quantity: 5, allowRotation: true })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, quantity: 5, allowRotation: false })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      const pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: 'P', x: 1, y: 1, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      // Simulates a hydrated/imported composed placement: valid
      // composition (B disallows rotation), broken nominal itemId,
      // rotationLocked deliberately left unset — the exact gap normalizeProject's
      // hydration doesn't currently re-derive.
      useCalculator.getState().updatePinned(0, pinId, {
        itemId: 'deleted-item',
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        rotationLocked: undefined,
      })
      useCalculator.setState({ selectedPinIds: [pinId] })
    })

    const rotateCircle = document.querySelector('svg circle[fill="#7c3aed"]')
    expect(rotateCircle).toBeTruthy()
    fireEvent.click(rotateCircle!)

    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('не разрешает поворот'))
    const pin = Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat()[0]
    expect(pin.rotated).toBe(false)
  })

  // Opposite direction: a Tier-1 placement whose EVERY constituent allows
  // rotation must NOT be permanently blocked just because its nominal
  // itemId is broken — proving the fix doesn't over-restrict.
  it('Tier-1: rotation is ALLOWED for a composed placement whose every real constituent allows it, despite a broken nominal itemId', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, width: 20, length: 20, boardOffset: 0, gap: 0 } })
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, quantity: 5, allowRotation: true })
      useCalculator.getState().addItem({ name: 'B', width: 2, length: 1, quantity: 5, allowRotation: true })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      const pinId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: 'P', x: 5, y: 5, width: 2, length: 1, layers: 5, rotated: false, color: itemA.color,
      })
      useCalculator.getState().updatePinned(0, pinId, {
        itemId: 'deleted-item',
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
        rotationLocked: undefined,
      })
      useCalculator.setState({ selectedPinIds: [pinId] })
    })

    const rotateCircle = document.querySelector('svg circle[fill="#7c3aed"]')
    fireEvent.click(rotateCircle!)

    expect(toast.warning).not.toHaveBeenCalledWith(expect.stringContaining('не разрешает поворот'))
    const pin = Object.values(useCalculator.getState().pinnedPlacementsByTrip).flat()[0]
    expect(pin.rotated).toBe(true)
  })

  // R29 corrective pass: PlacementPanel's "Снять все закрепления" button
  // must not appear when the ONLY pinned placement is a Tier-2 quarantined
  // one — nothing is visibly on the deck to clear. Derived from
  // `result.quarantined` (authoritative), not a second independent
  // `malformed && !composition` check.
  it('PlacementPanel: "Снять все закрепления" does not appear when the only pin is Tier-2 quarantined', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', width: 2, length: 1, quantity: 5 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    act(() => {
      useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: 'Ghost', x: 1, y: 1, width: 2, length: 1, layers: 6, rotated: false, color: itemA.color,
      })
      const pinId = useCalculator.getState().pinnedPlacementsByTrip[0][0].id
      useCalculator.getState().updatePinned(0, pinId, {
        malformed: { invalidComposition: true, rawComposition: [{ itemId: itemA.id, layers: 6 }, { itemId: 'garbage', layers: 1 }] },
      })
    })

    expect(screen.queryByText('Снять все закрепления')).toBeNull()
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

  // Round 24 (merge switch-on): real drag-to-merge through the actual
  // rendered <Home/> DOM (pointerdown/pointermove/pointerup on the deck's
  // SVG), not direct calls to a helper — planComposedMerge itself has no
  // export, so this is the only way to prove the wired-up handlers actually
  // behave as designed. Reuses the identity-SVG-transform technique from
  // the onPlace tests above: screenToDeck's mocked math is a pure linear
  // function of clientX/clientY, so an arbitrary pointerdown origin plus a
  // pointermove offset of (targetX-draggedX)*scale, (targetY-draggedY)*scale
  // deterministically lands the dragged placement exactly on the target's
  // own (x,y) — full-footprint overlap, comfortably past findMergeTarget's
  // 0.65 threshold. Each placement is given its own unique frozen `name` so
  // its <g data-cargo-placement> can be found by its on-deck text label,
  // which stays reliable even when two placements share an itemId (same
  // fill color) or when rendering order isn't guaranteed to match array
  // order.
  const DECK_SCALE_R24 = 49.6

  function placementGroupByLabel(label: string): Element {
    const groups = Array.from(document.querySelectorAll('g[data-cargo-placement="true"]'))
    const match = groups.find((g) => Array.from(g.querySelectorAll('text')).some((t) => t.textContent === label))
    if (!match) throw new Error(`Round 24 test: placement group not found for label "${label}"`)
    return match
  }

  function dragMergeR24(fromLabel: string, dxDeck: number, dyDeck: number) {
    const svg = document.querySelector('svg.w-full.h-auto')!
    const g = placementGroupByLabel(fromLabel)
    const downX = 100
    const downY = 100
    withIdentitySvgTransform(() => {
      fireEvent.pointerDown(g, { clientX: downX, clientY: downY, button: 0 })
      fireEvent.pointerMove(svg, { clientX: downX + dxDeck * DECK_SCALE_R24, clientY: downY + dyDeck * DECK_SCALE_R24 })
      fireEvent.pointerUp(svg, { clientX: downX + dxDeck * DECK_SCALE_R24, clientY: downY + dyDeck * DECK_SCALE_R24 })
    })
  }

  // All cross-item Round 24 scenarios use pipe-shaped cargo (shape:
  // 'cylinder', long/short span and long/height ratios both > 1.5) since
  // planComposedMerge's compatibility gate — same as the old
  // reconcileCrossItemMerge it replaces — only allows a merge spanning more
  // than one distinct itemId when every constituent is pipe-shaped.
  function setupPipeDeck() {
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, width: 10, length: 10, clearance: 25 } })
    })
  }

  it('Round 24: pure standalone + standalone cross-item merge creates a real composition AND preserves the legacy catalog quantity-transfer', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    setupPipeDeck()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 5, weight: 100, category: 'X' })
      useCalculator.getState().addItem({ name: 'B', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 5, weight: 200, category: 'X' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'drag', itemId: itemA.id, name: 'DRAG', x: 1, y: 1, width: 4, length: 1, layers: 1, rotated: false, color: itemA.color, weight: 100,
      })
      useCalculator.getState().addManualPlacement({
        id: 'target', itemId: itemB.id, name: 'TARGET', x: 6, y: 6, width: 4, length: 1, layers: 1, rotated: false, color: itemB.color, weight: 200,
      })
    })

    dragMergeR24('DRAG', 5, 5)

    const placements = useCalculator.getState().manualPlacements
    expect(placements.length).toBe(1)
    const merged = placements[0]
    expect(merged.id).toBe('target')
    expect(merged.itemId).toBe(itemB.id) // target survives as nominal identity
    expect(merged.composition).toEqual([{ itemId: itemB.id, layers: 1 }, { itemId: itemA.id, layers: 1 }])
    expect(merged.layers).toBe(2)
    expect(merged.weight).toBeCloseTo(150, 6) // (200*1 + 100*1) / 2
    // Round 24 corrective pass: a PURE standalone (uncomposed on both
    // sides) cross-item merge keeps the exact pre-Round-24
    // reconcileCrossItemMerge quantity-transfer contract — dragged's own
    // `delta` (1 layer) moves out of A's catalog quantity and into B's.
    // Before: A=5, B=5. After: A=5-1=4, B=5+1=6.
    expect(useCalculator.getState().items.find((it) => it.id === itemA.id)?.quantity).toBe(4)
    expect(useCalculator.getState().items.find((it) => it.id === itemB.id)?.quantity).toBe(6)
  })

  it('Round 24: composed target + standalone dragged appends the new segment on top, keeping the target\'s nominal itemId', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    setupPipeDeck()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 10, weight: 100, category: 'X' })
      useCalculator.getState().addItem({ name: 'B', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 10, weight: 200, category: 'X' })
      useCalculator.getState().addItem({ name: 'C', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 10, weight: 300, category: 'X' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    const itemC = useCalculator.getState().items.find((it) => it.name === 'C')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'target', itemId: itemA.id, name: 'TARGET', x: 1, y: 1, width: 4, length: 1, layers: 5, rotated: false, color: itemA.color, weight: 140,
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
      })
      useCalculator.getState().addManualPlacement({
        id: 'drag', itemId: itemC.id, name: 'DRAGC', x: 6, y: 6, width: 4, length: 1, layers: 1, rotated: false, color: itemC.color, weight: 300,
      })
    })

    dragMergeR24('DRAGC', 1 - 6, 1 - 6)

    const placements = useCalculator.getState().manualPlacements
    expect(placements.length).toBe(1)
    const merged = placements[0]
    expect(merged.id).toBe('target')
    expect(merged.itemId).toBe(itemA.id)
    expect(merged.composition).toEqual([
      { itemId: itemA.id, layers: 2 },
      { itemId: itemB.id, layers: 3 },
      { itemId: itemC.id, layers: 1 },
    ])
    expect(merged.layers).toBe(6)
    expect(merged.weight).toBeCloseTo((2 * 100 + 3 * 200 + 1 * 300) / 6, 6)
    // Round 24 corrective pass: the target is composed, so this must NOT
    // touch catalog quantity for any constituent — A/B/C's own quantity
    // (10 each) stays exactly as it was before the merge.
    expect(useCalculator.getState().items.find((it) => it.id === itemA.id)?.quantity).toBe(10)
    expect(useCalculator.getState().items.find((it) => it.id === itemB.id)?.quantity).toBe(10)
    expect(useCalculator.getState().items.find((it) => it.id === itemC.id)?.quantity).toBe(10)
  })

  it('Round 24: standalone target + composed dragged — target survives as nominal identity even though it was itself uncomposed', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    setupPipeDeck()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 10, weight: 100, category: 'X' })
      useCalculator.getState().addItem({ name: 'B', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 10, weight: 200, category: 'X' })
      useCalculator.getState().addItem({ name: 'C', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 10, weight: 300, category: 'X' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    const itemC = useCalculator.getState().items.find((it) => it.name === 'C')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'target', itemId: itemC.id, name: 'TARGETC', x: 1, y: 1, width: 4, length: 1, layers: 1, rotated: false, color: itemC.color, weight: 300,
      })
      useCalculator.getState().addManualPlacement({
        id: 'drag', itemId: itemA.id, name: 'DRAG', x: 6, y: 6, width: 4, length: 1, layers: 5, rotated: false, color: itemA.color, weight: 140,
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
      })
    })

    dragMergeR24('DRAG', 1 - 6, 1 - 6)

    const placements = useCalculator.getState().manualPlacements
    expect(placements.length).toBe(1)
    const merged = placements[0]
    expect(merged.id).toBe('target')
    expect(merged.itemId).toBe(itemC.id) // target (standalone C) survives, NOT dragged's nominal A
    expect(merged.composition).toEqual([
      { itemId: itemC.id, layers: 1 },
      { itemId: itemA.id, layers: 2 },
      { itemId: itemB.id, layers: 3 },
    ])
    expect(merged.layers).toBe(6)
    // Round 24 corrective pass: the DRAGGED side is composed, so this must
    // NOT touch catalog quantity for any constituent either — A/B/C's own
    // quantity (10 each) stays exactly as it was before the merge.
    expect(useCalculator.getState().items.find((it) => it.id === itemA.id)?.quantity).toBe(10)
    expect(useCalculator.getState().items.find((it) => it.id === itemB.id)?.quantity).toBe(10)
    expect(useCalculator.getState().items.find((it) => it.id === itemC.id)?.quantity).toBe(10)
  })

  it('Round 24: composed + composed concatenates both compositions, never coalescing non-adjacent same-itemId segments', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    setupPipeDeck()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 10, weight: 100, category: 'X' })
      useCalculator.getState().addItem({ name: 'B', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 10, weight: 200, category: 'X' })
      useCalculator.getState().addItem({ name: 'C', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 10, weight: 300, category: 'X' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    const itemC = useCalculator.getState().items.find((it) => it.name === 'C')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'target', itemId: itemA.id, name: 'TARGET', x: 1, y: 1, width: 4, length: 1, layers: 5, rotated: false, color: itemA.color, weight: 140,
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
      })
      useCalculator.getState().addManualPlacement({
        id: 'drag', itemId: itemC.id, name: 'DRAGCA', x: 6, y: 6, width: 4, length: 1, layers: 2, rotated: false, color: itemC.color, weight: 200,
        composition: [{ itemId: itemC.id, layers: 1 }, { itemId: itemA.id, layers: 1 }],
      })
    })

    dragMergeR24('DRAGCA', 1 - 6, 1 - 6)

    const placements = useCalculator.getState().manualPlacements
    expect(placements.length).toBe(1)
    const merged = placements[0]
    // [A2,B3] ++ [C1,A1] -> [A2,B3,C1,A1] — the two A segments are NOT
    // adjacent (B and C sit between them) so they must stay separate.
    expect(merged.composition).toEqual([
      { itemId: itemA.id, layers: 2 },
      { itemId: itemB.id, layers: 3 },
      { itemId: itemC.id, layers: 1 },
      { itemId: itemA.id, layers: 1 },
    ])
    expect(merged.layers).toBe(7)
    // Round 24 corrective pass: BOTH sides are composed, so this must NOT
    // touch catalog quantity for any constituent — A/B/C's own quantity
    // (10 each) stays exactly as it was before the merge.
    expect(useCalculator.getState().items.find((it) => it.id === itemA.id)?.quantity).toBe(10)
    expect(useCalculator.getState().items.find((it) => it.id === itemB.id)?.quantity).toBe(10)
    expect(useCalculator.getState().items.find((it) => it.id === itemC.id)?.quantity).toBe(10)
  })

  it('Round 24: merge is blocked (no state change) when a constituent\'s combined layers would exceed its own catalog quantity', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    setupPipeDeck()
    act(() => {
      // A's own quantity is 3 — the composed target already uses 2, and the
      // dragged standalone placement carries 2 more of A: 2+2=4 > 3.
      useCalculator.getState().addItem({ name: 'A', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 3, weight: 100, category: 'X' })
      useCalculator.getState().addItem({ name: 'B', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 10, weight: 200, category: 'X' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'target', itemId: itemA.id, name: 'TARGET', x: 1, y: 1, width: 4, length: 1, layers: 5, rotated: false, color: itemA.color, weight: 140,
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
      })
      useCalculator.getState().addManualPlacement({
        id: 'drag', itemId: itemA.id, name: 'DRAGA2', x: 6, y: 6, width: 4, length: 1, layers: 2, rotated: false, color: itemA.color, weight: 100,
      })
    })

    const before = useCalculator.getState().manualPlacements.map((m) => ({ ...m }))
    dragMergeR24('DRAGA2', 1 - 6, 1 - 6)

    expect(useCalculator.getState().manualPlacements).toEqual(before)
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('уже размещены'))
  })

  it('Round 24: category mismatch on a NON-NOMINAL constituent blocks the merge even when both placements share the same nominal itemId', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    setupPipeDeck()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 10, weight: 100, category: 'Обычный' })
      useCalculator.getState().addItem({ name: 'X', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 10, weight: 100, category: 'Обычный' })
      useCalculator.getState().addItem({ name: 'Y', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 10, weight: 100, category: 'Опасный груз' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemX = useCalculator.getState().items.find((it) => it.name === 'X')!
    const itemY = useCalculator.getState().items.find((it) => it.name === 'Y')!
    act(() => {
      // Both placements' own NOMINAL itemId is A — the old
      // reconcileCrossItemMerge compared only the two nominal items'
      // categories (A vs A: equal), completely missing that X and Y
      // (each hidden inside its own placement's composition) actually
      // conflict.
      useCalculator.getState().addManualPlacement({
        id: 'target', itemId: itemA.id, name: 'TARGET', x: 1, y: 1, width: 4, length: 1, layers: 2, rotated: false, color: itemA.color, weight: 100,
        composition: [{ itemId: itemA.id, layers: 1 }, { itemId: itemX.id, layers: 1 }],
      })
      useCalculator.getState().addManualPlacement({
        id: 'drag', itemId: itemA.id, name: 'DRAGAY', x: 6, y: 6, width: 4, length: 1, layers: 2, rotated: false, color: itemA.color, weight: 100,
        composition: [{ itemId: itemA.id, layers: 1 }, { itemId: itemY.id, layers: 1 }],
      })
    })

    const before = useCalculator.getState().manualPlacements.map((m) => ({ ...m }))
    dragMergeR24('DRAGAY', 1 - 6, 1 - 6)

    expect(useCalculator.getState().manualPlacements).toEqual(before)
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('разные категории груза'))
  })

  it('Round 24: rotation lock aggregates across EVERY constituent on both sides, not just the dragged side\'s nominal item', () => {
    render(<Home />)
    clearDemoCargo()
    fireEvent.click(screen.getByText('Ручной'))
    setupPipeDeck()
    act(() => {
      useCalculator.getState().addItem({ name: 'D', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 10, weight: 100, category: 'X' })
      useCalculator.getState().addItem({ name: 'E', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 10, weight: 100, category: 'X' })
      // F is the NON-nominal constituent of the dragged composed placement
      // and is the one with allowRotation: false — the pre-Round-24 code
      // only ever consulted the dragged side's own nominal item (E, which
      // allows rotation), so this is exactly the gap Round 24 closes.
      useCalculator.getState().addItem({ name: 'F', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 10, weight: 100, category: 'X', allowRotation: false })
    })
    const itemD = useCalculator.getState().items.find((it) => it.name === 'D')!
    const itemE = useCalculator.getState().items.find((it) => it.name === 'E')!
    const itemF = useCalculator.getState().items.find((it) => it.name === 'F')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'target', itemId: itemD.id, name: 'TARGETD', x: 1, y: 1, width: 4, length: 1, layers: 1, rotated: false, color: itemD.color, weight: 100,
      })
      useCalculator.getState().addManualPlacement({
        id: 'drag', itemId: itemE.id, name: 'DRAGEF', x: 6, y: 6, width: 4, length: 1, layers: 2, rotated: false, color: itemE.color, weight: 100,
        composition: [{ itemId: itemE.id, layers: 1 }, { itemId: itemF.id, layers: 1 }],
      })
    })

    dragMergeR24('DRAGEF', 1 - 6, 1 - 6)

    const placements = useCalculator.getState().manualPlacements
    expect(placements.length).toBe(1)
    expect(placements[0].rotationLocked).toBe(true)
  })

  it('Round 24 (pinned/AUTO mode): same-item merge collapses back to the plain uncomposed representation and does NOT move catalog quantity', () => {
    render(<Home />)
    clearDemoCargo()
    setupPipeDeck()
    act(() => {
      useCalculator.getState().addItem({ name: 'A', shape: 'cylinder', width: 4, length: 1, height: 0.5, quantity: 5, weight: 100, category: 'X' })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    act(() => {
      const targetId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: 'TARGET', x: 1, y: 1, width: 4, length: 1, layers: 2, rotated: false, color: itemA.color, weight: 100,
      })
      const dragId = useCalculator.getState().pinFromPlaced(0, {
        itemId: itemA.id, name: 'DRAG', x: 4, y: 4, width: 4, length: 1, layers: 3, rotated: false, color: itemA.color, weight: 100,
      })
      useCalculator.setState({ selectedPinIds: [targetId, dragId] })
    })

    dragMergeR24('DRAG', 1 - 4, 1 - 4)

    const pins = useCalculator.getState().pinnedPlacementsByTrip[0] ?? []
    expect(pins.length).toBe(1)
    expect(pins[0].composition).toBeUndefined() // collapsed back to plain
    expect(pins[0].itemId).toBe(itemA.id)
    expect(pins[0].layers).toBe(5)
    expect(pins[0].weight).toBeCloseTo(100, 6)
    // Round 24 doesn't move catalog quantity on merge (unlike the old
    // reconcileCrossItemMerge) — A's own quantity is untouched.
    expect(useCalculator.getState().items.find((it) => it.id === itemA.id)?.quantity).toBe(5)
  })

  // Round 27 (fixes R26-1/R26-2): both bugs originate in the ordinary
  // "Грузы" list catalog-edit fields (ItemList.tsx's NumField), not a
  // drag/drop path — these two tests drive that real DOM input, through
  // onUpdate -> updateItem -> live store state, rather than calling the
  // store action directly (already covered at the unit level in
  // calculator.test.ts).
  function findItemNumInput(itemName: string, labelPrefix: string): HTMLInputElement {
    const nameBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === itemName)
    if (!nameBtn) throw new Error(`R27 test: item row not found for "${itemName}"`)
    let row: HTMLElement | null = nameBtn.parentElement
    while (row && !row.textContent?.includes(labelPrefix)) row = row.parentElement
    if (!row) throw new Error(`R27 test: no ancestor row containing label "${labelPrefix}" found for "${itemName}"`)
    const label = Array.from(row.querySelectorAll('label')).find((l) => l.textContent?.startsWith(labelPrefix))
    const input = label?.parentElement?.querySelector('input')
    if (!input) throw new Error(`R27 test: input not found for label "${labelPrefix}" on "${itemName}"`)
    return input
  }

  it('Round 27: editing a NON-NOMINAL composed constituent\'s weight through the real ItemList field is blocked when it would exceed maxDeckCargoT', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, maxDeckCargoT: 1 } }) // 1000kg
      useCalculator.getState().addItem({ name: 'A', width: 1, length: 1, quantity: 5, weight: 100 })
      useCalculator.getState().addItem({ name: 'B', width: 1, length: 1, quantity: 5, weight: 100 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      // Composed [A2,B3], nominal itemId=A. True weight 500kg, under the 1000kg cap.
      useCalculator.getState().addManualPlacement({
        id: 'm1', itemId: itemA.id, name: 'A', x: 0, y: 0, width: 1, length: 1, layers: 5, rotated: false, color: itemA.color, weight: 100,
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
      })
    })

    const weightInput = findItemNumInput('B', 'Вес, кг за ед.')
    fireEvent.change(weightInput, { target: { value: '1000' } }) // true new total would be 3200kg

    expect(toast.error).toHaveBeenCalled()
    expect(useCalculator.getState().items.find((it) => it.id === itemB.id)?.weight).toBe(100) // rejected
    expect(useCalculator.getState().manualPlacements[0].composition).toEqual([
      { itemId: itemA.id, layers: 2 },
      { itemId: itemB.id, layers: 3 },
    ])
  })

  it('Round 27: tightening a NON-NOMINAL composed constituent\'s "Ярусов" through the real ItemList field clamps only that constituent, keeping layers in sync with composition', () => {
    render(<Home />)
    clearDemoCargo()
    act(() => {
      useCalculator.setState({ deck: { ...useCalculator.getState().deck, clearance: 5 } })
      useCalculator.getState().addItem({ name: 'A', width: 1, length: 1, height: 1, quantity: 5 })
      useCalculator.getState().addItem({ name: 'B', width: 1, length: 1, height: 1, quantity: 5 })
    })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    act(() => {
      useCalculator.getState().addManualPlacement({
        id: 'm1', itemId: itemA.id, name: 'A', x: 0, y: 0, width: 1, length: 1, layers: 5, rotated: false, color: itemA.color,
        composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
      })
    })

    const maxLayersInput = findItemNumInput('B', 'Ярусов') // B is NOT the nominal itemId (A is)
    fireEvent.change(maxLayersInput, { target: { value: '1' } })

    const placement = useCalculator.getState().manualPlacements[0]
    expect(placement.composition).toEqual([{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 1 }])
    expect(placement.layers).toBe(3) // never left desynced at the stale 5
  })

  // Round 29 (malformed-placement contract). Real end-to-end proof: a
  // project loaded through useProjects' own "load into calculator" effect
  // (the actual path a saved/imported project takes), containing a
  // placement with an invalid composition (the R28 audit's exact
  // `[A2,B3,garbage]` reproduction). Confirms: the project still opens
  // (doesn't reject/crash), the load-time warning fires, and the malformed
  // placement is NOT rendered as an ordinary "A6" cargo item on the deck.
  it('Round 29: a project with a malformed placement opens normally, warns once, and the malformed cargo is not rendered as ordinary/valid', () => {
    const badComposition = [{ itemId: 'itemA', layers: 2 }, { itemId: 'itemB', layers: 3 }, { itemId: 'garbage', layers: 1 }]
    const project = {
      id: 'p1',
      name: 'Malformed Project',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deck: { width: 20, length: 8, unit: 'm' as const, gap: 0.1, boardOffset: 0.2, clearance: 5 },
      items: [
        { id: 'itemA', name: 'A', width: 1, length: 1, height: 2, quantity: 5, color: '#0ea5e9', allowRotation: true, weight: 100 },
        { id: 'itemB', name: 'B', width: 1, length: 1, height: 3, quantity: 5, color: '#0ea5e9', allowRotation: true, weight: 200 },
      ],
      manualPlacements: [{
        id: 'm1', itemId: 'itemA', name: 'Ghost', x: 1, y: 1, width: 1, length: 1, layers: 6, rotated: false, color: '#0ea5e9',
        weight: 100,
        malformed: { invalidComposition: true as const, rawComposition: badComposition },
      }],
      pinnedPlacementsByTrip: {},
      separationRules: [],
      mode: 'manual' as const,
      sortStrategy: 'area-desc' as const,
      globalRotation: true,
      showFreeSpace: true,
      showGrid: true,
      showLabels: true,
      showCargoContents: true,
    }

    act(() => {
      useProjects.setState({ hydrated: true, activeId: 'p1', projects: [project] })
    })
    render(<Home />)

    // Project actually opened — item catalog loaded, not rejected wholesale.
    expect(useCalculator.getState().items.map((it) => it.name)).toEqual(['A', 'B'])
    // The malformed placement is still present in state (preserved, not
    // silently dropped) with its original raw data intact.
    const stored = useCalculator.getState().manualPlacements[0]
    expect(stored.malformed?.invalidComposition).toBe(true)
    expect(stored.layers).toBe(6)

    // But it must NOT render as an ordinary 6-layer "A" cargo item on the
    // deck — no SVG text label showing "6" stacked layers of A should exist
    // for this placement's footprint (the "×6" stacked-count badge, or the
    // item name "Ghost"/"A" appearing as a normal placed cargo label).
    expect(svgTextContents().some((t) => t === 'Ghost')).toBe(false)
    expect(svgTextContents().some((t) => t === '×6')).toBe(false)

    // And the load-time warning fired — exactly once, not once per effect
    // re-run (the project-load effect's own `loadedProjectId` guard should
    // prevent a duplicate fire on re-render/React StrictMode double-invoke).
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('повреждён'))
    expect(toast.warning).toHaveBeenCalledTimes(1)
  })

  // Round 30 (bug #15): dragging an EXISTING manual or pinned placement to a
  // position that violates a configured separation rule never warned — only
  // the brand-new-stamp click-place path did (see checkDroppedPlacementSeparation
  // in DeckVisualization.tsx). Separation stays warning-only here: it never
  // blocks or reverses the drop, matching the product's existing
  // warning-only stance (see calculator.ts's own deck-resize separation
  // check). Reuses dragMergeR24/withIdentitySvgTransform/setupPipeDeck
  // (already proven pointerdown/pointermove/pointerup + identity-SVG-CTM
  // machinery from Round 24) — a real production drag through the actual
  // rendered DOM, not a direct call to the tested-in-R29 predicate.
  describe('Round 30: existing-placement drag separation warning', () => {
    it('S30-1: dragging an existing uncomposed MANUAL placement into a violating position warns, and the drop still commits (warning-only)', () => {
      render(<Home />)
      clearDemoCargo()
      fireEvent.click(screen.getByText('Ручной'))
      setupPipeDeck()
      act(() => {
        useCalculator.getState().addItem({ name: 'A', width: 1, length: 1, height: 1, quantity: 1, weight: 100, category: 'Cat1' })
        useCalculator.getState().addItem({ name: 'B', width: 1, length: 1, height: 1, quantity: 1, weight: 200, category: 'Cat2' })
      })
      const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
      const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
      act(() => {
        useCalculator.getState().addManualPlacement({
          id: 'drag', itemId: itemA.id, name: 'DRAG', x: 1, y: 1, width: 1, length: 1, layers: 1, rotated: false, color: itemA.color, weight: 100,
        })
        useCalculator.getState().addManualPlacement({
          id: 'target', itemId: itemB.id, name: 'TARGET', x: 6, y: 5, width: 1, length: 1, layers: 1, rotated: false, color: itemB.color, weight: 200,
        })
        useCalculator.getState().addSeparationRule({ categoryA: 'Cat1', categoryB: 'Cat2', minDistance: 3 })
      })

      // (1,1) -> (7.1,5): footprints end up NOT overlapping (7.1 > 6+1),
      // so this never latches a merge target — a plain move, landing 0.1m
      // from TARGET's edge, well inside the 3m rule.
      dragMergeR24('DRAG', 6.1, 4)

      const dragged = useCalculator.getState().manualPlacements.find((p) => p.id === 'drag')!
      expect(dragged.x).toBeCloseTo(7.1, 1)
      expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('сепарац'))
    })

    it('S30-2: dragging an existing placement to a SAFE position does not warn (regression guard)', () => {
      render(<Home />)
      clearDemoCargo()
      fireEvent.click(screen.getByText('Ручной'))
      setupPipeDeck()
      act(() => {
        useCalculator.getState().addItem({ name: 'A', width: 1, length: 1, height: 1, quantity: 1, weight: 100, category: 'Cat1' })
        useCalculator.getState().addItem({ name: 'B', width: 1, length: 1, height: 1, quantity: 1, weight: 200, category: 'Cat2' })
      })
      const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
      const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
      act(() => {
        useCalculator.getState().addManualPlacement({
          id: 'drag', itemId: itemA.id, name: 'DRAG', x: 1, y: 1, width: 1, length: 1, layers: 1, rotated: false, color: itemA.color, weight: 100,
        })
        useCalculator.getState().addManualPlacement({
          id: 'target', itemId: itemB.id, name: 'TARGET', x: 6, y: 5, width: 1, length: 1, layers: 1, rotated: false, color: itemB.color, weight: 200,
        })
        useCalculator.getState().addSeparationRule({ categoryA: 'Cat1', categoryB: 'Cat2', minDistance: 3 })
      })

      // (1,1) -> ~(1,9): far from TARGET on every axis (exact landing spot
      // may clamp slightly inside the deck edge — the point of this test is
      // "moved, and no separation warning", not the precise coordinate).
      dragMergeR24('DRAG', 0, 8)

      const dragged = useCalculator.getState().manualPlacements.find((p) => p.id === 'drag')!
      expect(dragged.y).toBeGreaterThan(7)
      expect(toast.warning).not.toHaveBeenCalled()
    })

    it('S30-3: dragging a COMPOSED placement checks its constituent\'s category, not just the nominal itemId', () => {
      render(<Home />)
      clearDemoCargo()
      fireEvent.click(screen.getByText('Ручной'))
      setupPipeDeck()
      act(() => {
        useCalculator.getState().addItem({ name: 'A', width: 1, length: 1, height: 1, quantity: 1, weight: 100, category: 'CatA' })
        useCalculator.getState().addItem({ name: 'B', width: 1, length: 1, height: 1, quantity: 1, weight: 200, category: 'CatB' })
        useCalculator.getState().addItem({ name: 'C', width: 1, length: 1, height: 1, quantity: 1, weight: 300, category: 'CatC' })
      })
      const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
      const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
      const itemC = useCalculator.getState().items.find((it) => it.name === 'C')!
      act(() => {
        useCalculator.getState().addManualPlacement({
          id: 'drag', itemId: itemA.id, name: 'DRAG', x: 1, y: 1, width: 1, length: 1, layers: 2, rotated: false, color: itemA.color, weight: 150,
          composition: [{ itemId: itemA.id, layers: 1 }, { itemId: itemB.id, layers: 1 }],
        })
        useCalculator.getState().addManualPlacement({
          id: 'target', itemId: itemC.id, name: 'TARGET', x: 6, y: 5, width: 1, length: 1, layers: 1, rotated: false, color: itemC.color, weight: 300,
        })
        // No rule at all for CatA<->CatC — only the constituent B's category
        // conflicts. A naive nominal-itemId-only check (pre-Round-30) would
        // resolve only 'CatA' and never see this violation.
        useCalculator.getState().addSeparationRule({ categoryA: 'CatB', categoryB: 'CatC', minDistance: 3 })
      })

      dragMergeR24('DRAG', 6.1, 4)

      expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('сепарац'))
    })

    it('S30-4: multi-category composition vs composition — conflict via one specific constituent PAIR is still caught', () => {
      render(<Home />)
      clearDemoCargo()
      fireEvent.click(screen.getByText('Ручной'))
      setupPipeDeck()
      act(() => {
        useCalculator.getState().addItem({ name: 'A', width: 1, length: 1, height: 1, quantity: 1, weight: 100, category: 'CatA' })
        useCalculator.getState().addItem({ name: 'B', width: 1, length: 1, height: 1, quantity: 1, weight: 200, category: 'CatB' })
        useCalculator.getState().addItem({ name: 'C', width: 1, length: 1, height: 1, quantity: 1, weight: 300, category: 'CatC' })
        useCalculator.getState().addItem({ name: 'D', width: 1, length: 1, height: 1, quantity: 1, weight: 400, category: 'CatD' })
      })
      const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
      const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
      const itemC = useCalculator.getState().items.find((it) => it.name === 'C')!
      const itemD = useCalculator.getState().items.find((it) => it.name === 'D')!
      act(() => {
        useCalculator.getState().addManualPlacement({
          id: 'drag', itemId: itemA.id, name: 'DRAG', x: 1, y: 1, width: 1, length: 1, layers: 2, rotated: false, color: itemA.color, weight: 150,
          composition: [{ itemId: itemA.id, layers: 1 }, { itemId: itemB.id, layers: 1 }],
        })
        useCalculator.getState().addManualPlacement({
          id: 'target', itemId: itemC.id, name: 'TARGET', x: 6, y: 5, width: 1, length: 1, layers: 2, rotated: false, color: itemC.color, weight: 350,
          composition: [{ itemId: itemC.id, layers: 1 }, { itemId: itemD.id, layers: 1 }],
        })
        // Only B<->D conflicts — A-C, A-D, B-C all have no rule.
        useCalculator.getState().addSeparationRule({ categoryA: 'CatB', categoryB: 'CatD', minDistance: 3 })
      })

      dragMergeR24('DRAG', 6.1, 4)

      expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('сепарац'))
    })

    it('S30-5: self-exclusion — a placement is never checked against itself, even under a self-pairing rule', () => {
      render(<Home />)
      clearDemoCargo()
      fireEvent.click(screen.getByText('Ручной'))
      setupPipeDeck()
      act(() => {
        useCalculator.getState().addItem({ name: 'A', width: 1, length: 1, height: 1, quantity: 1, weight: 100, category: 'CatSelf' })
      })
      const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
      act(() => {
        useCalculator.getState().addManualPlacement({
          id: 'drag', itemId: itemA.id, name: 'DRAG', x: 1, y: 1, width: 1, length: 1, layers: 1, rotated: false, color: itemA.color, weight: 100,
        })
        // Self-pairing rule: CatSelf <-> CatSelf. With no OTHER placement on
        // the deck, this must never fire against the moving placement itself.
        useCalculator.getState().addSeparationRule({ categoryA: 'CatSelf', categoryB: 'CatSelf', minDistance: 3 })
      })

      dragMergeR24('DRAG', 3, 3)

      const dragged = useCalculator.getState().manualPlacements.find((p) => p.id === 'drag')!
      expect(dragged.x).toBeCloseTo(4, 1)
      expect(toast.warning).not.toHaveBeenCalled()
    })

    it('S30-6: a placement in a DIFFERENT trip never participates in the separation check (cross-trip isolation)', () => {
      render(<Home />)
      clearDemoCargo()
      // AUTO/pinned mode — trips only exist here (MANUAL is architecturally
      // single-trip, see the Round 30 investigation).
      setupPipeDeck()
      act(() => {
        useCalculator.getState().addItem({ name: 'A', width: 1, length: 1, height: 1, quantity: 1, weight: 100, category: 'Cat1' })
        useCalculator.getState().addItem({ name: 'B', width: 1, length: 1, height: 1, quantity: 1, weight: 200, category: 'Cat2' })
      })
      const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
      const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
      act(() => {
        useCalculator.getState().pinFromPlaced(0, {
          itemId: itemA.id, name: 'PINA', x: 1, y: 1, width: 1, length: 1, layers: 1, rotated: false, color: itemA.color,
        })
        // A DIFFERENT trip's placement, positioned exactly where it WOULD
        // violate separation with PINA's drop target if the two were ever
        // compared — proving the check never reaches across trips, not just
        // that it happens not to conflict.
        useCalculator.getState().pinFromPlaced(1, {
          itemId: itemB.id, name: 'PINB_OTHER_TRIP', x: 7, y: 5, width: 1, length: 1, layers: 1, rotated: false, color: itemB.color,
        })
        useCalculator.getState().addSeparationRule({ categoryA: 'Cat1', categoryB: 'Cat2', minDistance: 3 })
      })
      // activeTripIndex defaults to 0 — trip 1's pin is never rendered or
      // passed to DeckVisualization at all while viewing trip 0.
      expect(screen.queryByText('PINB_OTHER_TRIP')).toBeNull()

      dragMergeR24('PINA', 6.1, 4)

      const trip0 = useCalculator.getState().pinnedPlacementsByTrip[0] ?? []
      expect(trip0.find((p) => p.name === 'PINA')?.x).toBeCloseTo(7.1, 1)
      expect(toast.warning).not.toHaveBeenCalled()
    })

    it('S30-7: dragging an existing PINNED placement into a violating position also warns (same contract as manual)', () => {
      render(<Home />)
      clearDemoCargo()
      setupPipeDeck()
      act(() => {
        useCalculator.getState().addItem({ name: 'A', width: 1, length: 1, height: 1, quantity: 1, weight: 100, category: 'Cat1' })
        useCalculator.getState().addItem({ name: 'B', width: 1, length: 1, height: 1, quantity: 1, weight: 200, category: 'Cat2' })
      })
      const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
      const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
      act(() => {
        useCalculator.getState().pinFromPlaced(0, {
          itemId: itemA.id, name: 'PINA', x: 1, y: 1, width: 1, length: 1, layers: 1, rotated: false, color: itemA.color,
        })
        useCalculator.getState().pinFromPlaced(0, {
          itemId: itemB.id, name: 'PINB', x: 6, y: 5, width: 1, length: 1, layers: 1, rotated: false, color: itemB.color,
        })
        useCalculator.getState().addSeparationRule({ categoryA: 'Cat1', categoryB: 'Cat2', minDistance: 3 })
      })

      dragMergeR24('PINA', 6.1, 4)

      const trip0 = useCalculator.getState().pinnedPlacementsByTrip[0] ?? []
      expect(trip0.find((p) => p.name === 'PINA')?.x).toBeCloseTo(7.1, 1)
      expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('сепарац'))
    })

    it('S30-8: a drag that resolves into a merge never fires the separation warning (contract: merge and separation-check are mutually exclusive)', () => {
      render(<Home />)
      clearDemoCargo()
      fireEvent.click(screen.getByText('Ручной'))
      setupPipeDeck()
      act(() => {
        // Self-pairing rule so that IF the merge-target's final overlapping
        // position were (incorrectly) separation-checked, it would violate.
        useCalculator.getState().addItem({ name: 'A', width: 1, length: 1, height: 1, quantity: 2, weight: 100, category: 'CatSelf' })
        useCalculator.getState().addSeparationRule({ categoryA: 'CatSelf', categoryB: 'CatSelf', minDistance: 3 })
      })
      const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
      act(() => {
        useCalculator.getState().addManualPlacement({
          id: 'drag', itemId: itemA.id, name: 'DRAG', x: 1, y: 1, width: 1, length: 1, layers: 1, rotated: false, color: itemA.color, weight: 100,
        })
        useCalculator.getState().addManualPlacement({
          id: 'target', itemId: itemA.id, name: 'TARGET', x: 6, y: 6, width: 1, length: 1, layers: 1, rotated: false, color: itemA.color, weight: 100,
        })
      })

      // Full-overlap drag onto TARGET — same itemId, so planComposedMerge's
      // pipe-shape gate never applies (distinctIds.length === 1) and the
      // merge succeeds outright.
      dragMergeR24('DRAG', 5, 5)

      const placements = useCalculator.getState().manualPlacements
      expect(placements.length).toBe(1) // merge actually happened
      expect(placements[0].layers).toBe(2)
      expect(toast.warning).not.toHaveBeenCalled()
    })
  })
})
