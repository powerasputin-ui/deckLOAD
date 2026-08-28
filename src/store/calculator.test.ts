import { describe, it, expect, beforeEach } from 'vitest'
import { useCalculator, clearCalculatorHistory, roundForDisplay } from './calculator'

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
