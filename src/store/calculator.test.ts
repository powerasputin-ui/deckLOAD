import { describe, it, expect, beforeEach } from 'vitest'
import { useCalculator, clearCalculatorHistory } from './calculator'

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

  it('round-trips meters to feet and back without drift', () => {
    const s = useCalculator.getState()
    s.setDeck({ width: 20, length: 8 })
    s.setUnit('ft')
    s.setUnit('m')
    const deck = useCalculator.getState().deck
    expect(deck.width).toBeCloseTo(20, 6)
    expect(deck.length).toBeCloseTo(8, 6)
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
