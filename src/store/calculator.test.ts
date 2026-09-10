import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useCalculator, clearCalculatorHistory, roundForDisplay } from './calculator'
import { packingResultFromManual } from '@/lib/packing'
import { toast } from 'sonner'

describe('calculator store', () => {
  beforeEach(() => {
    useCalculator.setState({
      deck: { width: 20, length: 8, unit: 'm', gap: 0.1, boardOffset: 0.2, clearance: 0 },
      items: [],
      separationRules: [],
      sortStrategy: 'area-desc',
      globalRotation: true,
      showFreeSpace: true,
      showGrid: true,
      showLabels: true,
      mode: 'auto',
      manualPlacements: [],
      pinnedPlacementsByTrip: {},
      selectedPinIds: [],
      selectedManualIds: [],
      activeStampId: null,
      stampRotated: false,
    })
  })

  it('adds an item', () => {
    const s = useCalculator.getState()
    s.addItem({ name: 'Box', width: 2, length: 1, quantity: 5 })
    expect(useCalculator.getState().items).toHaveLength(1)
    expect(useCalculator.getState().items[0].name).toBe('Box')
  })

  it('removes item and cascades placements', () => {
    const s = useCalculator.getState()
    s.addItem({ name: 'Box', width: 2, length: 1, quantity: 1 })
    const item = useCalculator.getState().items[0]
    s.addManualPlacement({
      id: 'm1',
      itemId: item.id,
      name: 'Box',
      x: 0,
      y: 0,
      width: 2,
      length: 1,
      layers: 1,
      rotated: false,
      color: item.color,
    })
    expect(useCalculator.getState().manualPlacements).toHaveLength(1)
    s.removeItem(item.id)
    expect(useCalculator.getState().items).toHaveLength(0)
    expect(useCalculator.getState().manualPlacements).toHaveLength(0)
  })

  // Round 16 — removeItem composition-aware surgery. Before this fix,
  // deleting CargoItem A from the catalog filtered out ANY placement whose
  // top-level `p.itemId === A`, wholesale — for a composed [A2,B3]
  // placement (nominal itemId=A), that silently destroyed the 3 physical
  // units of B along with it, even though B is NOT being deleted. The fix:
  // only A's own segment(s) are stripped from `composition`; B stays
  // exactly where it was, now as its own ordinary (uncomposed) placement.
  describe('removeItem — composition-aware surgery (does not lose surviving constituents)', () => {
    function seedAB() {
      const s = useCalculator.getState()
      s.addItem({ name: 'A', width: 1, length: 1, quantity: 5 })
      s.addItem({ name: 'B', width: 1, length: 1, quantity: 5 })
      const A = useCalculator.getState().items.find((it) => it.name === 'A')!
      const B = useCalculator.getState().items.find((it) => it.name === 'B')!
      return { A, B }
    }

    // A. Базовый: [A2,B3] -> removeItem(A) -> B survives as an ordinary B3 placement.
    it('A. [A2,B3] removeItem(A): B survives, un-composes to a plain B3 placement, A\'s catalog row is gone', () => {
      const s = useCalculator.getState()
      const { A, B } = seedAB()
      s.addManualPlacement({
        id: 'm1', itemId: A.id, name: 'A', x: 0, y: 0, width: 1, length: 1,
        layers: 5, rotated: false, color: '#000',
        composition: [{ itemId: A.id, layers: 2 }, { itemId: B.id, layers: 3 }],
      })

      s.removeItem(A.id)

      expect(useCalculator.getState().items.find((it) => it.id === A.id)).toBeUndefined()
      expect(useCalculator.getState().items.find((it) => it.id === B.id)).toBeDefined()
      expect(useCalculator.getState().manualPlacements).toHaveLength(1)
      const survivor = useCalculator.getState().manualPlacements[0]
      expect(survivor.id).toBe('m1') // same placement, transformed — not deleted and re-created
      expect(survivor.itemId).toBe(B.id)
      expect(survivor.layers).toBe(3)
      expect(survivor.composition).toBeUndefined() // un-composed — only one constituent left
    })

    // B. Non-adjacent: [A2,B3,A1] -> removeItem(B) -> composition coalesces to [A3].
    it('B. [A2,B3,A1] removeItem(B): the two non-adjacent A segments coalesce to a single A3, A does not gain B\'s layers', () => {
      const s = useCalculator.getState()
      const { A, B } = seedAB()
      s.addManualPlacement({
        id: 'm1', itemId: A.id, name: 'A', x: 0, y: 0, width: 1, length: 1,
        layers: 6, rotated: false, color: '#000',
        composition: [{ itemId: A.id, layers: 2 }, { itemId: B.id, layers: 3 }, { itemId: A.id, layers: 1 }],
      })

      s.removeItem(B.id)

      expect(useCalculator.getState().items.find((it) => it.id === B.id)).toBeUndefined()
      const survivor = useCalculator.getState().manualPlacements[0]
      expect(survivor.itemId).toBe(A.id)
      expect(survivor.layers).toBe(3) // 2 + 1, not 2 (only the first A segment)
      expect(survivor.composition).toBeUndefined()
    })

    // C. [A2,B3,A1] -> removeItem(A) -> composition becomes plain B3, B stays physically placed.
    it('C. [A2,B3,A1] removeItem(A): both A segments (2+1=3) are removed together, B survives untouched as B3', () => {
      const s = useCalculator.getState()
      const { A, B } = seedAB()
      s.addManualPlacement({
        id: 'm1', itemId: A.id, name: 'A', x: 0, y: 0, width: 1, length: 1,
        layers: 6, rotated: false, color: '#000',
        composition: [{ itemId: A.id, layers: 2 }, { itemId: B.id, layers: 3 }, { itemId: A.id, layers: 1 }],
      })

      s.removeItem(A.id)

      expect(useCalculator.getState().items.find((it) => it.id === A.id)).toBeUndefined()
      expect(useCalculator.getState().items.find((it) => it.id === B.id)).toBeDefined()
      const survivor = useCalculator.getState().manualPlacements[0]
      expect(survivor.itemId).toBe(B.id)
      expect(survivor.layers).toBe(3)
      expect(survivor.composition).toBeUndefined()
      // Position/geometry untouched — this is a composition edit, not a move.
      expect(survivor.x).toBe(0)
      expect(survivor.y).toBe(0)
    })

    // E. Multi-trip: removeItem must scan EVERY trip's pinned placements,
    // not just the active one — the deleted item's placements can live in
    // any trip.
    it('E. Multi-trip: removeItem(B) strips B out of BOTH trip 0\'s [A2,B3] and trip 1\'s [C4,B2], independent of which trip is active', () => {
      const s = useCalculator.getState()
      const { A, B } = seedAB()
      s.addItem({ name: 'C', width: 1, length: 1, quantity: 5 })
      const C = useCalculator.getState().items.find((it) => it.name === 'C')!

      const pin0 = s.pinFromPlaced(0, { itemId: A.id, name: 'A', x: 0, y: 0, width: 1, length: 1, layers: 5, rotated: false, color: '#000' })
      s.updatePinned(0, pin0, { composition: [{ itemId: A.id, layers: 2 }, { itemId: B.id, layers: 3 }] })
      const pin1 = s.pinFromPlaced(1, { itemId: C.id, name: 'C', x: 0, y: 0, width: 1, length: 1, layers: 6, rotated: false, color: '#000' })
      s.updatePinned(1, pin1, { composition: [{ itemId: C.id, layers: 4 }, { itemId: B.id, layers: 2 }] })

      s.removeItem(B.id)

      expect(useCalculator.getState().items.find((it) => it.id === B.id)).toBeUndefined()
      const trip0 = useCalculator.getState().pinnedPlacementsByTrip[0]
      const trip1 = useCalculator.getState().pinnedPlacementsByTrip[1]
      expect(trip0).toHaveLength(1)
      expect(trip0[0].itemId).toBe(A.id)
      expect(trip0[0].layers).toBe(2)
      expect(trip0[0].composition).toBeUndefined()
      expect(trip1).toHaveLength(1)
      expect(trip1[0].itemId).toBe(C.id)
      expect(trip1[0].layers).toBe(4)
      expect(trip1[0].composition).toBeUndefined()
    })

    // F. Mixed composed/uncomposed: removeItem must touch ONLY the segment
    // that actually matches, and leave every unrelated placement — even
    // other placements of the SAME itemId — completely unrecalculated.
    it('F. Mixed composed/uncomposed placements: only the composed one is touched, sibling uncomposed placements of the same itemId are untouched', () => {
      const s = useCalculator.getState()
      const { A, B } = seedAB()
      s.addManualPlacement({ id: 'mA', itemId: A.id, name: 'A', x: 0, y: 0, width: 1, length: 1, layers: 3, rotated: false, color: '#000' }) // uncomposed A3
      s.addManualPlacement({
        id: 'mAB', itemId: A.id, name: 'A', x: 5, y: 5, width: 1, length: 1,
        layers: 5, rotated: false, color: '#000',
        composition: [{ itemId: A.id, layers: 2 }, { itemId: B.id, layers: 3 }],
      }) // composed [A2,B3]
      s.addManualPlacement({ id: 'mB', itemId: B.id, name: 'B', x: 9, y: 9, width: 1, length: 1, layers: 2, rotated: false, color: '#000' }) // uncomposed B2
      const mBBefore = useCalculator.getState().manualPlacements.find((m) => m.id === 'mB')

      s.removeItem(A.id)

      // Uncomposed A3 ('mA'): itemId===A with no composition -> removed
      // entirely, same as the pre-existing (dormant) behavior.
      expect(useCalculator.getState().manualPlacements.find((m) => m.id === 'mA')).toBeUndefined()
      // Composed [A2,B3] ('mAB'): A's segment stripped, B survives as its own B3.
      const survivor = useCalculator.getState().manualPlacements.find((m) => m.id === 'mAB')
      expect(survivor?.itemId).toBe(B.id)
      expect(survivor?.layers).toBe(3)
      expect(survivor?.composition).toBeUndefined()
      // Uncomposed B2 ('mB'): doesn't reference A at all — untouched,
      // exact same object values as before.
      const mBAfter = useCalculator.getState().manualPlacements.find((m) => m.id === 'mB')
      expect(mBAfter).toEqual(mBBefore)
    })
  })

  it('converts units correctly', () => {
    const s = useCalculator.getState()
    s.setDeck({ width: 2, length: 1, gap: 0.1, boardOffset: 0.05, clearance: 0.5 })
    s.setUnit('cm')
    const deck = useCalculator.getState().deck
    expect(deck.unit).toBe('cm')
    expect(deck.width).toBeCloseTo(200)
    expect(deck.length).toBeCloseTo(100)
    expect(deck.gap).toBeCloseTo(10)
  })

  it('converts power socket coordinates when switching units (regression: used to stay in old units and drift off the deck)', () => {
    const s = useCalculator.getState()
    s.setDeck({ width: 2, length: 1, gap: 0.1, boardOffset: 0.05, clearance: 0.5 })
    s.addPowerSocket({ x: 1, y: 0.5, label: 'Розетка 1' })
    s.setUnit('cm')
    const socket = useCalculator.getState().deck.powerSockets?.[0]
    expect(socket?.x).toBeCloseTo(100)
    expect(socket?.y).toBeCloseTo(50)
  })

  it('converts the deck outline polygon when switching units (regression: area computed from a stale-unit outline caused false "does not fit" errors)', () => {
    const s = useCalculator.getState()
    s.setDeck({
      width: 2,
      length: 1,
      outline: [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 1 },
        { x: 0, y: 1 },
      ],
    })
    s.setUnit('cm')
    const outline = useCalculator.getState().deck.outline
    expect(outline?.[1].x).toBeCloseTo(200)
    expect(outline?.[2].y).toBeCloseTo(100)
  })

  it('round-trips meters to feet and back without drift', () => {
    const s = useCalculator.getState()
    s.setDeck({ width: 20, length: 8 })
    s.setUnit('ft')
    s.setUnit('m')
    const deck = useCalculator.getState().deck
    expect(deck.width).toBeCloseTo(20, 6)
    expect(deck.length).toBeCloseTo(8, 6)
  })

  it('produces a display-clean value switching ft -> cm (regression: used to show 1999.999999992 instead of 2000)', () => {
    const s = useCalculator.getState()
    s.setDeck({ width: 20, length: 8 })
    s.setUnit('ft')
    s.setUnit('cm')
    const deck = useCalculator.getState().deck
    // The stored value only needs to stay geometrically precise (very close,
    // not necessarily bit-exact) — roundForDisplay() is what the UI actually
    // binds to, and that must come out exactly clean.
    expect(deck.width).toBeCloseTo(2000, 6)
    expect(deck.length).toBeCloseTo(800, 6)
    expect(roundForDisplay(deck.width)).toBe(2000)
    expect(roundForDisplay(deck.length)).toBe(800)
  })

  it('does not round the stored value coarsely enough to break geometry epsilons (regression: a prior fix rounded to 4 decimal places in ft, ~1.5e-5m noise, which broke boardOffset boundary checks using 1e-6m epsilons)', () => {
    const s = useCalculator.getState()
    s.setDeck({ width: 20, length: 8, boardOffset: 0.2, gap: 0.1 })
    s.setUnit('ft')
    const deck = useCalculator.getState().deck
    // boardOffset in ft should be within 1e-6 of the true converted value —
    // far tighter than the old bug's ~1.5e-5 error.
    expect(deck.boardOffset).toBeCloseTo(0.2 / 0.3048, 6)
  })

  // Regression: setUnit converted every geometry field on items/placements
  // except stabilityOverride — stability.ts treats vcgAboveDeckM/
  // tcgOffsetM/lcgOffsetM as being in the deck's current display unit (same
  // as x/y/width/length), so leaving it unconverted silently corrupted a
  // VCG/TCG override by whatever factor separates the old and new units
  // the next time stability was computed (e.g. ~3.28x for m<->ft).
  it('converts item stabilityOverride when switching units', () => {
    const s = useCalculator.getState()
    s.setDeck({ width: 20, length: 8 })
    s.addItem({ name: 'Box', width: 1, length: 1, quantity: 1 })
    const item = useCalculator.getState().items[0]
    s.setItemStabilityOverride(item.id, { vcgAboveDeckM: 1, tcgOffsetM: 0.5, lcgOffsetM: -0.5 })
    s.setUnit('ft')
    const converted = useCalculator.getState().items.find((it) => it.id === item.id)!.stabilityOverride!
    expect(converted.vcgAboveDeckM).toBeCloseTo(1 / 0.3048, 6)
    expect(converted.tcgOffsetM).toBeCloseTo(0.5 / 0.3048, 6)
    expect(converted.lcgOffsetM).toBeCloseTo(-0.5 / 0.3048, 6)
    s.setUnit('m')
    const roundTripped = useCalculator.getState().items.find((it) => it.id === item.id)!.stabilityOverride!
    expect(roundTripped.vcgAboveDeckM).toBeCloseTo(1, 6)
    expect(roundTripped.tcgOffsetM).toBeCloseTo(0.5, 6)
    expect(roundTripped.lcgOffsetM).toBeCloseTo(-0.5, 6)
  })

  // Regression: backgroundImageRect (the calibrated reference-photo
  // rectangle, in the same deck-local coordinate space as everything else)
  // was left out of setUnit entirely, desyncing the photo from the deck's
  // new unit scale the moment the user switched units.
  it('converts deck.backgroundImageRect when switching units', () => {
    const s = useCalculator.getState()
    s.setDeck({ width: 20, length: 8 })
    s.setDeckBackgroundImageRect({ x: 1, y: 2, width: 10, length: 5 })
    s.setUnit('cm')
    const rect = useCalculator.getState().deck.backgroundImageRect!
    expect(rect.x).toBeCloseTo(100, 6)
    expect(rect.y).toBeCloseTo(200, 6)
    expect(rect.width).toBeCloseTo(1000, 6)
    expect(rect.length).toBeCloseTo(500, 6)
  })

  it('does not auto-select a cargo item when switching mode', () => {
    const s = useCalculator.getState()
    s.addItem({ name: 'Box', width: 2, length: 1, quantity: 1 })
    expect(useCalculator.getState().activeStampId).toBeNull()
    s.setMode('manual')
    expect(useCalculator.getState().activeStampId).toBeNull()
    s.setMode('auto')
    expect(useCalculator.getState().activeStampId).toBeNull()
  })

  // Regression coverage: setMode is a pure flag flip with zero reconciliation
  // between manualPlacements and pinnedPlacementsByTrip — this was previously
  // asserted only informally, with no test proving an AUTO<->MANUAL round
  // trip preserves both representations (placement count, mass, which trip
  // each pin belongs to) untouched.
  it('preserves manualPlacements and pinnedPlacementsByTrip exactly across an AUTO -> MANUAL -> AUTO round trip', () => {
    useCalculator.setState({
      manualPlacements: [
        { id: 'm1', itemId: 'a', name: 'A', x: 0, y: 0, width: 2, length: 1, layers: 3, rotated: false, color: '#000', weight: 500 },
      ],
      pinnedPlacementsByTrip: {
        0: [{ id: 'p1', itemId: 'a', name: 'A', x: 5, y: 5, width: 2, length: 1, layers: 2, rotated: false, color: '#000', weight: 500 }],
        2: [{ id: 'p2', itemId: 'a', name: 'A', x: 8, y: 8, width: 2, length: 1, layers: 4, rotated: true, color: '#000', weight: 500 }],
      },
    })
    const before = {
      manual: useCalculator.getState().manualPlacements,
      pinned: useCalculator.getState().pinnedPlacementsByTrip,
    }

    const s = useCalculator.getState()
    s.setMode('manual')
    s.setMode('auto')

    const after = {
      manual: useCalculator.getState().manualPlacements,
      pinned: useCalculator.getState().pinnedPlacementsByTrip,
    }
    expect(after).toEqual(before)
    const totalLayers =
      after.manual.reduce((sum, m) => sum + m.layers, 0) +
      Object.values(after.pinned).flat().reduce((sum, p) => sum + p.layers, 0)
    expect(totalLayers).toBe(3 + 2 + 4)
  })

  it('arming a preset template clears an active item stamp and vice versa', () => {
    const s = useCalculator.getState()
    s.addItem({ name: 'Box', width: 2, length: 1, quantity: 1 })
    const item = useCalculator.getState().items[0]
    s.setActiveStamp(item.id)
    expect(useCalculator.getState().activeStampId).toBe(item.id)
    s.setPendingPresetStamp({ name: 'Контейнер 20ft', width: 6.06, length: 2.44 })
    expect(useCalculator.getState().activeStampId).toBeNull()
    expect(useCalculator.getState().pendingPresetStamp?.name).toBe('Контейнер 20ft')
    s.setActiveStamp(item.id)
    expect(useCalculator.getState().pendingPresetStamp).toBeNull()
  })

  it('shifts existing manual placements inward when boardOffset increases', () => {
    const s = useCalculator.getState()
    s.setDeck({ width: 10, length: 10, boardOffset: 0.2, gap: 0 })
    s.addManualPlacement({
      id: 'm1', itemId: 'x', name: 'Box', x: 0.2, y: 0.2, width: 1, length: 1, layers: 1, rotated: false, color: '#000',
    })
    s.setDeck({ boardOffset: 1 })
    const mp = useCalculator.getState().manualPlacements[0]
    expect(mp.x).toBeGreaterThanOrEqual(1)
    expect(mp.y).toBeGreaterThanOrEqual(1)
  })

  it('resolves a collision introduced by shifting placements inward', () => {
    const s = useCalculator.getState()
    s.setDeck({ width: 10, length: 10, boardOffset: 0.2, gap: 0 })
    s.addManualPlacement({
      id: 'm1', itemId: 'x', name: 'A', x: 0.2, y: 0.2, width: 1, length: 1, layers: 1, rotated: false, color: '#000',
    })
    s.addManualPlacement({
      id: 'm2', itemId: 'x', name: 'B', x: 1.2, y: 0.2, width: 1, length: 1, layers: 1, rotated: false, color: '#000',
    })
    s.setDeck({ boardOffset: 1 })
    const [a, b] = useCalculator.getState().manualPlacements
    const overlap = !(
      a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.length <= b.y || b.y + b.length <= a.y
    )
    expect(overlap).toBe(false)
  })

  it('leaves placements untouched when an unrelated deck field changes', () => {
    const s = useCalculator.getState()
    s.setDeck({ width: 10, length: 10, boardOffset: 0.2, gap: 0 })
    s.addManualPlacement({
      id: 'm1', itemId: 'x', name: 'Box', x: 0.2, y: 0.2, width: 1, length: 1, layers: 1, rotated: false, color: '#000',
    })
    s.setDeck({ clearance: 5 })
    const mp = useCalculator.getState().manualPlacements[0]
    expect(mp.x).toBe(0.2)
    expect(mp.y).toBe(0.2)
  })

  it('toggles global rotation', () => {
    const s = useCalculator.getState()
    expect(s.globalRotation).toBe(true)
    s.toggleGlobalRotation()
    expect(useCalculator.getState().globalRotation).toBe(false)
  })

  it('addOrIncrementCargoFromTemplate creates a new item with quantity 1 on first call', () => {
    const s = useCalculator.getState()
    const before = useCalculator.getState().items.length
    const id = s.addOrIncrementCargoFromTemplate({ name: 'Контейнер 20ft', width: 6.06, length: 2.44, weight: 2200 })
    const state = useCalculator.getState()
    expect(state.items.length).toBe(before + 1)
    const created = state.items.find((it) => it.id === id)
    expect(created?.quantity).toBe(1)
    expect(created?.name).toBe('Контейнер 20ft')
  })

  it('addOrIncrementCargoFromTemplate increments quantity on repeat calls instead of duplicating the item (regression: presets used to bulk-add a whole category at once)', () => {
    const s = useCalculator.getState()
    s.setDeck({ width: 15, length: 7 })
    const before = useCalculator.getState().items.length
    const id1 = s.addOrIncrementCargoFromTemplate({ name: 'Контейнер 20ft', width: 6.06, length: 2.44 })
    const id2 = s.addOrIncrementCargoFromTemplate({ name: 'Контейнер 20ft', width: 6.06, length: 2.44 })
    const state = useCalculator.getState()
    expect(id1).toBe(id2)
    expect(state.items.length).toBe(before + 1)
    expect(state.items.find((it) => it.id === id1)?.quantity).toBe(2)
    // Deck size is never touched by cargo/preset actions.
    expect(state.deck.width).toBe(15)
  })

  it('addOrIncrementCargoFromTemplate carries contents/nest/stabilityOverride through (regression: makeItem used to silently drop any template field it didn\'t explicitly whitelist)', () => {
    const s = useCalculator.getState()
    const nest = {
      pipeOuterDiameterM: 0.957, pipeLengthM: 12.38, pipeWeightKg: 15000, usableWidthM: 16.9,
      pipesPerRow: 17, tierCounts: [17, 16], pipeCount: 33, heightM: 2.064, vcgAboveDeckM: 1.107,
      crateHeightM: 0.15, limited: false, requestedPipeCount: 33, requestedTiers: 2,
    }
    const id = s.addOrIncrementCargoFromTemplate({
      name: 'Труба-тест — штабель',
      width: 16.9,
      length: 12.38,
      height: 2.064,
      shape: 'pipe-nest',
      contents: 'тестовая полезная нагрузка',
      nest,
    })
    const created = useCalculator.getState().items.find((it) => it.id === id)
    expect(created?.contents).toBe('тестовая полезная нагрузка')
    expect(created?.nest).toEqual(nest)
    expect(created?.shape).toBe('pipe-nest')
  })

  it('duplicates an item', () => {
    const s = useCalculator.getState()
    s.addItem({ name: 'Box', width: 2, length: 1, quantity: 1 })
    const original = useCalculator.getState().items[0]
    s.duplicateItem(original.id)
    const items = useCalculator.getState().items
    expect(items).toHaveLength(2)
    expect(items[1].name).toContain('копия')
    expect(items[1].id).not.toBe(original.id)
  })

  it('adds, updates and removes a load zone', () => {
    const s = useCalculator.getState()
    s.addLoadZone({ x: 1, y: 1, width: 3, length: 3, maxLoadPerArea: 2 })
    let zones = useCalculator.getState().deck.loadZones
    expect(zones).toHaveLength(1)
    const id = zones![0].id
    s.updateLoadZone(id, { maxLoadPerArea: 4 })
    zones = useCalculator.getState().deck.loadZones
    expect(zones![0].maxLoadPerArea).toBe(4)
    s.removeLoadZone(id)
    expect(useCalculator.getState().deck.loadZones).toHaveLength(0)
  })

  it('adds and removes a lashing point', () => {
    const s = useCalculator.getState()
    s.addLashingPoint({ x: 2, y: 3, label: 'Точка 1' })
    const points = useCalculator.getState().deck.lashingPoints
    expect(points).toHaveLength(1)
    expect(points![0].label).toBe('Точка 1')
    s.removeLashingPoint(points![0].id)
    expect(useCalculator.getState().deck.lashingPoints).toHaveLength(0)
  })

  it('keeps a lashing point glued to its cargo corner when the placement moves', () => {
    const s = useCalculator.getState()
    s.addItem({ name: 'Box', width: 2, length: 1, quantity: 1 })
    const item = useCalculator.getState().items[0]
    s.addManualPlacement({
      id: 'm1',
      itemId: item.id,
      name: 'Box',
      x: 0,
      y: 0,
      width: 2,
      length: 1,
      layers: 1,
      rotated: false,
      color: item.color,
    })
    s.addLashingPoint({ x: 5, y: 5, placementId: 'm1', cornerX: 2, cornerY: 1 })
    s.updateManualPlacement('m1', { x: 3, y: 4 })
    const point = useCalculator.getState().deck.lashingPoints![0]
    // The placement moved by (+3, +4) — the corner anchor should follow by
    // the same delta (2+3, 1+4), not stay behind at its original snapshot.
    expect(point.cornerX).toBeCloseTo(5)
    expect(point.cornerY).toBeCloseTo(5)
  })

  it('clears lashing points for a placement via clearLashingPointsFor', () => {
    const s = useCalculator.getState()
    s.addLashingPoint({ x: 2, y: 3, placementId: 'p1' })
    s.addLashingPoint({ x: 4, y: 5, placementId: 'p2' })
    s.clearLashingPointsFor('p1')
    const points = useCalculator.getState().deck.lashingPoints
    expect(points).toHaveLength(1)
    expect(points![0].placementId).toBe('p2')
  })

  it('adds, updates and removes a power socket', () => {
    const s = useCalculator.getState()
    s.addPowerSocket({ x: 4, y: 2, label: 'Розетка 1' })
    let sockets = useCalculator.getState().deck.powerSockets
    expect(sockets).toHaveLength(1)
    expect(sockets![0].label).toBe('Розетка 1')
    const id = sockets![0].id
    s.updatePowerSocket(id, { x: 6, y: 3 })
    sockets = useCalculator.getState().deck.powerSockets
    expect(sockets![0].x).toBe(6)
    expect(sockets![0].y).toBe(3)
    s.removePowerSocket(id)
    expect(useCalculator.getState().deck.powerSockets).toHaveLength(0)
  })

  it('arming a cargo stamp or preset disarms placingLashingPoint/placingPowerSocket, and vice versa', () => {
    const s = useCalculator.getState()
    s.setPlacingPowerSocket(true)
    expect(useCalculator.getState().placingPowerSocket).toBe(true)
    s.setPlacingLashingPoint(true)
    expect(useCalculator.getState().placingLashingPoint).toBe(true)
    expect(useCalculator.getState().placingPowerSocket).toBe(false)
    s.setActiveStamp('some-id')
    expect(useCalculator.getState().placingLashingPoint).toBe(false)
    s.setPlacingPowerSocket(true)
    s.setPendingPresetStamp({ name: 'X' })
    expect(useCalculator.getState().placingPowerSocket).toBe(false)
  })

  it('adds, updates and removes an annotation', () => {
    const s = useCalculator.getState()
    s.addAnnotation({ x: 4, y: 2, text: 'Нос', kind: 'bow' })
    let annotations = useCalculator.getState().deck.annotations
    expect(annotations).toHaveLength(1)
    expect(annotations![0].text).toBe('Нос')
    const id = annotations![0].id
    s.updateAnnotation(id, { x: 6, y: 3, text: 'Нос судна' })
    annotations = useCalculator.getState().deck.annotations
    expect(annotations![0].x).toBe(6)
    expect(annotations![0].text).toBe('Нос судна')
    s.removeAnnotation(id)
    expect(useCalculator.getState().deck.annotations).toHaveLength(0)
  })

  it('arming placingAnnotation disarms placingLashingPoint/placingPowerSocket, and vice versa', () => {
    const s = useCalculator.getState()
    s.setPlacingPowerSocket(true)
    s.setPlacingAnnotation({ kind: 'note', withLeader: false })
    expect(useCalculator.getState().placingAnnotation).toEqual({ kind: 'note', withLeader: false })
    expect(useCalculator.getState().placingPowerSocket).toBe(false)
    s.setPlacingLashingPoint(true)
    expect(useCalculator.getState().placingLashingPoint).toBe(true)
    expect(useCalculator.getState().placingAnnotation).toBeNull()
    s.setPlacingAnnotation({ kind: 'bow', withLeader: false })
    s.setActiveStamp('some-id')
    expect(useCalculator.getState().placingAnnotation).toBeNull()
  })

  // Regression: a full placement replace (auto-redistribute, or switching
  // manual<->auto mode) hands every placement a brand-new id, so a lashing
  // point's old placementId never matches anything afterward. Without a
  // carryover step, pruneStaleLashingPoints alone silently deletes every
  // point on every redistribute — remapLashingPointsForRedistribute must
  // carry them onto their matched new placement instead.
  it('carries lashing points onto their new placement id after a full redistribute', () => {
    const s = useCalculator.getState()
    s.addItem({ name: 'Box', width: 2, length: 1, quantity: 1 })
    const item = useCalculator.getState().items[0]
    // Simulates the post-redistribute store state: the new placement (with
    // its brand-new id) is already in place before the remap action runs,
    // exactly like applyVariant's real call order (setState, then remap).
    s.addManualPlacement({
      id: 'new-1',
      itemId: item.id,
      name: 'Box',
      x: 3,
      y: -2,
      width: 2,
      length: 1,
      layers: 1,
      rotated: false,
      color: item.color,
    })
    s.addLashingPoint({ x: 5, y: 5, placementId: 'old-1', cornerX: 2, cornerY: 1 })
    s.addLashingPoint({ x: 10, y: 10, placementId: 'old-orphan' }) // no match provided below
    s.remapLashingPointsForRedistribute([{ oldId: 'old-1', newId: 'new-1', dx: 3, dy: -2 }])
    const points = useCalculator.getState().deck.lashingPoints
    // The unmatched point (old-orphan) has no live placement id at all in
    // this test's store, so pruneOrphanLashingPoints drops it too — only
    // the successfully-carried-over point should remain.
    expect(points).toHaveLength(1)
    expect(points![0].placementId).toBe('new-1')
    // Corner shifted by the same delta the matched placement moved.
    expect(points![0].cornerX).toBeCloseTo(5)
    expect(points![0].cornerY).toBeCloseTo(-1)
    // Regression: the anchor's own x/y must shift by the same delta too —
    // leaving it behind at (5, 5) would strand it wherever the cargo used
    // to be, potentially inside some other placement's new footprint.
    expect(points![0].x).toBeCloseTo(8)
    expect(points![0].y).toBeCloseTo(3)
  })

  it('converts a placement clearanceMargin when switching units', () => {
    const s = useCalculator.getState()
    s.addItem({ name: 'Box', width: 2, length: 1, quantity: 1 })
    const item = useCalculator.getState().items[0]
    s.addManualPlacement({
      id: 'm1',
      itemId: item.id,
      name: 'Box',
      x: 0,
      y: 0,
      width: 2,
      length: 1,
      layers: 1,
      rotated: false,
      color: item.color,
      clearanceMargin: { top: 1, right: 1, bottom: 1, left: 1 },
    })
    s.setUnit('cm')
    const placement = useCalculator.getState().manualPlacements[0]
    expect(placement.clearanceMargin?.top).toBeCloseTo(100)
    expect(placement.clearanceMargin?.right).toBeCloseTo(100)
    expect(placement.clearanceMargin?.bottom).toBeCloseTo(100)
    expect(placement.clearanceMargin?.left).toBeCloseTo(100)
  })

  it('drops a lashing point attached to a manual placement when that placement is removed', () => {
    const s = useCalculator.getState()
    s.addManualPlacement({
      id: 'm1', itemId: 'a', name: 'Box', x: 0, y: 0, width: 2, length: 1, layers: 1, rotated: false, color: '#000',
    })
    s.addLashingPoint({ x: 5, y: 5, placementId: 'm1' })
    s.addLashingPoint({ x: 6, y: 6, placementId: undefined }) // plain, unattached pin
    s.removeManualPlacement('m1')
    const points = useCalculator.getState().deck.lashingPoints
    expect(points).toHaveLength(1)
    expect(points![0].placementId).toBeUndefined()
  })

  // Regression: removeItem removed the item's placements but never called
  // pruneOrphanLashingPoints, unlike removeManualPlacement/clearManualPlacements
  // above — deleting a cargo item left its lashing points behind forever.
  it('drops a lashing point attached to a placement when the underlying cargo item is deleted', () => {
    const s = useCalculator.getState()
    s.addItem({ name: 'Box', width: 2, length: 1, quantity: 1 })
    const item = useCalculator.getState().items[0]
    s.addManualPlacement({
      id: 'm1', itemId: item.id, name: 'Box', x: 0, y: 0, width: 2, length: 1, layers: 1, rotated: false, color: '#000',
    })
    s.addLashingPoint({ x: 5, y: 5, placementId: 'm1' })
    s.removeItem(item.id)
    expect(useCalculator.getState().deck.lashingPoints).toHaveLength(0)
  })

  it('drops every lashing point when clearItems empties the whole project', () => {
    const s = useCalculator.getState()
    s.addItem({ name: 'Box', width: 2, length: 1, quantity: 1 })
    const item = useCalculator.getState().items[0]
    s.addManualPlacement({
      id: 'm1', itemId: item.id, name: 'Box', x: 0, y: 0, width: 2, length: 1, layers: 1, rotated: false, color: '#000',
    })
    s.addLashingPoint({ x: 5, y: 5, placementId: 'm1' })
    s.clearItems()
    expect(useCalculator.getState().deck.lashingPoints).toHaveLength(0)
  })

  // Regression: maxLayersFor() factors maxStackHeightM into its cap, but
  // layerCapChanged only checked maxLayers/height, so tightening
  // maxStackHeightM alone silently left an already-placed stack over-tall.
  it('re-clamps an existing placement\'s layers when maxStackHeightM alone is tightened', () => {
    const s = useCalculator.getState()
    s.addItem({ name: 'Box', width: 2, length: 1, height: 1, quantity: 5 })
    const item = useCalculator.getState().items[0]
    s.addManualPlacement({
      id: 'm1', itemId: item.id, name: 'Box', x: 0, y: 0, width: 2, length: 1, layers: 5, rotated: false, color: '#000',
    })
    s.updateItem(item.id, { maxStackHeightM: 2 })
    const placement = useCalculator.getState().manualPlacements[0]
    expect(placement.layers).toBe(2)
  })

  // R27 (fixes R26-2): the layerCapChanged clamp used to write
  // `{ layers: newMaxLayers }` directly whenever `p.itemId === id` — for a
  // composed placement whose NOMINAL itemId was the edited item, this
  // overwrote the placement's top-level `layers` while leaving
  // `composition` completely untouched, desyncing `layers` from
  // `placementTotalLayers(composition)` — an explicit, documented
  // invariant violation. This is the exact reproduction from the R26 audit
  // report: A's own maxLayers tightened from unset (5, via deck.clearance)
  // to 2 on a composed [A2,B3] placement.
  it('R26-2: tightening the NOMINAL constituent\'s maxLayers reduces only that constituent\'s own segment, keeping layers in sync with composition', () => {
    const s = useCalculator.getState()
    s.setDeck({ clearance: 5 })
    s.addItem({ name: 'A', width: 1, length: 1, height: 1, quantity: 5 })
    s.addItem({ name: 'B', width: 1, length: 1, height: 1, quantity: 5 })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    s.addManualPlacement({
      id: 'm1', itemId: itemA.id, name: 'P', x: 0, y: 0, width: 1, length: 1,
      layers: 5, rotated: false, color: '#000',
      composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
    })

    s.updateItem(itemA.id, { maxLayers: 1 }) // A's own 2 layers must clamp down to 1; B's 3 are untouched

    const placement = useCalculator.getState().manualPlacements[0]
    expect(placement.composition).toEqual([{ itemId: itemA.id, layers: 1 }, { itemId: itemB.id, layers: 3 }])
    // Never desynced from composition's own total (1 + 3 = 4) — the exact
    // invariant violation R26-2 found (old code would have left this at 2,
    // the raw newMaxLayers value, ignoring B's 3 layers entirely).
    expect(placement.layers).toBe(4)
  })

  // Opposite direction: the old clamp's `p.itemId === id` filter never
  // fired at all when the edited item was a NON-NOMINAL constituent,
  // leaving that constituent's own physical layer count over its own new
  // limit with no enforcement whatsoever.
  it('R26-2: tightening a NON-NOMINAL constituent\'s maxLayers still clamps that constituent\'s own segment inside the composed placement', () => {
    const s = useCalculator.getState()
    s.setDeck({ clearance: 5 })
    s.addItem({ name: 'A', width: 1, length: 1, height: 1, quantity: 5 })
    s.addItem({ name: 'B', width: 1, length: 1, height: 1, quantity: 5 })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    s.addManualPlacement({
      id: 'm1', itemId: itemA.id, name: 'P', x: 0, y: 0, width: 1, length: 1,
      layers: 5, rotated: false, color: '#000',
      composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
    })

    s.updateItem(itemB.id, { maxLayers: 1 }) // B is NOT the nominal itemId (A is)

    const placement = useCalculator.getState().manualPlacements[0]
    expect(placement.composition).toEqual([{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 1 }])
    expect(placement.layers).toBe(3) // 2 + 1, never left at the stale 5
  })

  it('R26-2: tightening height (which lowers the clearance-derived cap) clamps a composed constituent\'s own segment the same way maxLayers does', () => {
    const s = useCalculator.getState()
    s.setDeck({ clearance: 4 }) // floor(4/height) layers allowed per item
    s.addItem({ name: 'A', width: 1, length: 1, height: 1, quantity: 5 }) // maxLayersFor = 4
    s.addItem({ name: 'B', width: 1, length: 1, height: 1, quantity: 5 })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    s.addManualPlacement({
      id: 'm1', itemId: itemA.id, name: 'P', x: 0, y: 0, width: 1, length: 1,
      layers: 5, rotated: false, color: '#000',
      composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
    })

    s.updateItem(itemA.id, { height: 2 }) // maxLayersFor(A) becomes floor(4/2) = 2 -- A's own 2 layers already fit exactly

    let placement = useCalculator.getState().manualPlacements[0]
    expect(placement.composition).toEqual([{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }])
    expect(placement.layers).toBe(5)

    s.updateItem(itemB.id, { height: 3 }) // maxLayersFor(B) becomes floor(4/3) = 1 -- B's own 3 layers must clamp to 1

    placement = useCalculator.getState().manualPlacements[0]
    expect(placement.composition).toEqual([{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 1 }])
    expect(placement.layers).toBe(3)
  })

  it('R26-2: tightening maxStackHeightM on a composed constituent clamps that constituent\'s own segment the same way maxLayers/height do', () => {
    const s = useCalculator.getState()
    s.setDeck({ clearance: 10 }) // generous clearance -- maxStackHeightM below is the binding constraint
    s.addItem({ name: 'A', width: 1, length: 1, height: 1, quantity: 5 })
    s.addItem({ name: 'B', width: 1, length: 1, height: 1, quantity: 5 })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    s.addManualPlacement({
      id: 'm1', itemId: itemA.id, name: 'P', x: 0, y: 0, width: 1, length: 1,
      layers: 5, rotated: false, color: '#000',
      composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
    })

    s.updateItem(itemB.id, { maxStackHeightM: 1 }) // maxLayersFor(B) becomes floor(1/1) = 1 -- B's own 3 layers must clamp to 1

    const placement = useCalculator.getState().manualPlacements[0]
    expect(placement.composition).toEqual([{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 1 }])
    expect(placement.layers).toBe(3)
  })

  // R27 height-consistency audit (requested before COMMIT GO): ManualPlacement/
  // PinnedPlacement have NO `height` field of their own to cache or desync —
  // grep-confirmed absent from both interfaces (packing.ts). A composed
  // placement's height is ALWAYS derived fresh at PlacedItem-construction
  // time, inside packingResultFromManual/packDeck, via `placementTotalHeightM`
  // (composed) or a plain catalog lookup (uncomposed) — never read from a
  // stored field on the placement, so updateItem's resyncComposed (which only
  // touches `layers`/`weight`, the two fields that ARE cached on the
  // placement) has nothing stale to leave behind for height. This test
  // proves that empirically rather than by code-reading alone: clamps a
  // BOTTOM constituent (A, composition index 0) down from 3 to 1 layers
  // underneath an untouched top constituent (B) — the exact scenario raised
  // in review — then re-derives a fresh PackingResult and confirms the
  // placed item's height reflects the NEW composition immediately, with no
  // separate step required.
  it('R27 height audit: clamping a BOTTOM composed constituent is immediately reflected in the next-computed PlacedItem.height (no stale cache)', () => {
    const s = useCalculator.getState()
    s.setDeck({ clearance: 10, width: 10, length: 10 })
    s.addItem({ name: 'A', width: 1, length: 1, height: 2, quantity: 5 })
    s.addItem({ name: 'B', width: 1, length: 1, height: 3, quantity: 5 })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    // [A3, B3]: A is the BOTTOM (first) segment. True height = 3*2 + 3*3 = 15.
    s.addManualPlacement({
      id: 'm1', itemId: itemA.id, name: 'P', x: 0, y: 0, width: 1, length: 1,
      layers: 6, rotated: false, color: '#000',
      composition: [{ itemId: itemA.id, layers: 3 }, { itemId: itemB.id, layers: 3 }],
    })

    s.updateItem(itemA.id, { maxLayers: 1 }) // A (bottom) clamps 3 -> 1; B (top) untouched

    const placement = useCalculator.getState().manualPlacements[0]
    expect(placement.composition).toEqual([{ itemId: itemA.id, layers: 1 }, { itemId: itemB.id, layers: 3 }])

    // Re-derive a fresh PackingResult exactly as the real render path does
    // (page.tsx's `trips` useMemo calls packingResultFromManual on every
    // render) — no separate "resync height" step exists or is needed.
    const result = packingResultFromManual(10, 10, useCalculator.getState().manualPlacements, 100, useCalculator.getState().items, 10)
    const placed = result.placed.find((p) => p.index === 0)!
    // New true height = 1*2 (A, clamped) + 3*3 (B, untouched) = 11 -- the
    // OLD (pre-clamp) value would have been 15. If height were ever cached
    // stale on the placement, this would still read 15/6=2.5 avg or similar
    // stale figure instead of the freshly-correct 11/4=2.75 average.
    expect(placed.height).toBeCloseTo((1 * 2 + 3 * 3) / 4, 6)
  })

  // Standalone regression: confirms the fix did not change the pre-existing,
  // already-established uncomposed clamp behavior (same scenario as the
  // maxStackHeightM test above, repeated for maxLayers directly on a
  // NON-composed placement).
  it('R26-2 regression guard: standalone placement maxLayers-tightening clamp is unchanged', () => {
    const s = useCalculator.getState()
    s.setDeck({ clearance: 5 })
    s.addItem({ name: 'Box', width: 2, length: 1, height: 1, quantity: 5 })
    const item = useCalculator.getState().items[0]
    s.addManualPlacement({
      id: 'm1', itemId: item.id, name: 'Box', x: 0, y: 0, width: 2, length: 1, layers: 5, rotated: false, color: '#000',
    })
    s.updateItem(item.id, { maxLayers: 2 })
    const placement = useCalculator.getState().manualPlacements[0]
    expect(placement.layers).toBe(2)
    expect(placement.composition).toBeUndefined()
  })

  // Regression: pinFromPlaced copied itemId/name/x/y/width/length/layers/
  // rotated/color/weight but not stabilityOverride, dropping it silently on
  // "Закрепить" even in the (currently theoretical) case a placement carries
  // its own override.
  it('carries stabilityOverride through pinFromPlaced', () => {
    const s = useCalculator.getState()
    const id = s.pinFromPlaced(0, {
      itemId: 'a', name: 'Box', x: 0, y: 0, width: 2, length: 1, layers: 1, rotated: false, color: '#000',
      stabilityOverride: { vcgAboveDeckM: 1.5 },
    })
    const pin = useCalculator.getState().pinnedPlacementsByTrip[0].find((p) => p.id === id)
    expect(pin?.stabilityOverride?.vcgAboveDeckM).toBe(1.5)
  })

  it('drops a lashing point attached to a pinned placement when that pin is removed', () => {
    const s = useCalculator.getState()
    const pinId = s.pinFromPlaced(0, { itemId: 'a', name: 'Box', x: 0, y: 0, width: 2, length: 1, layers: 1, rotated: false, color: '#000' })
    s.addLashingPoint({ x: 5, y: 5, placementId: pinId })
    s.removePinned(0, pinId)
    const points = useCalculator.getState().deck.lashingPoints
    expect(points).toHaveLength(0)
  })

  it('drops attached lashing points on clearManualPlacements but keeps points tied to live pins', () => {
    const s = useCalculator.getState()
    s.addManualPlacement({
      id: 'm1', itemId: 'a', name: 'Box', x: 0, y: 0, width: 2, length: 1, layers: 1, rotated: false, color: '#000',
    })
    const pinId = s.pinFromPlaced(0, { itemId: 'a', name: 'Box', x: 3, y: 3, width: 2, length: 1, layers: 1, rotated: false, color: '#000' })
    s.addLashingPoint({ x: 5, y: 5, placementId: 'm1' })
    s.addLashingPoint({ x: 6, y: 6, placementId: pinId })
    s.clearManualPlacements()
    const points = useCalculator.getState().deck.lashingPoints
    expect(points).toHaveLength(1)
    expect(points![0].placementId).toBe(pinId)
  })

  it('drops all attached lashing points on clearPinned() for every trip', () => {
    const s = useCalculator.getState()
    const pinId = s.pinFromPlaced(0, { itemId: 'a', name: 'Box', x: 0, y: 0, width: 2, length: 1, layers: 1, rotated: false, color: '#000' })
    s.addLashingPoint({ x: 5, y: 5, placementId: pinId })
    s.clearPinned()
    const points = useCalculator.getState().deck.lashingPoints
    expect(points).toHaveLength(0)
  })

  it('adds and removes a separation rule', () => {
    const s = useCalculator.getState()
    s.addSeparationRule({ categoryA: 'hazard', categoryB: 'standard', minDistance: 5 })
    const rules = useCalculator.getState().separationRules
    expect(rules).toHaveLength(1)
    s.removeSeparationRule(rules[0].id)
    expect(useCalculator.getState().separationRules).toHaveLength(0)
  })

  it('keeps pinned placements isolated per trip', () => {
    const s = useCalculator.getState()
    const placed = {
      itemId: 'x', name: 'Box', x: 1, y: 1, width: 1, length: 1, layers: 1, rotated: false, color: '#000',
    }
    s.pinFromPlaced(0, placed)
    s.pinFromPlaced(1, { ...placed, x: 2, y: 2 })
    const byTrip = useCalculator.getState().pinnedPlacementsByTrip
    expect(byTrip[0]).toHaveLength(1)
    expect(byTrip[1]).toHaveLength(1)

    const trip1PinId = byTrip[1][0].id
    s.updatePinned(1, trip1PinId, { x: 5, y: 5 })
    expect(useCalculator.getState().pinnedPlacementsByTrip[0][0].x).toBe(1)
    expect(useCalculator.getState().pinnedPlacementsByTrip[1][0].x).toBe(5)

    s.removePinned(1, trip1PinId)
    expect(useCalculator.getState().pinnedPlacementsByTrip[1]).toHaveLength(0)
    expect(useCalculator.getState().pinnedPlacementsByTrip[0]).toHaveLength(1)

    s.clearPinned(0)
    expect(useCalculator.getState().pinnedPlacementsByTrip[0]).toBeUndefined()
  })

  // Real-flow regression for the AUTO<->MANUAL round trip (unlike the
  // hand-constructed state above): create cargo, run the actual multi-trip
  // packer, pin its real output into two separate trips (mirroring what
  // "AUTO packed this into trip N, then the user pinned it" looks like in
  // the app), attach a lashing point to one pin and a stabilityOverride to
  // the other, then flip AUTO -> MANUAL -> AUTO and verify every field of
  // every placement survives the round trip untouched.
  it('preserves a realistic packMultiTrip-derived AUTO state across an AUTO -> MANUAL -> AUTO round trip', async () => {
    const { packMultiTrip } = await import('@/lib/packing')
    const s = useCalculator.getState()
    s.setDeck({ width: 6, length: 6, gap: 0, boardOffset: 0 })
    s.addItem({ name: 'Crate', width: 2, length: 2, quantity: 5, weight: 750 })
    const item = useCalculator.getState().items[0]

    // A 6x6 deck fits at most 9 of these 2x2 crates per trip, so 5 units
    // all fit on trip 0 in one packDeck call — force a real second trip by
    // packing in two separate quantity batches instead, one per trip.
    const trip0 = packMultiTrip(6, 6, [{ ...item, quantity: 3 }], 'area-desc', 1)[0]
    const trip1 = packMultiTrip(6, 6, [{ ...item, quantity: 2 }], 'area-desc', 1)[0]
    expect(trip0.placed.length).toBeGreaterThan(0)
    expect(trip1.placed.length).toBeGreaterThan(0)

    const pinIds0 = trip0.placed.map((p) =>
      s.pinFromPlaced(0, {
        itemId: p.itemId, name: p.name, x: p.x, y: p.y, width: p.width, length: p.length,
        layers: p.stackedCount, rotated: p.rotated, color: p.color, weight: p.weight,
      })
    )
    const pinIds1 = trip1.placed.map((p) =>
      s.pinFromPlaced(1, {
        itemId: p.itemId, name: p.name, x: p.x, y: p.y, width: p.width, length: p.length,
        layers: p.stackedCount, rotated: p.rotated, color: p.color, weight: p.weight,
      })
    )

    s.addLashingPoint({ x: 1, y: 1, placementId: pinIds0[0] })
    s.updatePinned(1, pinIds1[0], { stabilityOverride: { vcgAboveDeckM: 2.1 } })

    const snapshot = () => ({
      manual: useCalculator.getState().manualPlacements.map((m) => ({ ...m })),
      pinned: Object.fromEntries(
        Object.entries(useCalculator.getState().pinnedPlacementsByTrip).map(([trip, pins]) => [
          trip,
          pins.map((p) => ({ ...p })),
        ])
      ),
      lashingPoints: useCalculator.getState().deck.lashingPoints?.map((l) => ({ ...l })) ?? [],
    })
    const before = snapshot()
    expect(before.pinned['0']).toHaveLength(trip0.placed.length)
    expect(before.pinned['1']).toHaveLength(trip1.placed.length)
    expect(before.lashingPoints).toHaveLength(1)
    expect(before.pinned['1'].find((p) => p.id === pinIds1[0])?.stabilityOverride?.vcgAboveDeckM).toBe(2.1)

    s.setMode('manual')
    s.setMode('auto')

    const after = snapshot()
    expect(after).toEqual(before)
    // Explicit field-by-field checks per the plan, not just the deep-equal
    // above — pins the exact invariants a partial reconciliation bug would
    // most likely violate (id/itemId/quantity/weight/position/rotation
    // untouched, lashing point still attached to the right pin, override
    // still on the right pin).
    for (const trip of ['0', '1'] as const) {
      before.pinned[trip].forEach((b, i) => {
        const a = after.pinned[trip][i]
        expect(a.id).toBe(b.id)
        expect(a.itemId).toBe(b.itemId)
        expect(a.layers).toBe(b.layers)
        expect(a.weight).toBe(b.weight)
        expect(a.x).toBe(b.x)
        expect(a.y).toBe(b.y)
        expect(a.rotated).toBe(b.rotated)
        expect(a.stabilityOverride).toEqual(b.stabilityOverride)
      })
    }
    const totalPlacedLayers = Object.values(after.pinned).flat().reduce((sum, p) => sum + p.layers, 0)
    expect(totalPlacedLayers).toBe(5)
    expect(after.lashingPoints[0].placementId).toBe(pinIds0[0])
  })

  it('reflows pinned placements per trip independently when boardOffset changes', () => {
    const s = useCalculator.getState()
    s.setDeck({ width: 10, length: 10, boardOffset: 0.2, gap: 0 })
    s.pinFromPlaced(0, {
      itemId: 'x', name: 'A', x: 0.2, y: 0.2, width: 1, length: 1, layers: 1, rotated: false, color: '#000',
    })
    s.pinFromPlaced(1, {
      itemId: 'x', name: 'B', x: 0.2, y: 0.2, width: 1, length: 1, layers: 1, rotated: false, color: '#000',
    })
    s.setDeck({ boardOffset: 1 })
    const byTrip = useCalculator.getState().pinnedPlacementsByTrip
    expect(byTrip[0][0].x).toBeGreaterThanOrEqual(1)
    expect(byTrip[0][0].y).toBeGreaterThanOrEqual(1)
    expect(byTrip[1][0].x).toBeGreaterThanOrEqual(1)
    expect(byTrip[1][0].y).toBeGreaterThanOrEqual(1)
  })

  it('reflow never leaves genuinely overlapping pins after a gap increase on a dense layout', () => {
    // A single forward sweep only checks each item against the ones
    // already resolved before it — a dense, snugly-packed layout can have
    // enough simultaneous violations under a larger gap that one pass
    // can't untangle them all, leaving some pairs still overlapping.
    const s = useCalculator.getState()
    s.setDeck({ width: 10, length: 10, boardOffset: 0, gap: 0.05 })
    s.addItem({ name: 'Box', width: 1, length: 1, quantity: 1 })
    const item = useCalculator.getState().items[0]
    // Pack a tight 6x6 grid of 1x1 boxes with only 0.05 spacing — plenty of
    // pairs will violate a much larger gap simultaneously.
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 6; col++) {
        useCalculator.getState().pinFromPlaced(0, {
          itemId: item.id,
          name: 'Box',
          x: col * 1.05,
          y: row * 1.05,
          width: 1,
          length: 1,
          layers: 1,
          rotated: false,
          color: '#000',
        })
      }
    }
    useCalculator.getState().setDeck({ gap: 0.5 })
    const pins = useCalculator.getState().pinnedPlacementsByTrip[0]
    const overlaps = (a: { x: number; y: number; width: number; length: number }, b: typeof a) =>
      a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.length && a.y + a.length > b.y
    for (let i = 0; i < pins.length; i++) {
      for (let j = i + 1; j < pins.length; j++) {
        expect(overlaps(pins[i], pins[j])).toBe(false)
      }
    }
  })

  it('clamps layers down when clearance shrinks below the stacked height', () => {
    const s = useCalculator.getState()
    s.setDeck({ width: 10, length: 10, boardOffset: 0, gap: 0, clearance: 10 })
    s.addItem({ name: 'Box', width: 1, length: 1, height: 2, quantity: 5 })
    const item = useCalculator.getState().items[0]
    s.addManualPlacement({
      id: 'm1', itemId: item.id, name: 'Box', x: 0, y: 0, width: 1, length: 1, layers: 5, rotated: false, color: '#000',
    })
    // clearance 10 / height 2 = 5 layers fit; shrink clearance to 4 -> only 2 layers fit
    s.setDeck({ clearance: 4 })
    expect(useCalculator.getState().manualPlacements[0].layers).toBe(2)
  })

  it('propagates a weight change to existing placements of that item', () => {
    const s = useCalculator.getState()
    s.addItem({ name: 'Box', width: 1, length: 1, quantity: 2, weight: 100 })
    const item = useCalculator.getState().items[0]
    s.addManualPlacement({
      id: 'm1', itemId: item.id, name: 'Box', x: 0, y: 0, width: 1, length: 1, layers: 1, rotated: false, color: '#000', weight: 100,
    })
    s.pinFromPlaced(0, { itemId: item.id, name: 'Box', x: 5, y: 5, width: 1, length: 1, layers: 1, rotated: false, color: '#000', weight: 100 })
    s.updateItem(item.id, { weight: 250 })
    expect(useCalculator.getState().manualPlacements[0].weight).toBe(250)
    expect(useCalculator.getState().pinnedPlacementsByTrip[0][0].weight).toBe(250)
  })

  it('clamps existing placements down when maxLayers is tightened, without a repack', () => {
    const s = useCalculator.getState()
    s.setDeck({ width: 10, length: 10, boardOffset: 0, gap: 0, clearance: 10 })
    s.addItem({ name: 'Box', width: 1, length: 1, height: 1, quantity: 5 })
    const item = useCalculator.getState().items[0]
    s.addManualPlacement({
      id: 'm1', itemId: item.id, name: 'Box', x: 0, y: 0, width: 1, length: 1, layers: 5, rotated: false, color: '#000',
    })
    s.pinFromPlaced(0, { itemId: item.id, name: 'Box', x: 5, y: 5, width: 1, length: 1, layers: 4, rotated: false, color: '#000' })
    s.updateItem(item.id, { maxLayers: 2 })
    expect(useCalculator.getState().manualPlacements[0].layers).toBe(2)
    expect(useCalculator.getState().pinnedPlacementsByTrip[0][0].layers).toBe(2)
  })

  it('does not shrink existing placements when maxLayers is raised or unset', () => {
    const s = useCalculator.getState()
    s.setDeck({ width: 10, length: 10, boardOffset: 0, gap: 0, clearance: 10 })
    s.addItem({ name: 'Box', width: 1, length: 1, height: 1, quantity: 5, maxLayers: 2 })
    const item = useCalculator.getState().items[0]
    s.addManualPlacement({
      id: 'm1', itemId: item.id, name: 'Box', x: 0, y: 0, width: 1, length: 1, layers: 2, rotated: false, color: '#000',
    })
    s.updateItem(item.id, { maxLayers: 8 })
    expect(useCalculator.getState().manualPlacements[0].layers).toBe(2)
  })

  // Regression: updateItem applied its patch to live state as-is — only
  // normalizeProject (persistence layer) validated maxLayers/weight/quantity.
  // A NaN/negative/fractional value pushed through updateItem sat in live
  // state until the next save/reload instead of being rejected immediately.
  it('rejects invalid maxLayers/weight/quantity in the live patch instead of storing them', () => {
    const s = useCalculator.getState()
    s.addItem({ name: 'Box', width: 1, length: 1, quantity: 5, maxLayers: 3, weight: 100 })
    const item = useCalculator.getState().items[0]

    s.updateItem(item.id, { maxLayers: -5 })
    expect(useCalculator.getState().items[0].maxLayers).toBeUndefined()

    s.updateItem(item.id, { maxLayers: 3 }) // reset to a valid value for the next check
    s.updateItem(item.id, { maxLayers: NaN })
    expect(useCalculator.getState().items[0].maxLayers).toBeUndefined()

    s.updateItem(item.id, { weight: -100 })
    expect(useCalculator.getState().items[0].weight).toBeUndefined()

    s.updateItem(item.id, { quantity: -1 })
    expect(useCalculator.getState().items[0].quantity).toBe(5) // rejected -> unchanged, never undefined (required field)

    s.updateItem(item.id, { quantity: 2.7 })
    expect(useCalculator.getState().items[0].quantity).toBe(3) // valid -> rounded, same rule as normalizeProject
  })

  // Regression: reducing quantity below what's already placed (manual +
  // pinned, across every trip) used to do nothing at all — the deck kept
  // showing more units than the item now claims to have, with no
  // indication anything was wrong. Placements are deliberately NOT
  // auto-removed (that would risk destroying deliberate manual work); this
  // only covers that the mismatch is surfaced.
  it('warns (without touching placements) when quantity drops below what is already placed', () => {
    const s = useCalculator.getState()
    s.addItem({ name: 'Box', width: 1, length: 1, quantity: 10 })
    const item = useCalculator.getState().items[0]
    s.addManualPlacement({
      id: 'm1', itemId: item.id, name: 'Box', x: 0, y: 0, width: 1, length: 1, layers: 4, rotated: false, color: '#000',
    })
    s.pinFromPlaced(0, { itemId: item.id, name: 'Box', x: 5, y: 5, width: 1, length: 1, layers: 3, rotated: false, color: '#000' })
    const warnSpy = vi.spyOn(toast, 'warning')

    s.updateItem(item.id, { quantity: 5 })

    expect(warnSpy).toHaveBeenCalled()
    expect(useCalculator.getState().manualPlacements[0].layers).toBe(4)
    expect(useCalculator.getState().pinnedPlacementsByTrip[0][0].layers).toBe(3)
    expect(useCalculator.getState().items[0].quantity).toBe(5)
    warnSpy.mockRestore()
  })

  // Round 15 (quantity scanning) — P1 gate the user required before starting
  // this round: a composed placement's quantity consumption must be scanned
  // PER CONSTITUENT itemId, not just the placement's nominal itemId. Before
  // this fix, a composed [A2,B3] placement (nominal itemId=A) contributed
  // its FULL layer count (5) to A's placedCount and NOTHING to B's — this
  // pins the fix at the decrease-warning call site (updateItem in
  // calculator.ts) with the exact numbers from the review.
  it('quantity decrease-warning scans a composed placement PER CONSTITUENT itemId, not just its nominal itemId', () => {
    const s = useCalculator.getState()
    // A starts at 5 (not 2) so there's room to decrease it and actually
    // exercise the `sanitizedPatch.quantity < prevItem.quantity` guard —
    // updateItem's decrease-warning check is skipped entirely otherwise.
    // addItem always generates its own id (ignores any id in the partial),
    // so the real ids are captured right after, same pattern as this file's
    // other tests.
    s.addItem({ name: 'A', width: 1, length: 1, quantity: 5 })
    s.addItem({ name: 'B', width: 1, length: 1, quantity: 10 })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    // Composed placement: nominal itemId=A, but physically contains 2 A + 3 B.
    s.addManualPlacement({
      id: 'm1', itemId: itemA.id, name: 'A', x: 0, y: 0, width: 1, length: 1,
      layers: 5, rotated: false, color: '#000',
      composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
    })

    // B's quantity (10) has never been directly placed anywhere as its OWN
    // nominal itemId — the old `placement.itemId === id` filter would find
    // NOTHING for B and never warn, even though 3 real units of B are
    // physically inside this placement. Reducing B below 3 must still warn.
    const warnSpyB = vi.spyOn(toast, 'warning')
    s.updateItem(itemB.id, { quantity: 2 }) // only 2 left, but 3 are physically placed
    expect(warnSpyB).toHaveBeenCalled()
    warnSpyB.mockRestore()
    expect(useCalculator.getState().items.find((it) => it.id === itemB.id)?.quantity).toBe(2) // warned, not blocked — quantity edit still applies

    // A IS the nominal itemId, but the placement's FULL 5 layers must NOT
    // be attributed to A — only its own 2. Reducing A's quantity to exactly
    // 2 (== its own real consumption) must NOT warn; the old (buggy)
    // filter-and-sum-whole-placement logic would have seen placedCount=5
    // and warned incorrectly even though A itself is not over-placed.
    const warnSpyA = vi.spyOn(toast, 'warning')
    s.updateItem(itemA.id, { quantity: 2 }) // 5 -> 2, still >= A's own real consumption (2)
    expect(warnSpyA).not.toHaveBeenCalled()
    warnSpyA.mockRestore()
  })

  // R29 corrective pass: a Tier-2 malformed placement (no valid composition
  // to trust) is excluded from packing/capacity, but the decrease-warning
  // scan reads the raw store arrays directly — before this fix it still
  // phantom-counted the malformed placement's raw, untrustworthy `layers`
  // toward "already placed" (since its own itemId is very often a
  // genuinely valid one), producing a false "quantity already exceeds"
  // warning for cargo that isn't visible anywhere on the deck.
  it('quantity decrease-warning does NOT phantom-count a Tier-2 malformed placement\'s raw layers', () => {
    const s = useCalculator.getState()
    s.addItem({ name: 'A', width: 1, length: 1, quantity: 10 })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    // Malformed: invalidComposition, itemId happens to be the real 'A'.
    // Raw layers=6, but physically nothing is placed (excluded from packing).
    s.addManualPlacement({
      id: 'm1', itemId: itemA.id, name: 'Ghost', x: 0, y: 0, width: 1, length: 1,
      layers: 6, rotated: false, color: '#000',
      malformed: { invalidComposition: true, rawComposition: [{ itemId: itemA.id, layers: 6 }, { itemId: 'garbage', layers: 1 }] },
    })

    const warnSpy = vi.spyOn(toast, 'warning')
    s.updateItem(itemA.id, { quantity: 3 }) // well below the phantom 6, but nothing real is placed
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  // Regression: updateItem's weight propagation to existing placements
  // (below) used to be completely unguarded — raising an item's weight
  // after it was already placed could push the deck's total weight past
  // deck.maxDeckCargoT with zero check, silently defeating the "hard limit
  // in both AUTO and MANUAL" contract for anything already on the deck.
  it('blocks a weight increase that would push MANUAL placements over maxDeckCargoT, leaving weight and placements untouched', () => {
    const s = useCalculator.getState()
    s.setDeck({ maxDeckCargoT: 10 })
    s.addItem({ name: 'Box', width: 1, length: 1, quantity: 2, weight: 4000 })
    const item = useCalculator.getState().items[0]
    s.addManualPlacement({
      id: 'm1', itemId: item.id, name: 'Box', x: 0, y: 0, width: 1, length: 1, layers: 2, rotated: false, color: '#000', weight: 4000,
    })
    // 4000 * 2 layers = 8000kg on deck, under the 10000kg cap.
    const errorSpy = vi.spyOn(toast, 'error')

    s.updateItem(item.id, { weight: 6000 }) // 6000 * 2 = 12000kg > 10000kg cap

    expect(errorSpy).toHaveBeenCalled()
    expect(useCalculator.getState().items[0].weight).toBe(4000)
    expect(useCalculator.getState().manualPlacements[0].weight).toBe(4000)
    errorSpy.mockRestore()
  })

  it('blocks a weight increase that would push a PINNED trip over maxDeckCargoT, checking each trip independently', () => {
    const s = useCalculator.getState()
    s.setDeck({ maxDeckCargoT: 10 })
    s.addItem({ name: 'Box', width: 1, length: 1, quantity: 4, weight: 3000 })
    const item = useCalculator.getState().items[0]
    s.pinFromPlaced(0, { itemId: item.id, name: 'Box', x: 0, y: 0, width: 1, length: 1, layers: 3, rotated: false, color: '#000', weight: 3000 })
    // 3000 * 3 = 9000kg on trip 0, under the 10000kg cap.
    const errorSpy = vi.spyOn(toast, 'error')

    s.updateItem(item.id, { weight: 4000 }) // 4000 * 3 = 12000kg > 10000kg cap on trip 0

    expect(errorSpy).toHaveBeenCalled()
    expect(useCalculator.getState().items[0].weight).toBe(3000)
    expect(useCalculator.getState().pinnedPlacementsByTrip[0][0].weight).toBe(3000)
    errorSpy.mockRestore()
  })

  it('allows a weight increase that stays within maxDeckCargoT', () => {
    const s = useCalculator.getState()
    s.setDeck({ maxDeckCargoT: 10 })
    s.addItem({ name: 'Box', width: 1, length: 1, quantity: 2, weight: 1000 })
    const item = useCalculator.getState().items[0]
    s.addManualPlacement({
      id: 'm1', itemId: item.id, name: 'Box', x: 0, y: 0, width: 1, length: 1, layers: 2, rotated: false, color: '#000', weight: 1000,
    })

    s.updateItem(item.id, { weight: 2000 }) // 2000 * 2 = 4000kg, well under cap

    expect(useCalculator.getState().items[0].weight).toBe(2000)
    expect(useCalculator.getState().manualPlacements[0].weight).toBe(2000)
  })

  it('does not check maxDeckCargoT when the deck has no limit configured', () => {
    const s = useCalculator.getState()
    s.setDeck({ maxDeckCargoT: undefined })
    s.addItem({ name: 'Box', width: 1, length: 1, quantity: 1, weight: 100 })
    const item = useCalculator.getState().items[0]
    s.addManualPlacement({
      id: 'm1', itemId: item.id, name: 'Box', x: 0, y: 0, width: 1, length: 1, layers: 1, rotated: false, color: '#000', weight: 100,
    })

    s.updateItem(item.id, { weight: 999999 })

    expect(useCalculator.getState().items[0].weight).toBe(999999)
  })

  it('still applies other patch fields (e.g. width) when only the weight portion of a patch is rejected by maxDeckCargoT', () => {
    const s = useCalculator.getState()
    s.setDeck({ maxDeckCargoT: 10 })
    s.addItem({ name: 'Box', width: 1, length: 1, quantity: 1, weight: 8000 })
    const item = useCalculator.getState().items[0]
    s.addManualPlacement({
      id: 'm1', itemId: item.id, name: 'Box', x: 0, y: 0, width: 1, length: 1, layers: 1, rotated: false, color: '#000', weight: 8000,
    })
    const errorSpy = vi.spyOn(toast, 'error')

    s.updateItem(item.id, { weight: 12000, width: 2 })

    expect(errorSpy).toHaveBeenCalled()
    expect(useCalculator.getState().items[0].weight).toBe(8000) // rejected
    expect(useCalculator.getState().items[0].width).toBe(2) // still applied
    errorSpy.mockRestore()
  })

  // R27 (fixes R26-1): the maxDeckCargoT weight-edit guard used to compute
  // a composed placement's contribution via `p.itemId === id ? newWeight :
  // p.weight` — for a NON-NOMINAL constituent (id !== p.itemId), that
  // always fell back to the placement's stale cached weight, completely
  // ignoring the edit and never detecting the resulting over-capacity
  // total. This is the exact reproduction from the R26 audit report.
  it('R26-1: blocks a weight increase on a NON-NOMINAL composed constituent that would push the true composed weight over maxDeckCargoT', () => {
    const s = useCalculator.getState()
    s.setDeck({ maxDeckCargoT: 1 }) // 1000kg
    s.addItem({ name: 'A', width: 1, length: 1, quantity: 5, weight: 100 })
    s.addItem({ name: 'B', width: 1, length: 1, quantity: 5, weight: 100 })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    // P: nominal itemId = A, physically [A2, B3]. True weight = 2*100+3*100 = 500kg, under the 1000kg cap.
    s.addManualPlacement({
      id: 'm1', itemId: itemA.id, name: 'P', x: 0, y: 0, width: 1, length: 1,
      layers: 5, rotated: false, color: '#000', weight: 100,
      composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
    })
    const errorSpy = vi.spyOn(toast, 'error')

    // True new weight would be 2*100 + 3*1000 = 3200kg — over the 1000kg cap.
    s.updateItem(itemB.id, { weight: 1000 })

    expect(errorSpy).toHaveBeenCalled()
    expect(useCalculator.getState().items.find((it) => it.id === itemB.id)?.weight).toBe(100) // rejected
    expect(useCalculator.getState().manualPlacements[0].composition).toEqual([
      { itemId: itemA.id, layers: 2 },
      { itemId: itemB.id, layers: 3 },
    ])
    errorSpy.mockRestore()
  })

  // Same root cause, opposite direction: the old formula multiplied
  // newWeight by the placement's WHOLE layer count when `id` matched the
  // NOMINAL itemId, overestimating and falsely blocking an edit that keeps
  // the TRUE composed weight under the cap.
  it('R26-1: allows a weight increase on the NOMINAL composed constituent when the true composed weight stays under maxDeckCargoT', () => {
    const s = useCalculator.getState()
    s.setDeck({ maxDeckCargoT: 0.7 }) // 700kg
    s.addItem({ name: 'A', width: 1, length: 1, quantity: 5, weight: 100 })
    s.addItem({ name: 'B', width: 1, length: 1, quantity: 5, weight: 100 })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    s.addManualPlacement({
      id: 'm1', itemId: itemA.id, name: 'P', x: 0, y: 0, width: 1, length: 1,
      layers: 5, rotated: false, color: '#000', weight: 100,
      composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
    })
    const errorSpy = vi.spyOn(toast, 'error')

    // True new weight = 2*150 + 3*100 = 600kg (under 700kg, should be ALLOWED).
    // Old flat formula: 150 * 5 layers = 750kg (over 700kg) -> would have falsely blocked.
    s.updateItem(itemA.id, { weight: 150 })

    expect(errorSpy).not.toHaveBeenCalled()
    expect(useCalculator.getState().items.find((it) => it.id === itemA.id)?.weight).toBe(150)
    // Composed placement's derived mirror must reflect the true recomputed total.
    const placement = useCalculator.getState().manualPlacements[0]
    expect(placement.weight).toBeCloseTo(600 / 5, 6) // 120 kg/unit average
    expect(placement.layers).toBe(5)
    errorSpy.mockRestore()
  })

  it('R26-1: a composed placement whose true weight lands EXACTLY at maxDeckCargoT remains allowed', () => {
    const s = useCalculator.getState()
    s.setDeck({ maxDeckCargoT: 1 }) // 1000kg
    s.addItem({ name: 'A', width: 1, length: 1, quantity: 5, weight: 100 })
    s.addItem({ name: 'B', width: 1, length: 1, quantity: 5, weight: 100 })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    const itemB = useCalculator.getState().items.find((it) => it.name === 'B')!
    s.addManualPlacement({
      id: 'm1', itemId: itemA.id, name: 'P', x: 0, y: 0, width: 1, length: 1,
      layers: 5, rotated: false, color: '#000', weight: 100,
      composition: [{ itemId: itemA.id, layers: 2 }, { itemId: itemB.id, layers: 3 }],
    })
    const errorSpy = vi.spyOn(toast, 'error')

    // 2*100 + 3*(1000/3 rounded away)... use a clean number: B -> 200 => 2*100+3*200=800.
    // Pick B's new weight so total lands exactly at 1000: 2*100 + 3*x = 1000 -> x = 800/3 (not clean).
    // Use A instead: 2*x + 3*100 = 1000 -> x = 350.
    s.updateItem(itemA.id, { weight: 350 })

    expect(errorSpy).not.toHaveBeenCalled()
    expect(useCalculator.getState().items.find((it) => it.id === itemA.id)?.weight).toBe(350)
    errorSpy.mockRestore()
  })

  it('R26-1: a weight edit is rejected if it pushes ANY single pinned trip over maxDeckCargoT, but not merely because the SUM across multiple trips would exceed it', () => {
    const s = useCalculator.getState()
    s.setDeck({ maxDeckCargoT: 1 }) // 1000kg per trip
    s.addItem({ name: 'A', width: 1, length: 1, quantity: 10, weight: 100 })
    const itemA = useCalculator.getState().items.find((it) => it.name === 'A')!
    // Trip 0: 6 layers of A = 600kg. Trip 1: 6 layers of A = 600kg.
    // Aggregate (1200kg) exceeds 1000kg, but EACH trip individually (600kg) doesn't.
    s.pinFromPlaced(0, { itemId: itemA.id, name: 'A', x: 0, y: 0, width: 1, length: 1, layers: 6, rotated: false, color: '#000', weight: 100 })
    s.pinFromPlaced(1, { itemId: itemA.id, name: 'A', x: 0, y: 0, width: 1, length: 1, layers: 6, rotated: false, color: '#000', weight: 100 })
    // 150 * 6 = 900kg per trip -- under 1000kg each, must be ALLOWED despite
    // the cross-trip sum (1800kg) exceeding the cap.
    const errorSpy1 = vi.spyOn(toast, 'error')
    s.updateItem(itemA.id, { weight: 150 })
    expect(errorSpy1).not.toHaveBeenCalled()
    expect(useCalculator.getState().items.find((it) => it.id === itemA.id)?.weight).toBe(150)
    errorSpy1.mockRestore()

    // 200 * 6 = 1200kg per trip -- over 1000kg on EACH trip, must be BLOCKED.
    const errorSpy2 = vi.spyOn(toast, 'error')
    s.updateItem(itemA.id, { weight: 200 })
    expect(errorSpy2).toHaveBeenCalled()
    expect(useCalculator.getState().items.find((it) => it.id === itemA.id)?.weight).toBe(150) // unchanged from the prior successful edit
    errorSpy2.mockRestore()
  })

  it('reflows existing placements when the item width/length changes', () => {
    const s = useCalculator.getState()
    s.setDeck({ width: 10, length: 10, boardOffset: 0, gap: 0 })
    s.addItem({ name: 'Box', width: 1, length: 1, quantity: 1 })
    const item = useCalculator.getState().items[0]
    s.addManualPlacement({
      id: 'm1', itemId: item.id, name: 'Box', x: 0, y: 0, width: 1, length: 1, layers: 1, rotated: false, color: '#000',
    })
    s.updateItem(item.id, { width: 3, length: 2 })
    const mp = useCalculator.getState().manualPlacements[0]
    expect(mp.width).toBe(3)
    expect(mp.length).toBe(2)
  })

  it('does not touch unrelated placements when a different item is resized', () => {
    const s = useCalculator.getState()
    s.setDeck({ width: 10, length: 10, boardOffset: 0, gap: 0 })
    s.addItem({ name: 'A', width: 1, length: 1, quantity: 1 })
    s.addItem({ name: 'B', width: 1, length: 1, quantity: 1 })
    const [a, b] = useCalculator.getState().items
    s.addManualPlacement({ id: 'ma', itemId: a.id, name: 'A', x: 0, y: 0, width: 1, length: 1, layers: 1, rotated: false, color: '#000' })
    s.addManualPlacement({ id: 'mb', itemId: b.id, name: 'B', x: 5, y: 5, width: 1, length: 1, layers: 1, rotated: false, color: '#000' })
    s.updateItem(a.id, { width: 3 })
    const mb = useCalculator.getState().manualPlacements.find((m) => m.id === 'mb')!
    expect(mb.x).toBe(5)
    expect(mb.y).toBe(5)
    expect(mb.width).toBe(1)
  })

  it('clears selectedManualIds when the referenced item is removed', () => {
    const s = useCalculator.getState()
    s.addItem({ name: 'Box', width: 1, length: 1, quantity: 1 })
    const item = useCalculator.getState().items[0]
    s.addManualPlacement({
      id: 'm1', itemId: item.id, name: 'Box', x: 0, y: 0, width: 1, length: 1, layers: 1, rotated: false, color: '#000',
    })
    s.toggleManualSelection('m1', false)
    expect(useCalculator.getState().selectedManualIds).toEqual(['m1'])
    s.removeItem(item.id)
    expect(useCalculator.getState().selectedManualIds).toEqual([])
  })

  it('clearPinned(tripIndex) only drops selection ids that belonged to that trip', () => {
    const s = useCalculator.getState()
    s.pinFromPlaced(0, { itemId: 'x', name: 'A', x: 1, y: 1, width: 1, length: 1, layers: 1, rotated: false, color: '#000' })
    s.pinFromPlaced(1, { itemId: 'x', name: 'B', x: 2, y: 2, width: 1, length: 1, layers: 1, rotated: false, color: '#000' })
    const trip0PinId = useCalculator.getState().pinnedPlacementsByTrip[0][0].id
    const trip1PinId = useCalculator.getState().pinnedPlacementsByTrip[1][0].id
    s.togglePinSelection(trip0PinId, false)
    s.togglePinSelection(trip1PinId, true)
    expect(useCalculator.getState().selectedPinIds).toEqual(expect.arrayContaining([trip0PinId, trip1PinId]))

    s.clearPinned(1)
    expect(useCalculator.getState().selectedPinIds).toEqual([trip0PinId])
  })
})

describe('calculator store undo/redo history', () => {
  beforeEach(() => {
    useCalculator.setState({
      deck: { width: 20, length: 8, unit: 'm', gap: 0.1, boardOffset: 0.2, clearance: 0 },
      items: [],
      separationRules: [],
      sortStrategy: 'area-desc',
      globalRotation: true,
      showFreeSpace: true,
      showGrid: true,
      showLabels: true,
      mode: 'auto',
      manualPlacements: [],
      pinnedPlacementsByTrip: {},
      selectedPinIds: [],
      selectedManualIds: [],
      activeStampId: null,
      stampRotated: false,
    })
    clearCalculatorHistory()
  })

  // handleSet is debounced 400ms (see calculator.ts) so a drag's rapid
  // updates collapse into one history step - tests need to wait past that
  // window before checking pastStates.
  const waitForHistoryFlush = () => new Promise((r) => setTimeout(r, 500))

  it('undo/redo restores and re-applies an addItem', async () => {
    useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, quantity: 1 })
    await waitForHistoryFlush()
    expect(useCalculator.getState().items).toHaveLength(1)
    expect(useCalculator.temporal.getState().pastStates.length).toBeGreaterThan(0)

    useCalculator.temporal.getState().undo()
    expect(useCalculator.getState().items).toHaveLength(0)

    useCalculator.temporal.getState().redo()
    expect(useCalculator.getState().items).toHaveLength(1)
  })

  it('undo after a simulated drag (many rapid updates) restores the position from BEFORE the drag, not an intermediate tick (regression)', async () => {
    const pinId = useCalculator.getState().pinFromPlaced(0, {
      itemId: 'x', name: 'A', x: 1, y: 1, width: 1, length: 1, layers: 1, rotated: false, color: '#000',
    })
    await waitForHistoryFlush()
    expect(useCalculator.temporal.getState().pastStates.length).toBe(1)

    // Simulate a drag: many rapid position updates, each well inside the
    // 400ms debounce window (DeckVisualization throttles real drag commits
    // to ~50ms). The old bug: handleSet re-captured `pastState` from every
    // call, so the eventually-recorded snapshot was the position one tick
    // before the LAST update, not the position before the FIRST one -
    // undo only rewound a fraction of the drag instead of the whole thing.
    for (const x of [1.2, 1.5, 1.8, 2.4, 3.0]) {
      useCalculator.getState().updatePinned(0, pinId, { x })
      await new Promise((r) => setTimeout(r, 50))
    }
    expect(useCalculator.getState().pinnedPlacementsByTrip[0][0].x).toBe(3.0)
    await waitForHistoryFlush()

    useCalculator.temporal.getState().undo()
    expect(useCalculator.getState().pinnedPlacementsByTrip[0][0].x).toBe(1)
  })

  it('clearCalculatorHistory cancels a pending debounced snapshot instead of letting it land later', async () => {
    useCalculator.getState().addItem({ name: 'Box', width: 2, length: 1, quantity: 1 })
    // clear() immediately after a mutation, before the 400ms debounce fires -
    // the old bug: the pending snapshot from the mutation above would still
    // land in history ~400ms later despite the clear() call.
    clearCalculatorHistory()
    await waitForHistoryFlush()
    expect(useCalculator.temporal.getState().pastStates).toHaveLength(0)
  })
})
