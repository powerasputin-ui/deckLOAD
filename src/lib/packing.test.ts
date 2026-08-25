import { describe, it, expect } from 'vitest'
import {
  packDeck,
  packDeckVariants,
  packMultiTrip,
  computeFreeRects,
  packingResultFromManual,
  maxLayersFor,
  collidesWith,
  withClearanceFootprint,
  collidesWithClearance,
  clampToDeck,
  rotatePlacement,
  rotatePlacementAnywhere,
  resolveSnappedDragPosition,
  checkZoneLoads,
  zoneAreaWithinOutline,
  zoneIdsOverlapping,
  checkLashingBalance,
  violatesSeparation,
  rotateOutline90,
  polygonsOverlap,
  collidesPrecisely,
  worldPolygon,
  lashingPointExclusionRects,
  polygonArea,
  nearestPointOnPolygon,
  rectInsidePolygon,
  deckOutlineExclusionRects,
  polygonInsideRects,
  restrictionZonePolygon,
  restrictionZoneExclusions,
  erodePolygon,
  dedupePolygonVertices,
  DEFAULT_VESSEL_MOTION,
  VESSEL_MOTION_PRESETS,
  type CargoItem,
  type ManualPlacement,
  type PinnedPlacement,
  type LoadZone,
  type SeparationRule,
  type LashingPoint,
} from './packing'

function item(partial: Partial<CargoItem> & { id: string }): CargoItem {
  return {
    name: 'Груз',
    width: 1,
    length: 1,
    height: 0,
    quantity: 1,
    color: '#0ea5e9',
    allowRotation: true,
    ...partial,
  }
}

describe('maxLayersFor', () => {
  it('returns 1 when clearance is zero', () => {
    expect(maxLayersFor({ height: 1 }, 0)).toBe(1)
  })

  it('returns 1 when height is zero', () => {
    expect(maxLayersFor({ height: 0 }, 5)).toBe(1)
  })

  it('returns 1 for negative values', () => {
    expect(maxLayersFor({ height: -1 }, 5)).toBe(1)
    expect(maxLayersFor({ height: 1 }, -5)).toBe(1)
  })

  it('calculates layers for exact fit', () => {
    expect(maxLayersFor({ height: 1.5 }, 4.5)).toBe(3)
  })

  it('floors fractional fit', () => {
    expect(maxLayersFor({ height: 1.5 }, 5)).toBe(3)
  })

  it('handles very small height gracefully', () => {
    expect(maxLayersFor({ height: 1e-12 }, 1)).toBeGreaterThan(1)
  })

  it('does not return Infinity for tiny heights', () => {
    const layers = maxLayersFor({ height: 1e-12 }, 1)
    expect(Number.isFinite(layers)).toBe(true)
  })

  it('handles NaN input', () => {
    expect(maxLayersFor({ height: NaN }, 5)).toBe(1)
    expect(maxLayersFor({ height: 1 }, NaN)).toBe(1)
  })

  it('handles Infinity input', () => {
    expect(maxLayersFor({ height: Infinity }, 5)).toBe(1)
    expect(maxLayersFor({ height: 1 }, Infinity)).toBe(1)
  })
})

describe('packDeck', () => {
  it('returns empty result for zero deck', () => {
    const res = packDeck(0, 0, [item({ id: 'a', width: 1, length: 1 })])
    expect(res.placed).toHaveLength(0)
    expect(res.utilization).toBe(0)
    expect(res.requestedCount).toBe(1)
  })

  it('returns empty result for NaN deck dimensions', () => {
    const res = packDeck(NaN, NaN, [item({ id: 'a', width: 1, length: 1 })])
    expect(res.placed).toHaveLength(0)
    expect(res.utilization).toBe(0)
  })

  it('places a single item', () => {
    const res = packDeck(10, 10, [item({ id: 'a', width: 2, length: 3 })])
    expect(res.placed).toHaveLength(1)
    expect(res.placedCount).toBe(1)
    expect(res.utilization).toBeCloseTo(0.06)
  })

  it('places multiple units as one stack when clearance allows', () => {
    const res = packDeck(10, 10, [
      item({ id: 'a', width: 2, length: 2, height: 1, quantity: 5 }),
    ], { clearance: 10 })
    // Since clearance >= total height, all 5 units stack in one footprint
    expect(res.placedCount).toBe(5)
    expect(res.placed).toHaveLength(1)
  })

  it('splits units into multiple stacks when clearance limits layers', () => {
    const res = packDeck(10, 10, [
      item({ id: 'a', width: 2, length: 2, height: 2, quantity: 6 }),
    ], { clearance: 4 })
    // maxLayers = 2, so 6 units need 3 stacks
    expect(res.placed).toHaveLength(3)
    expect(res.placedCount).toBe(6)
  })

  it('marks oversized items as unplaced', () => {
    const res = packDeck(2, 2, [item({ id: 'a', width: 5, length: 5 })])
    expect(res.placed).toHaveLength(0)
    expect(res.unplaced).toHaveLength(1)
    expect(res.unplaced[0].reason).toContain('Превышает размеры палубы')
  })

  it('reports all unplaced reasons per item', () => {
    const items = [
      item({ id: 'big', width: 100, length: 100, quantity: 1 }),
      item({ id: 'many', width: 3, length: 3, quantity: 100 }),
    ]
    const res = packDeck(10, 10, items)
    const big = res.unplaced.find((u) => u.itemId === 'big')
    const many = res.unplaced.find((u) => u.itemId === 'many')
    expect(big).toBeDefined()
    expect(big!.reason).toContain('Превышает размеры палубы')
    expect(many).toBeDefined()
    expect(many!.reason).toMatch(/Недостаточно свободного места|Не вместилось/)
  })

  it('respects allowRotation=false', () => {
    const res = packDeck(3, 2, [
      item({ id: 'a', width: 2.5, length: 1.5, allowRotation: false }),
    ])
    // Fits without rotation; should place
    expect(res.placed).toHaveLength(1)
  })

  it('rotates item when needed and allowed', () => {
    const res = packDeck(2, 3, [
      item({ id: 'a', width: 2.5, length: 1.5, allowRotation: true }),
    ])
    expect(res.placed).toHaveLength(1)
    expect(res.placed[0].rotated).toBe(true)
  })

  it('respects board offset', () => {
    const res = packDeck(10, 10, [item({ id: 'a', width: 8, length: 8 })], {
      boardOffset: 1,
    })
    // Item placed with margin
    expect(res.placed[0].x).toBeGreaterThanOrEqual(1)
    expect(res.placed[0].y).toBeGreaterThanOrEqual(1)
  })

  it('respects gap between items', () => {
    const res = packDeck(6, 3, [
      item({ id: 'a', width: 2, length: 1.8, quantity: 2 }),
    ], { gap: 0.5 })
    // 2 cells: 2.5 x 2.3 fit side-by-side in 6 x 3
    expect(res.placed).toHaveLength(2)
  })

  it('respects pinned placements', () => {
    const pin: PinnedPlacement = {
      id: 'p1',
      itemId: 'a',
      name: 'Груз',
      x: 1,
      y: 1,
      width: 2,
      length: 2,
      layers: 1,
      rotated: false,
      color: '#0ea5e9',
    }
    const res = packDeck(10, 10, [item({ id: 'a', width: 2, length: 2, quantity: 3 })], {
      pinned: [pin],
    })
    expect(res.placed.some((p) => p.x === 1 && p.y === 1)).toBe(true)
    expect(res.placedCount).toBe(3)
  })

  it('reserves a pinned clearance margin so auto-placed cargo stays out of it', () => {
    const pin: PinnedPlacement = {
      id: 'p1',
      itemId: 'a',
      name: 'Груз',
      x: 1,
      y: 1,
      width: 2,
      length: 2,
      layers: 1,
      rotated: false,
      color: '#0ea5e9',
      clearanceMargin: { top: 1, right: 1, bottom: 1, left: 1 }, // reserves roughly (0,0)-(4,4)
    }
    const res = packDeck(10, 10, [item({ id: 'a', width: 2, length: 2, quantity: 4 })], {
      gap: 0,
      pinned: [pin],
    })
    expect(res.placedCount).toBe(4) // all fit on a 10x10 deck even with the margin excluded
    for (const p of res.placed) {
      if (p.x === pin.x && p.y === pin.y) continue // the pin itself
      const intrudesMargin = p.x < 4 && p.y < 4
      expect(intrudesMargin).toBe(false)
    }
  })

  it('rejects pinned placement outside deck', () => {
    const pin: PinnedPlacement = {
      id: 'p1',
      itemId: 'a',
      name: 'Груз',
      x: 100,
      y: 100,
      width: 2,
      length: 2,
      layers: 1,
      rotated: false,
      color: '#0ea5e9',
    }
    const res = packDeck(10, 10, [item({ id: 'a', width: 2, length: 2, quantity: 2 })], {
      pinned: [pin],
    })
    expect(res.unplaced.some((u) => u.reason.includes('вне палубы'))).toBe(true)
    expect(res.placedCount).toBe(2) // Still places remaining units
  })

  // Regression (real-world user report, two rounds): first a 1.5x2m box
  // flush-pinned against a slanted cut-corner edge got rejected as "outside
  // deck" on the next repack. A follow-up fix (relaxing pin validation to a
  // fixed boardOffset-gap/2 tolerance) turned out to only paper over the
  // symptom -- a much wider 6.06x2.44m container along the exact same edge
  // still failed, because the true gap between the packer's own placement
  // and the strict boundary scales with an item's own size along a slanted
  // edge, not a fixed few cm. The real fix is upstream: the auto-packer's
  // free-cell search itself now excludes area using the FULL, strict
  // boardOffset erosion (not a permissive one), so it can no longer choose
  // a cell that ends up outside the true usable area in the first place --
  // for cargo of any size. Reproduces with the user's exact outline and
  // item mix (3 boxes + 4 containers), letting packDeck place everything
  // itself from scratch (not pre-set pin positions, since the point is the
  // packer never generates an invalid position to begin with).
  it('the auto-packer never places cargo outside the true (strict) usable outline, for items of any size (real-world regression)', () => {
    const outline = [
      { x: 0, y: 0 },
      { x: 14.106982655502394, y: 0.12440191387559782 },
      { x: 17.623729066985646, y: 2.2535885167464116 },
      { x: 20, y: 5.076555023923445 },
      { x: 17.575882177033495, y: 6.392344497607656 },
      { x: 14.537604665071772, y: 6.84688995215311 },
      { x: 0, y: 8 },
    ]
    const boardOffset = 0.2
    const items = [
      item({ id: 'box', name: 'Ящик L', width: 2, length: 1.5, quantity: 3 }),
      item({ id: 'container', name: 'Контейнер 20ft', width: 6.06, length: 2.44, quantity: 4 }),
    ]
    const usableOutline = erodePolygon(outline, boardOffset)
    for (const sortStrategy of ['area-desc', 'area-asc', 'width-desc', 'length-desc', 'quantity-desc', 'none'] as const) {
      const res = packDeck(20, 8, items, { gap: 0.1, boardOffset, outline, sortStrategy })
      expect(res.unplaced).toHaveLength(0)
      for (const p of res.placed) {
        expect(rectInsidePolygon(p, usableOutline)).toBe(true)
      }
    }
  })

  it('still rejects a pin genuinely outside the deck outline, even a strict boundary check (fix does not make validation toothless)', () => {
    // Same slanted outline as above, but this pin sits well into the
    // excluded cut-off corner -- nowhere close to a boundary hair.
    const outline = [
      { x: 0, y: 0 },
      { x: 14.106982655502394, y: 0.12440191387559782 },
      { x: 17.623729066985646, y: 2.2535885167464116 },
      { x: 20, y: 5.076555023923445 },
      { x: 17.575882177033495, y: 6.392344497607656 },
      { x: 14.537604665071772, y: 6.84688995215311 },
      { x: 0, y: 8 },
    ]
    const pin: PinnedPlacement = {
      id: 'p1', itemId: 'box', name: 'Ящик L', x: 18, y: 0.3, width: 1.5, length: 2, layers: 1, rotated: true, color: '#06b6d4',
    }
    const res = packDeck(20, 8, [item({ id: 'box', width: 2, length: 1.5, quantity: 1 })], {
      gap: 0.1,
      boardOffset: 0.2,
      pinned: [pin],
      outline,
    })
    expect(res.unplaced.some((u) => u.reason.includes('вне палубы'))).toBe(true)
  })

  it('does not let NaN quantities poison aggregates', () => {
    const res = packDeck(10, 10, [
      item({ id: 'a', width: 1, length: 1, quantity: NaN }),
      item({ id: 'b', width: 1, length: 1, quantity: 2 }),
    ])
    expect(Number.isFinite(res.requestedCount)).toBe(true)
    expect(Number.isFinite(res.placedCount)).toBe(true)
  })

  it('treats quantity 0 as "none requested", not as invalid input', () => {
    const res = packDeck(10, 10, [
      item({ id: 'a', width: 1, length: 1, quantity: 0 }),
      item({ id: 'b', width: 1, length: 1, quantity: 2 }),
    ])
    expect(res.placed.some((p) => p.itemId === 'a')).toBe(false)
    const aBreakdown = res.breakdown.find((b) => b.itemId === 'a')
    expect(aBreakdown === undefined || aBreakdown.requested === 0).toBe(true)
    expect(res.placedCount).toBe(2)
    expect(res.requestedCount).toBe(2)
  })

  it('still falls back to 1 for NaN/undefined quantity, and clamps negative to 0', () => {
    const res = packDeck(10, 10, [
      item({ id: 'a', width: 1, length: 1, quantity: NaN }),
      item({ id: 'b', width: 1, length: 1, quantity: -5 }),
    ])
    expect(res.placed.filter((p) => p.itemId === 'a')).toHaveLength(1)
    expect(res.placed.some((p) => p.itemId === 'b')).toBe(false)
  })

  it('does not let NaN dimensions poison aggregates', () => {
    const res = packDeck(10, 10, [item({ id: 'a', width: NaN, length: NaN })])
    expect(Number.isFinite(res.usedArea)).toBe(true)
    expect(Number.isFinite(res.utilization)).toBe(true)
  })

  it('computes total weight correctly', () => {
    const res = packDeck(10, 10, [
      item({ id: 'a', width: 2, length: 2, quantity: 3, weight: 100 }),
    ])
    expect(res.totalWeight).toBe(300)
  })

  it('keeps the real edge margin exactly at boardOffset regardless of gap', () => {
    const res = packDeck(10, 10, [
      item({ id: 'a', width: 2, length: 2, quantity: 1 }),
    ], { boardOffset: 0.5, gap: 0.3 })
    expect(res.placed[0].x).toBeCloseTo(0.5, 9)
    expect(res.placed[0].y).toBeCloseTo(0.5, 9)
  })

  it('keeps board offset, gap, and clearance/stacking all working together on a non-rectangular deck', () => {
    // A 10x10 deck with the top-right corner cut off, well past x=6/y=6.
    const outline = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 6, y: 6 }, { x: 6, y: 10 }, { x: 0, y: 10 },
    ]
    const res = packDeck(10, 10, [item({ id: 'a', width: 2, length: 2, quantity: 3, height: 1 })], {
      boardOffset: 0.5,
      gap: 0.5,
      clearance: 5, // >= 3 units * 1m height -> all 3 stack in one footprint
      outline,
    })
    expect(res.placed).toHaveLength(1)
    const p = res.placed[0]
    // Board offset applies on the deck's straight edges via the same
    // outline-exclusion path used for slanted ones, so it also picks up
    // the same flat "+gap/2" inter-item spacing shift every placed cell
    // gets (see packDeck's comment on usableOutline/deckOutlineExclusionRects)
    // -- a deliberate, documented trade of a bit of packing density right at
    // a cut edge for never placing cargo outside the true usable area,
    // confirmed safe by the real-world regression test above.
    expect(p.x).toBeCloseTo(0.75, 9)
    expect(p.y).toBeCloseTo(0.75, 9)
    // Clearance/stacking is unaffected by the outline — all 3 units stack.
    expect(p.stackedCount).toBe(3)
    // True (shoelace) area is reported, not the plain bounding-box area.
    expect(res.totalArea).toBeCloseTo(polygonArea(outline))
  })

  it('still enforces gap between two pinned placements on a non-rectangular deck', () => {
    const outline = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 6, y: 6 }, { x: 6, y: 10 }, { x: 0, y: 10 },
    ]
    const pinA: PinnedPlacement = {
      id: 'p1', itemId: 'a', name: 'A', x: 0, y: 0, width: 2, length: 2, layers: 1, rotated: false, color: '#0ea5e9',
    }
    const tooClose: PinnedPlacement = {
      id: 'p2', itemId: 'a', name: 'B', x: 2.05, y: 0, width: 2, length: 2, layers: 1, rotated: false, color: '#0ea5e9',
    }
    const res = packDeck(10, 10, [item({ id: 'a', width: 2, length: 2, quantity: 2 })], {
      gap: 0.5,
      outline,
      pinned: [pinA, tooClose],
    })
    expect(res.unplaced.some((u) => u.reason.includes('пересекается'))).toBe(true)
  })

  it('rejects two pinned placements closer than the configured gap', () => {
    const pinA: PinnedPlacement = {
      id: 'p1', itemId: 'a', name: 'A', x: 0, y: 0, width: 2, length: 2, layers: 1, rotated: false, color: '#0ea5e9',
    }
    const pinB: PinnedPlacement = {
      id: 'p2', itemId: 'a', name: 'B', x: 2.05, y: 0, width: 2, length: 2, layers: 1, rotated: false, color: '#0ea5e9',
    }
    const res = packDeck(10, 10, [item({ id: 'a', width: 2, length: 2, quantity: 2 })], {
      gap: 0.5,
      pinned: [pinA, pinB],
    })
    // pinB is rejected as too close to pinA (its unit is re-packed elsewhere
    // by the normal packer instead of vanishing), but no placement should
    // ever sit at pinB's rejected, too-close position.
    expect(res.unplaced.some((u) => u.reason.includes('пересекается'))).toBe(true)
    expect(res.placed.some((p) => p.x === pinB.x && p.y === pinB.y)).toBe(false)
  })

  it('accepts two pinned placements at least the configured gap apart', () => {
    const pinA: PinnedPlacement = {
      id: 'p1', itemId: 'a', name: 'A', x: 0, y: 0, width: 2, length: 2, layers: 1, rotated: false, color: '#0ea5e9',
    }
    const pinB: PinnedPlacement = {
      id: 'p2', itemId: 'a', name: 'B', x: 2.5, y: 0, width: 2, length: 2, layers: 1, rotated: false, color: '#0ea5e9',
    }
    const res = packDeck(10, 10, [item({ id: 'a', width: 2, length: 2, quantity: 2 })], {
      gap: 0.5,
      pinned: [pinA, pinB],
    })
    expect(res.placed.filter((p) => p.itemId === 'a').length).toBe(2)
    expect(res.unplaced).toHaveLength(0)
  })

  it('breakdown weight matches totalWeight even when a pin overrides its weight', () => {
    const pin: PinnedPlacement = {
      id: 'p1', itemId: 'a', name: 'A', x: 0, y: 0, width: 2, length: 2, layers: 1, rotated: false, color: '#0ea5e9', weight: 999,
    }
    const res = packDeck(10, 10, [item({ id: 'a', width: 2, length: 2, quantity: 1, weight: 100 })], {
      pinned: [pin],
    })
    expect(res.totalWeight).toBe(999)
    const bd = res.breakdown.find((b) => b.itemId === 'a')
    expect(bd!.weight).toBe(999)
  })

  // Regression: this is the mechanism handleAutoRedistribute now relies on
  // to keep a clearance-zoned placement fixed in place through a full
  // redistribute — passing it as `pinned` must both preserve its exact
  // position/margin AND actually exclude other cargo from its zone.
  it('a clearance-zoned pin keeps its exact position and margin, and excludes other cargo from its zone', () => {
    const zonedPin: PinnedPlacement = {
      id: 'p1', itemId: 'a', name: 'A', x: 5, y: 5, width: 1, length: 1,
      layers: 1, rotated: false, color: '#000',
      clearanceMargin: { top: 1, right: 1, bottom: 1, left: 1 },
    }
    const res = packDeck(20, 20, [
      item({ id: 'a', width: 1, length: 1, quantity: 1 }),
      item({ id: 'b', width: 1, length: 1, quantity: 5 }),
    ], { pinned: [zonedPin], gap: 0.1 })
    const placedA = res.placed.find((p) => p.itemId === 'a')
    expect(placedA?.x).toBe(5)
    expect(placedA?.y).toBe(5)
    expect(placedA?.clearanceMargin).toEqual(zonedPin.clearanceMargin)
    // No 'b' placement should land inside A's inflated exclusion rect [4,7]x[4,7].
    const anyInsideZone = res.placed.some(
      (p) => p.itemId === 'b' && p.x < 7 && p.x + p.width > 4 && p.y < 7 && p.y + p.length > 4
    )
    expect(anyInsideZone).toBe(false)
  })
})

describe('computeFreeRects', () => {
  // Regression: the green free-space overlay only inflated by the flat gap,
  // never by clearanceMargin — showing a zoned-off area as free even though
  // packDeck itself refuses to place anything there. Must agree with it.
  it('excludes the margin-inflated area around a zoned placement, not just the gap-inflated one', () => {
    const zonedPin: PinnedPlacement = {
      id: 'p1', itemId: 'a', name: 'A', x: 5, y: 5, width: 1, length: 1,
      layers: 1, rotated: false, color: '#000',
      clearanceMargin: { top: 1, right: 1, bottom: 1, left: 1 },
    }
    const res = packDeck(20, 20, [item({ id: 'a', width: 1, length: 1, quantity: 1 })], {
      pinned: [zonedPin],
      gap: 0.1,
    })
    const free = computeFreeRects(20, 20, res.placed, 0.1, 0)
    // A point just inside the margin (e.g. (4.5, 5.5), 0.5m left of the item)
    // must not be reported as free.
    const coversPoint = (x: number, y: number) =>
      free.some((r) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height)
    expect(coversPoint(4.5, 5.5)).toBe(false)
    // Well outside the margin should still be free.
    expect(coversPoint(15, 15)).toBe(true)
  })
})

describe('packDeckVariants', () => {
  it('is deterministic with fixed seed', () => {
    const items = [item({ id: 'a', width: 3, length: 2, quantity: 4 })]
    const opts = { gap: 0.1, boardOffset: 0.2, clearance: 0 }
    const a = packDeckVariants(10, 10, items, opts, 3, 12345)
    const b = packDeckVariants(10, 10, items, opts, 3, 12345)
    expect(a.map((v) => v.utilizationPct)).toEqual(b.map((v) => v.utilizationPct))
  })

  it('sorts variants by utilization descending', () => {
    const items = [
      item({ id: 'a', width: 5, length: 5, quantity: 1 }),
      item({ id: 'b', width: 1, length: 1, quantity: 20 }),
    ]
    const variants = packDeckVariants(10, 10, items, {}, 3)
    for (let i = 1; i < variants.length; i++) {
      expect(variants[i - 1]._utilization ?? variants[i - 1].utilizationPct)
        .toBeGreaterThanOrEqual(variants[i]._utilization ?? variants[i].utilizationPct)
    }
  })

  it('respects pinned placements passed through options', () => {
    const items = [
      item({ id: 'a', width: 2, length: 2, quantity: 4 }),
      item({ id: 'b', width: 1, length: 1, quantity: 10 }),
    ]
    const pinned: PinnedPlacement[] = [
      { id: 'p1', itemId: 'a', name: 'A', x: 0, y: 0, width: 2, length: 2, layers: 1, rotated: false, color: '#0ea5e9' },
    ]
    const variants = packDeckVariants(10, 10, items, { pinned }, 3)
    expect(variants.length).toBeGreaterThan(0)
    for (const v of variants) {
      const pinnedPlaced = v.result.placed.find((p) => p.itemId === 'a' && p.x === 0 && p.y === 0)
      expect(pinnedPlaced).toBeDefined()
      expect(v.result.placedCount).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('packingResultFromManual', () => {
  it('computes aggregates from manual placements', () => {
    const placements: ManualPlacement[] = [
      { id: 'm1', itemId: 'a', name: 'A', x: 0, y: 0, width: 2, length: 3, layers: 2, rotated: false, color: '#0ea5e9', weight: 100 },
      { id: 'm2', itemId: 'a', name: 'A', x: 3, y: 0, width: 2, length: 3, layers: 1, rotated: false, color: '#0ea5e9', weight: 100 },
    ]
    const res = packingResultFromManual(10, 10, placements, 5, [
      { id: 'a', name: 'A', width: 2, length: 3, height: 1, quantity: 5, color: '#0ea5e9', allowRotation: true, weight: 100 },
    ])
    expect(res.placedCount).toBe(3)
    expect(res.usedArea).toBe(12)
    expect(res.totalWeight).toBe(300)
    expect(res.utilization).toBeCloseTo(0.12)
  })

  it('coerces invalid layer counts to 1', () => {
    const placements: ManualPlacement[] = [
      { id: 'm1', itemId: 'a', name: 'A', x: 0, y: 0, width: 1, length: 1, layers: NaN, rotated: false, color: '#0ea5e9' },
    ]
    const res = packingResultFromManual(10, 10, placements, 1)
    expect(res.placedCount).toBe(1)
    expect(res.placed[0].layers).toBe(1)
  })

  it('handles empty placements', () => {
    const res = packingResultFromManual(10, 10, [], 0)
    expect(res.placed).toHaveLength(0)
    expect(res.utilization).toBe(0)
  })

  it('reports a shortfall as unplaced when fewer units are placed than requested', () => {
    const placements: ManualPlacement[] = [
      { id: 'm1', itemId: 'a', name: 'A', x: 0, y: 0, width: 2, length: 3, layers: 1, rotated: false, color: '#0ea5e9' },
    ]
    const res = packingResultFromManual(10, 10, placements, 5, [
      { id: 'a', name: 'A', width: 2, length: 3, height: 1, quantity: 5, color: '#0ea5e9', allowRotation: true },
    ])
    expect(res.unplaced).toHaveLength(1)
    expect(res.unplaced[0]).toMatchObject({ itemId: 'a', name: 'A' })
    expect(res.unplaced[0].reason).toContain('4')
  })

  it('reports no unplaced entry once every requested unit is placed', () => {
    const placements: ManualPlacement[] = [
      { id: 'm1', itemId: 'a', name: 'A', x: 0, y: 0, width: 2, length: 3, layers: 2, rotated: false, color: '#0ea5e9' },
    ]
    const res = packingResultFromManual(10, 10, placements, 2, [
      { id: 'a', name: 'A', width: 2, length: 3, height: 1, quantity: 2, color: '#0ea5e9', allowRotation: true },
    ])
    expect(res.unplaced).toHaveLength(0)
  })

  it('reports an unplaced entry for an item with zero placements', () => {
    const res = packingResultFromManual(10, 10, [], 3, [
      { id: 'a', name: 'A', width: 2, length: 3, height: 1, quantity: 3, color: '#0ea5e9', allowRotation: true },
    ])
    expect(res.unplaced).toHaveLength(1)
    expect(res.unplaced[0].reason).toContain('3')
  })
})

describe('collidesWith', () => {
  it('detects overlap', () => {
    expect(collidesWith({ x: 0, y: 0, width: 2, length: 2 }, [{ x: 1, y: 1, width: 2, length: 2 }])).toBe(true)
  })

  it('returns false for separated rectangles', () => {
    expect(collidesWith({ x: 0, y: 0, width: 1, length: 1 }, [{ x: 2, y: 2, width: 1, length: 1 }])).toBe(false)
  })

  it('respects gap', () => {
    // With gap 1 each cell is 2 units wide. Two 1x1 items centred at x=0 and x=2
    // have cells [-1,1] and [1,3] — they touch at x=1 but do not overlap.
    expect(collidesWith({ x: 0, y: 0, width: 1, length: 1 }, [{ x: 2, y: 0, width: 1, length: 1 }], 1)).toBe(false)
    expect(collidesWith({ x: 0, y: 0, width: 1, length: 1 }, [{ x: 1.4, y: 0, width: 1, length: 1 }], 1)).toBe(true)
  })
})

describe('withClearanceFootprint', () => {
  it('returns the footprint unchanged when no margin is set', () => {
    const p = { x: 1, y: 1, width: 2, length: 2 }
    expect(withClearanceFootprint(p)).toEqual(p)
  })

  it('inflates the footprint per side by the margin', () => {
    const p = { x: 1, y: 1, width: 2, length: 2, clearanceMargin: { top: 0.5, right: 1, bottom: 0.25, left: 2 } }
    expect(withClearanceFootprint(p)).toEqual({ x: -1, y: 0.5, width: 5, length: 2.75 })
  })

  it('makes collidesWith reject placements inside the exclusion zone', () => {
    const guarded = { x: 5, y: 5, width: 1, length: 1, clearanceMargin: { top: 1, right: 1, bottom: 1, left: 1 } }
    // 0.5m away from the guarded item's edge — inside its 1m margin.
    const nearby = { x: 6.5, y: 5, width: 1, length: 1 }
    expect(collidesWith(nearby, [withClearanceFootprint(guarded)])).toBe(true)
    // Far enough outside the 1m margin.
    const farAway = { x: 8, y: 5, width: 1, length: 1 }
    expect(collidesWith(farAway, [withClearanceFootprint(guarded)])).toBe(false)
  })
})

describe('collidesWithClearance', () => {
  // Regression: withClearanceFootprint on its own only inflates whichever
  // side appears in `others` — a bare collidesPrecisely(target, others.map
  // (withClearanceFootprint)) call blocks a plain item from entering a
  // zoned neighbour's margin, but never stops the ZONED item itself from
  // being moved right up against a plain neighbour, since nothing ever
  // inflated `target` by its own margin. collidesWithClearance must reject
  // in both directions.
  const zoned = { x: 5, y: 5, width: 1, length: 1, clearanceMargin: { top: 1, right: 1, bottom: 1, left: 1 } }
  // 0.5m from the zoned item's right edge — inside its 1m margin either way.
  const nearby = { x: 6.5, y: 5, width: 1, length: 1 }
  const farAway = { x: 9, y: 5, width: 1, length: 1 }

  it('blocks a plain item from moving into a zoned neighbour\'s margin', () => {
    expect(collidesWithClearance(nearby, [zoned])).toBe(true)
    expect(collidesWithClearance(farAway, [zoned])).toBe(false)
  })

  it('blocks the zoned item itself from moving into a plain neighbour\'s space (the actual bug)', () => {
    const plain = { x: 6.5, y: 5, width: 1, length: 1 }
    expect(collidesWithClearance(zoned, [plain])).toBe(true)
    const plainFar = { x: 9, y: 5, width: 1, length: 1 }
    expect(collidesWithClearance(zoned, [plainFar])).toBe(false)
  })

  it('two plain items with no margin at all only collide on genuine overlap', () => {
    const a = { x: 0, y: 0, width: 1, length: 1 }
    const b = { x: 0.9, y: 0, width: 1, length: 1 }
    const c = { x: 2, y: 0, width: 1, length: 1 }
    expect(collidesWithClearance(a, [b])).toBe(true)
    expect(collidesWithClearance(a, [c])).toBe(false)
  })
})

describe('rotateOutline90', () => {
  it('rotates the corners of a box to the corners of its swapped-dimension box', () => {
    // A 4x2 box rotated 90° becomes a 2x4 box — every corner of the source
    // must land exactly on a corner of the new [0,2]x[0,4] box.
    const points = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 0, y: 2 }]
    const rotated = rotateOutline90(points, 4, 2)
    const xs = rotated.map((p) => p.x)
    const ys = rotated.map((p) => p.y)
    expect(Math.min(...xs)).toBeCloseTo(0)
    expect(Math.max(...xs)).toBeCloseTo(2)
    expect(Math.min(...ys)).toBeCloseTo(0)
    expect(Math.max(...ys)).toBeCloseTo(4)
  })
})

describe('polygonsOverlap', () => {
  it('detects overlapping convex polygons', () => {
    const a = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }]
    const b = [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 3 }, { x: 1, y: 3 }]
    expect(polygonsOverlap(a, b)).toBe(true)
  })

  it('returns false for separated convex polygons', () => {
    const a = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }]
    const b = [{ x: 5, y: 5 }, { x: 7, y: 5 }, { x: 7, y: 7 }, { x: 5, y: 7 }]
    expect(polygonsOverlap(a, b)).toBe(false)
  })

  it('a shape sitting entirely in an L-shape notch does not overlap it', () => {
    // L-shape: 4x4 outer box with the top-right 2x2 quadrant cut out.
    const lShape = [
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 },
      { x: 2, y: 2 }, { x: 2, y: 4 }, { x: 0, y: 4 },
    ]
    const inNotch = [{ x: 2.5, y: 2.5 }, { x: 3.5, y: 2.5 }, { x: 3.5, y: 3.5 }, { x: 2.5, y: 3.5 }]
    expect(polygonsOverlap(lShape, inNotch)).toBe(false)
  })

  it('a shape overlapping the L-shape\'s solid part does overlap it', () => {
    const lShape = [
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 },
      { x: 2, y: 2 }, { x: 2, y: 4 }, { x: 0, y: 4 },
    ]
    const inSolidPart = [{ x: 0.5, y: 0.5 }, { x: 1.5, y: 0.5 }, { x: 1.5, y: 1.5 }, { x: 0.5, y: 1.5 }]
    expect(polygonsOverlap(lShape, inSolidPart)).toBe(true)
  })
})

describe('nearestPointOnPolygon', () => {
  const rect = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 0, y: 4 }]

  it('snaps an interior click onto the nearest edge, normal pointing outward', () => {
    // Closer to the top edge (y=0) than any other side.
    const res = nearestPointOnPolygon({ x: 3, y: 1 }, rect)
    expect(res.y).toBeCloseTo(0, 9)
    expect(res.x).toBeCloseTo(3, 9)
    expect(res.normalY).toBeLessThan(0) // outward = away from the rectangle, i.e. upward (negative y)
  })

  it('snaps to a side edge with the correct outward normal', () => {
    const res = nearestPointOnPolygon({ x: 9, y: 2 }, rect)
    expect(res.x).toBeCloseTo(10, 9)
    expect(res.normalX).toBeGreaterThan(0)
  })

  it('a point already on the boundary stays put', () => {
    const res = nearestPointOnPolygon({ x: 5, y: 0 }, rect)
    expect(res.x).toBeCloseTo(5, 9)
    expect(res.y).toBeCloseTo(0, 9)
  })
})

describe('polygonArea', () => {
  it('computes the area of a plain rectangle', () => {
    const rect = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 0, y: 2 }]
    expect(polygonArea(rect)).toBeCloseTo(8)
  })

  it('computes the area of a corner-cut (convex) deck outline', () => {
    // 4x4 square with a 1x1 corner cut off the top-right — area 15.
    const cutCorner = [
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 4 }, { x: 0, y: 4 },
    ]
    expect(polygonArea(cutCorner)).toBeCloseTo(15)
  })

  it('computes the area of a concave L-shape', () => {
    const lShape = [
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 },
      { x: 2, y: 2 }, { x: 2, y: 4 }, { x: 0, y: 4 },
    ]
    expect(polygonArea(lShape)).toBeCloseTo(12)
  })
})

describe('rectInsidePolygon', () => {
  const cutCorner = [
    { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 4 }, { x: 0, y: 4 },
  ]

  it('accepts a rect fully inside the polygon', () => {
    expect(rectInsidePolygon({ x: 0, y: 0, width: 2, length: 2 }, cutCorner)).toBe(true)
  })

  it('rejects a rect that overlaps the cut-off corner', () => {
    expect(rectInsidePolygon({ x: 3, y: 3, width: 1, length: 1 }, cutCorner)).toBe(false)
  })

  it('rejects a rect that extends past the polygon boundary', () => {
    expect(rectInsidePolygon({ x: 3.5, y: 0, width: 1, length: 1 }, cutCorner)).toBe(false)
  })
})

describe('deckOutlineExclusionRects', () => {
  it('returns no exclusion rects for a plain rectangle outline', () => {
    const rect = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 0, y: 2 }]
    expect(deckOutlineExclusionRects(rect, 4, 2)).toEqual([])
  })

  it('excludes the cut-off corner of a convex corner-cut deck', () => {
    const cutCorner = [
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 4 }, { x: 0, y: 4 },
    ]
    const rects = deckOutlineExclusionRects(cutCorner, 4, 4)
    const excludedArea = rects.reduce((sum, r) => sum + r.width * r.height, 0)
    // Bounding box is 16, polygon area is 15 -> excluded area should be 1.
    expect(excludedArea).toBeCloseTo(1)
    // The excluded rect must sit in the top-right corner.
    for (const r of rects) {
      expect(r.x + r.width).toBeLessThanOrEqual(4 + 1e-6)
      expect(r.y + r.height).toBeLessThanOrEqual(4 + 1e-6)
      expect(r.x).toBeGreaterThanOrEqual(3 - 1e-6)
      expect(r.y).toBeGreaterThanOrEqual(3 - 1e-6)
    }
  })

  it('excludes the notch of a concave L-shaped deck', () => {
    const lShape = [
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 },
      { x: 2, y: 2 }, { x: 2, y: 4 }, { x: 0, y: 4 },
    ]
    const rects = deckOutlineExclusionRects(lShape, 4, 4)
    const excludedArea = rects.reduce((sum, r) => sum + r.width * r.height, 0)
    // Bounding box is 16, L-shape area is 12 -> excluded (notch) area is 4.
    expect(excludedArea).toBeCloseTo(4)
    // A point inside the notch (top-right quadrant) must be covered by some
    // exclusion rect.
    const inNotch = { x: 3, y: 3 }
    const covered = rects.some(
      (r) => inNotch.x >= r.x && inNotch.x <= r.x + r.width && inNotch.y >= r.y && inNotch.y <= r.y + r.height
    )
    expect(covered).toBe(true)
  })

  // Regression: a wide "V" notch cut into the top edge (a hand-drawn shape
  // spanning many meters between vertices) used to be approximated by a
  // single flat-topped exclusion rect per half — sampled only at each
  // half's midpoint — so free space near the two top corners was wrongly
  // excluded far below the real sloped edge (this is exactly what the user
  // saw: the green hatching stopping well short of the true boundary near
  // both peaks of a V-shaped deck).
  it('follows a wide sloped edge closely instead of a single flat midpoint sample', () => {
    const vShape = [
      { x: 0, y: 0 }, { x: 10, y: 6 }, { x: 20, y: 0 }, { x: 20, y: 8 }, { x: 0, y: 8 },
    ]
    const isExcluded = (pt: { x: number; y: number }) =>
      deckOutlineExclusionRects(vShape, 20, 8).some(
        (r) => pt.x >= r.x && pt.x <= r.x + r.width && pt.y >= r.y && pt.y <= r.y + r.height
      )
    // At x=1, the true descending edge sits at y=0.6 (10% of the way from
    // (0,0) to (10,6)). Just above it is genuinely outside the deck...
    expect(isExcluded({ x: 1, y: 0.3 })).toBe(true)
    // ...but just below it is real, valid deck area — the old flat
    // (midpoint-only) approximation wrongly excluded this too, all the way
    // up to y=3 (the strip midpoint's edge height).
    expect(isExcluded({ x: 1, y: 0.8 })).toBe(false)
    // Same check mirrored on the right-hand descending edge (x=19, true
    // edge at y=0.6 there too).
    expect(isExcluded({ x: 19, y: 0.3 })).toBe(true)
    expect(isExcluded({ x: 19, y: 0.8 })).toBe(false)
  })
})

describe('polygonInsideRects', () => {
  it('decomposes a plain rectangle into exactly its own bbox', () => {
    const rect = restrictionZonePolygon({ shapeType: 'rect', x: 2, y: 1, width: 3, length: 2 })
    const rects = polygonInsideRects(rect, 20, 8)
    const area = rects.reduce((s, r) => s + r.width * r.height, 0)
    expect(area).toBeCloseTo(6)
    expect(rects.every((r) => r.x >= 2 - 1e-6 && r.y >= 1 - 1e-6 && r.x + r.width <= 5 + 1e-6 && r.y + r.height <= 3 + 1e-6)).toBe(true)
  })

  it('decomposes a triangle to roughly half its bbox area', () => {
    const tri = restrictionZonePolygon({ shapeType: 'triangle', x: 0, y: 0, width: 4, length: 4 })
    const rects = polygonInsideRects(tri, 4, 4)
    const area = rects.reduce((s, r) => s + r.width * r.height, 0)
    expect(area).toBeCloseTo(8, 0)
  })

  it('decomposes an oval to roughly pi/4 of its bbox area', () => {
    const oval = restrictionZonePolygon({ shapeType: 'oval', x: 0, y: 0, width: 4, length: 4 })
    const rects = polygonInsideRects(oval, 4, 4)
    const area = rects.reduce((s, r) => s + r.width * r.height, 0)
    expect(area).toBeCloseTo(4 * 4 * (Math.PI / 4), 0)
  })
})

describe('restrictionZonePolygon custom outline', () => {
  it('uses the stored world-space outline for a custom zone instead of deriving from bbox', () => {
    const outline = [{ x: 1, y: 1 }, { x: 4, y: 1 }, { x: 4, y: 3 }, { x: 2, y: 5 }, { x: 1, y: 3 }]
    const poly = restrictionZonePolygon({ shapeType: 'custom', x: 1, y: 1, width: 3, length: 4, outline })
    expect(poly).toBe(outline)
  })

  it('falls back to a plain rect when shapeType is custom but no outline is stored', () => {
    const poly = restrictionZonePolygon({ shapeType: 'custom', x: 1, y: 1, width: 3, length: 4 })
    expect(poly).toEqual([
      { x: 1, y: 1 },
      { x: 4, y: 1 },
      { x: 4, y: 5 },
      { x: 1, y: 5 },
    ])
  })
})

describe('restrictionZoneExclusions', () => {
  it('carries the zone name and a local-frame outline usable by collidesPrecisely', () => {
    const [ex] = restrictionZoneExclusions([{ id: 'z1', name: 'Кран', shapeType: 'rect', x: 5, y: 3, width: 2, length: 1 }])
    expect(ex.name).toBe('Кран')
    expect(ex.x).toBe(5)
    expect(ex.y).toBe(3)
    // Local outline spans [0,width]x[0,length], not world coords.
    expect(ex.outline.every((p) => p.x >= -1e-9 && p.x <= 2 + 1e-9 && p.y >= -1e-9 && p.y <= 1 + 1e-9)).toBe(true)
  })
})

describe('packDeck restriction zones (auto mode)', () => {
  it('never places algorithmically-packed cargo inside a restriction zone', () => {
    const items: CargoItem[] = [
      { id: 'a', name: 'Box', width: 1, length: 1, height: 1, quantity: 40, color: '#000', allowRotation: true },
    ]
    const zone = { id: 'z1', name: 'Кран', shapeType: 'rect' as const, x: 2, y: 0, width: 2, length: 4 }
    const result = packDeck(6, 4, items, { restrictionZones: [zone] })
    for (const p of result.placed) {
      const overlaps = p.x < zone.x + zone.width && p.x + p.width > zone.x && p.y < zone.y + zone.length && p.y + p.length > zone.y
      expect(overlaps).toBe(false)
    }
  })

  it('rejects a pin that falls inside a restriction zone', () => {
    const items: CargoItem[] = [
      { id: 'a', name: 'Box', width: 1, length: 1, height: 1, quantity: 1, color: '#000', allowRotation: true },
    ]
    const zone = { id: 'z1', name: 'Кран', shapeType: 'rect' as const, x: 0, y: 0, width: 2, length: 2 }
    const pin = { id: 'p1', itemId: 'a', name: 'Box', x: 0.5, y: 0.5, width: 1, length: 1, layers: 1, rotated: false, color: '#000' }
    const result = packDeck(6, 4, items, { restrictionZones: [zone], pinned: [pin] })
    expect(result.placed.find((p) => p.itemId === 'a' && Math.abs(p.x - 0.5) < 0.01)).toBeUndefined()
    expect(result.unplaced.some((u) => u.reason === 'Закреплённая позиция попадает в зону ограничения')).toBe(true)
  })
})

describe('dedupePolygonVertices', () => {
  it('drops a vertex sitting a few cm from its neighbor on a multi-meter deck', () => {
    const withStrayPoint = [
      { x: 0, y: 0 }, { x: 14.44, y: 5.51 }, { x: 14.47, y: 5.53 }, { x: 20, y: 8 }, { x: 0, y: 8 },
    ]
    const cleaned = dedupePolygonVertices(withStrayPoint)
    expect(cleaned).toEqual([
      { x: 0, y: 0 }, { x: 14.44, y: 5.51 }, { x: 20, y: 8 }, { x: 0, y: 8 },
    ])
  })

  it('leaves a normal polygon with well-separated vertices untouched', () => {
    const rect = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 0, y: 6 }]
    expect(dedupePolygonVertices(rect)).toEqual(rect)
  })

  it('drops a closing point that collapses back onto the first vertex', () => {
    const closed = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 0, y: 6 }, { x: 0.001, y: 0.001 }]
    expect(dedupePolygonVertices(closed)).toEqual([
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 0, y: 6 },
    ])
  })
})

describe('erodePolygon', () => {
  it('shrinks a rectangle to the same result as a plain bounding-box inset', () => {
    const rect = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 0, y: 6 }]
    const eroded = erodePolygon(rect, 1)
    expect(eroded).toHaveLength(4)
    const xs = eroded.map((p) => p.x).sort((a, b) => a - b)
    const ys = eroded.map((p) => p.y).sort((a, b) => a - b)
    expect(xs[0]).toBeCloseTo(1)
    expect(xs[3]).toBeCloseTo(9)
    expect(ys[0]).toBeCloseTo(1)
    expect(ys[3]).toBeCloseTo(5)
  })

  it('shrinks a corner-cut deck so the diagonal edge also gets clearance', () => {
    const cutCorner = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 8, y: 8 }, { x: 8, y: 10 }, { x: 0, y: 10 },
    ]
    const eroded = erodePolygon(cutCorner, 1)
    // A point right on the original diagonal cut edge must now be outside
    // the eroded shape — the whole point of contour-following board offset.
    expect(rectInsidePolygon({ x: 8.4, y: 8.4, width: 0.1, length: 0.1 }, eroded)).toBe(false)
    // A point well inside, away from every edge, stays inside.
    expect(rectInsidePolygon({ x: 4, y: 4, width: 0.5, length: 0.5 }, eroded)).toBe(true)
  })

  it('returns 0 (no-op) for a non-positive margin', () => {
    const rect = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 0, y: 6 }]
    expect(erodePolygon(rect, 0)).toEqual(rect)
    expect(erodePolygon(rect, -1)).toEqual(rect)
  })

  it('is not thrown off by a stray near-duplicate vertex (regression: a real drag interaction can drop one)', () => {
    // Same shape (dart with a deep concave notch) and near-duplicate vertex
    // pair that a real editor drag produced and broke board offset on.
    const withStrayPoint = [
      { x: 0, y: 0 }, { x: 14.44, y: 5.51 }, { x: 14.47, y: 5.53 }, { x: 20, y: 8 }, { x: 0, y: 8 },
    ]
    const eroded = erodePolygon(withStrayPoint, 1)
    // A point comfortably away from every edge (>1m from each) must stay
    // inside — before the dedupe fix this was wrongly rejected because the
    // near-zero-length edge sent that corner's offset in a bad direction.
    expect(rectInsidePolygon({ x: 3, y: 4, width: 2, length: 1.2 }, eroded)).toBe(true)
  })
})

describe('worldPolygon', () => {
  it('falls back to the plain bounding-box rectangle when there is no outline', () => {
    const poly = worldPolygon({ x: 1, y: 1, width: 2, length: 3 })
    expect(poly).toEqual([
      { x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 4 }, { x: 1, y: 4 },
    ])
  })

  it('translates a custom outline by the placement position', () => {
    const outline = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }]
    const poly = worldPolygon({ x: 5, y: 5, width: 2, length: 2, outline })
    expect(poly).toEqual([
      { x: 5, y: 5 }, { x: 7, y: 5 }, { x: 7, y: 7 }, { x: 5, y: 7 },
    ])
  })
})

describe('collidesPrecisely', () => {
  it('allows a placement inside an L-shape notch that its bounding box would have blocked', () => {
    const lOutline = [
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 },
      { x: 2, y: 2 }, { x: 2, y: 4 }, { x: 0, y: 4 },
    ]
    const lShapePlacement = { x: 0, y: 0, width: 4, length: 4, outline: lOutline }
    const candidateInNotch = { x: 2.5, y: 2.5, width: 1, length: 1 }
    // Bounding-box collision (plain collidesWith) says these overlap...
    expect(collidesWith(candidateInNotch, [lShapePlacement])).toBe(true)
    // ...but the precise check correctly allows it, since the notch is empty.
    expect(collidesPrecisely(candidateInNotch, [lShapePlacement])).toBe(false)
  })

  it('still blocks a placement overlapping the L-shape\'s solid part', () => {
    const lOutline = [
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 },
      { x: 2, y: 2 }, { x: 2, y: 4 }, { x: 0, y: 4 },
    ]
    const lShapePlacement = { x: 0, y: 0, width: 4, length: 4, outline: lOutline }
    const candidateInSolidPart = { x: 0.5, y: 0.5, width: 1, length: 1 }
    expect(collidesPrecisely(candidateInSolidPart, [lShapePlacement])).toBe(true)
  })

  it('behaves exactly like collidesWith when neither side has an outline', () => {
    const a = { x: 0, y: 0, width: 2, length: 2 }
    const overlapping = { x: 1, y: 1, width: 2, length: 2 }
    const separate = { x: 10, y: 10, width: 2, length: 2 }
    expect(collidesPrecisely(a, [overlapping])).toBe(collidesWith(a, [overlapping]))
    expect(collidesPrecisely(a, [separate])).toBe(collidesWith(a, [separate]))
  })
})

describe('lashingPointExclusionRects', () => {
  it('builds a square of at least the minimum exclusion size around each point, even with gap 0', () => {
    const rects = lashingPointExclusionRects([{ x: 5, y: 5 }], 0)
    expect(rects).toHaveLength(1)
    const r = rects[0]
    expect(r.width).toBeGreaterThan(0)
    expect(r.length).toBe(r.width)
    // Centered on the anchor.
    expect(r.x + r.width / 2).toBeCloseTo(5)
    expect(r.y + r.length / 2).toBeCloseTo(5)
  })

  it('grows with the deck gap so widening cargo spacing also pushes cargo further from lashing points', () => {
    const tight = lashingPointExclusionRects([{ x: 0, y: 0 }], 0.1)
    const wide = lashingPointExclusionRects([{ x: 0, y: 0 }], 1)
    expect(wide[0].width).toBeGreaterThan(tight[0].width)
  })

  it('blocks a cargo placement dropped directly on a lashing point anchor', () => {
    const exclusions = lashingPointExclusionRects([{ x: 5, y: 5 }], 0.2)
    const candidate = { x: 4.9, y: 4.9, width: 1, length: 1 }
    expect(collidesWith(candidate, exclusions)).toBe(true)
  })
})

describe('clampToDeck', () => {
  it('keeps inside deck', () => {
    expect(clampToDeck({ x: -1, y: -1, width: 2, length: 2 }, 10, 10)).toEqual({ x: 0, y: 0, width: 2, length: 2 })
  })

  it('keeps right/bottom edge inside', () => {
    expect(clampToDeck({ x: 9, y: 9, width: 2, length: 2 }, 10, 10)).toEqual({ x: 8, y: 8, width: 2, length: 2 })
  })

  it('handles NaN deck dimensions', () => {
    const clamped = clampToDeck({ x: 1, y: 1, width: 1, length: 1 }, NaN, NaN)
    expect(Number.isFinite(clamped.x)).toBe(true)
    expect(Number.isFinite(clamped.y)).toBe(true)
  })
})

describe('rotatePlacement', () => {
  it('rotates around the center and clamps inside the deck', () => {
    // A 4x1 rect near the top-left corner; rotating gives a 1x4 rect that must
    // be pulled inside the deck bounds (with a 0.5 edge margin).
    const result = rotatePlacement({ x: 0.5, y: 0.5, width: 4, length: 1 }, 10, 10, 0.5, 0, [])
    expect(result).not.toBeNull()
    expect(result!.width).toBe(1)
    expect(result!.length).toBe(4)
    expect(result!.x).toBeGreaterThanOrEqual(0.5)
    expect(result!.y).toBeGreaterThanOrEqual(0.5)
    expect(result!.x + result!.width).toBeLessThanOrEqual(9.5 + 1e-9)
    expect(result!.y + result!.length).toBeLessThanOrEqual(9.5 + 1e-9)
  })

  it('rejects a rotation that would collide with another placement', () => {
    // Rotating a 4x1 rect at the center of a tight 5x5 deck would occupy
    // most of the vertical span, colliding with a neighbour placed there.
    const others = [{ x: 2, y: 0, width: 1, length: 5 }]
    const result = rotatePlacement({ x: 0.5, y: 2, width: 4, length: 1 }, 5, 5, 0, 0, others)
    expect(result).toBeNull()
  })

  it('respects gap when checking collision', () => {
    const others = [{ x: 3, y: 0, width: 1, length: 5 }]
    // Rotated rect would span x=[2,3] with no gap — touching, not overlapping.
    expect(rotatePlacement({ x: 0.5, y: 2, width: 4, length: 1 }, 5, 5, 0, 0, others)).not.toBeNull()
    // With gap 1, the same rotation now needs clearance and should be rejected.
    expect(rotatePlacement({ x: 0.5, y: 2, width: 4, length: 1 }, 5, 5, 0, 1, others)).toBeNull()
  })

  it('rejects a rotation whose new footprint is simply too big for the deck in one axis (regression: used to silently clamp and poke past the opposite edge)', () => {
    // A 9.5x0.15 pipe on a deck only 8m deep — rotating swaps to 0.15x9.5,
    // which cannot fit in an 8m length no matter where it's positioned.
    // clampToDeck alone can't detect this (it only repositions, never
    // rejects), so rotatePlacement must guard for it explicitly.
    const result = rotatePlacement({ x: 5, y: 0.2, width: 9.5, length: 0.15 }, 20, 8, 0.2, 0.1, [])
    expect(result).toBeNull()
  })

  it('still rotates fine when the new footprint fits exactly within the padded deck', () => {
    const result = rotatePlacement({ x: 5, y: 0.2, width: 4, length: 0.15 }, 20, 8, 0.2, 0.1, [])
    expect(result).not.toBeNull()
    expect(result!.width).toBe(0.15)
    expect(result!.length).toBe(4)
  })
})

describe('rotatePlacementAnywhere', () => {
  it('rotates in place when nothing blocks it (same result as rotatePlacement)', () => {
    const result = rotatePlacementAnywhere({ x: 0.5, y: 0.5, width: 4, length: 1 }, 10, 10, 0.5, 0, [])
    expect(result).not.toBeNull()
    expect(result!.width).toBe(1)
    expect(result!.length).toBe(4)
  })

  it('finds a free spot elsewhere on the deck when the in-place rotation is blocked by a neighbour (the actual bug: this used to just fail)', () => {
    // A 4x1 item wedged against a neighbour that blocks rotating in place —
    // but the deck has plenty of open room elsewhere.
    const others = [{ x: 2, y: 0, width: 1, length: 5 }]
    const inPlace = rotatePlacement({ x: 0.5, y: 2, width: 4, length: 1 }, 20, 5, 0, 0, others)
    expect(inPlace).toBeNull() // confirms the scenario really is blocked in place
    const result = rotatePlacementAnywhere({ x: 0.5, y: 2, width: 4, length: 1 }, 20, 5, 0, 0, others)
    expect(result).not.toBeNull()
    expect(result!.width).toBe(1)
    expect(result!.length).toBe(4)
    // The found spot must not collide with the neighbour.
    const collides =
      result!.x < others[0].x + others[0].width &&
      result!.x + result!.width > others[0].x &&
      result!.y < others[0].y + others[0].length &&
      result!.y + result!.length > others[0].y
    expect(collides).toBe(false)
  })

  it('returns null when the whole deck is genuinely full', () => {
    const others = [{ x: 0, y: 0, width: 5, length: 5 }]
    const result = rotatePlacementAnywhere({ x: 4.5, y: 4.5, width: 1, length: 0.4 }, 5, 5, 0, 0, others)
    expect(result).toBeNull()
  })

  it('rejects a rotated footprint that is simply too big for the deck, same as rotatePlacement', () => {
    const result = rotatePlacementAnywhere({ x: 5, y: 0.2, width: 9.5, length: 0.15 }, 20, 8, 0.2, 0.1, [])
    expect(result).toBeNull()
  })

  it('respects a non-rectangular deck outline when searching for a fallback spot', () => {
    // A deck with the entire right half excluded — a fallback candidate
    // there must be rejected even though it would otherwise be free.
    const outline = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 10 },
      { x: 0, y: 10 },
    ]
    const others = [{ x: 0, y: 4, width: 1, length: 5 }]
    const result = rotatePlacementAnywhere({ x: 0, y: 0.5, width: 4, length: 1 }, 10, 10, 0, 0, others, outline)
    if (result) {
      expect(result.x + result.width).toBeLessThanOrEqual(5 + 1e-6)
    }
  })
})

describe('resolveSnappedDragPosition', () => {
  it('tracks the raw cursor exactly in open space — no grid snapping', () => {
    const result = resolveSnappedDragPosition(
      6.62, 4.42, 1.5, 1, 0.2, 6.36, [], 20, 8, 0.2, 0.1, 1
    )
    expect(result.x).toBeCloseTo(6.62, 9)
    expect(result.y).toBeCloseTo(4.42, 9)
  })

  it('locks flush against a neighbour within the magnetic threshold', () => {
    // Neighbour at x=[10.36,11.16], y=[0.2,1.4]. Dragging our 1.5x1 item to
    // just past its right edge should snap flush with the configured gap.
    const others = [{ x: 10.36, y: 0.2, width: 0.8, length: 1.2 }]
    const result = resolveSnappedDragPosition(
      11.5, 0.7, 1.5, 1, 14, 3, others, 20, 8, 0.2, 0.1, 1
    )
    expect(result.x).toBeCloseTo(11.16 + 0.1, 9)
  })

  it('locks flush against the deck margin', () => {
    const result = resolveSnappedDragPosition(
      0.05, 3.5, 1.5, 1, 5, 3.5, [], 20, 8, 0.2, 0.1, 1
    )
    expect(result.x).toBeCloseTo(0.2, 9)
  })

  // Regression: a 20ft container (6.06m) laid along an 8m deck's length
  // axis leaves only ~1.54m of free-slide room there. maxMagnetDistance
  // defaults to 1m for this deck size, so BOTH edges' magnet zones used to
  // cover the entire usable range at once — every drag target fell within
  // range of at least one edge, so the item could only ever be released
  // flush against the top or bottom margin, never anywhere in the middle,
  // no matter where the cursor actually was. Reported live as "can only
  // drag edge-to-edge, can't drop it in the center with the mouse."
  it('still tracks the cursor in the middle of a tight axis, not just its own two edges', () => {
    const width = 2.44
    const length = 6.06
    const deckWidth = 20
    const deckLength = 8
    const boardOffset = 0.2
    const minY = boardOffset
    const maxY = deckLength - boardOffset - length // 1.74
    const midY = (minY + maxY) / 2 // ~0.97 — equidistant from both edges
    const result = resolveSnappedDragPosition(
      10, midY, width, length, 10, minY, [], deckWidth, deckLength, boardOffset, 0.1, 1
    )
    expect(result.y).toBeCloseTo(midY, 9)
  })

  it('falls back to a vector slide when nothing is within the magnetic threshold', () => {
    // Dense cluster of neighbours directly on the path; snap/lock candidates all
    // collide, so it must fall back toward the last collision-free point along
    // the drag vector instead of teleporting through the obstacle.
    const others = [{ x: 1, y: 0, width: 8, length: 8 }]
    const result = resolveSnappedDragPosition(
      5, 4, 1, 1, 0, 4, others, 20, 8, 0, 0, 1
    )
    // Must not end up inside the obstacle (x in [1,9], y in [0,8]).
    const collidesObstacle = result.x < 9 && result.x + 1 > 1 && result.y < 8 && result.y + 1 > 0
    expect(collidesObstacle).toBe(false)
  })

  it('is idempotent when already resting flush against a neighbour', () => {
    const others = [{ x: 5, y: 0, width: 2, length: 2 }]
    // Already flush against the neighbour's left edge (gap 0) — re-resolving
    // the same position should not shift it.
    const result = resolveSnappedDragPosition(
      3, 0, 2, 2, 3, 0, others, 20, 8, 0, 0, 0
    )
    expect(result.x).toBeCloseTo(3, 9)
    expect(result.y).toBeCloseTo(0, 9)
  })

  it('locks flush against a large neighbour even when the grid-rounded target would fall outside its span', () => {
    // Regression test: a large "container" spans y=[0.2, 7.8]. gridStep=1 means
    // a raw target of y=7.5 (well inside the container's span) rounds to y=8,
    // which falls OUTSIDE the span — previously this made the overlap check
    // use the rounded coordinate and silently drop the flush candidate,
    // forcing a coarse, far-off fallback ("can't get close to the neighbour").
    const container = { x: 0.2, y: 0.2, width: 10, length: 7.6 }
    const result = resolveSnappedDragPosition(
      10.3, 7.5, 1.2, 0.8, 14, 3, [container], 20, 8, 0.2, 0.1, 1
    )
    // Must land gap-precise against the container's right edge, not several
    // grid-steps away.
    expect(result.x).toBeCloseTo(container.x + container.width + 0.1, 9)
  })

  it('slides along a neighbour smoothly, tracking the cursor on the free axis', () => {
    // Dragging along the right edge of a neighbour at several sub-grid
    // y-positions should track the cursor's y exactly, not jump in gridStep
    // increments, since the flush candidate uses the raw target.
    const neighbour = { x: 5, y: 0, width: 2, length: 10 }
    for (const y of [1.23, 4.567, 8.91]) {
      const result = resolveSnappedDragPosition(
        7.3, y, 1, 1, 7.3, y, [neighbour], 20, 20, 0, 0.1, 1
      )
      expect(result.x).toBeCloseTo(neighbour.x + neighbour.width + 0.1, 9)
      expect(result.y).toBeCloseTo(y, 9)
    }
  })

  // Regression: dragging an item with its own clearanceMargin used to be
  // able to freeze mid-drag. The internal search only inflated OTHER items
  // by their own margin, never the dragged item by ITS margin — so it could
  // settle on a position that looked fine here but then failed the caller's
  // final collidesWithClearance gate (which does check the dragged item's
  // own margin), silently dropping that pointermove frame. Passing
  // selfMargin must make the search itself margin-aware, so every resolved
  // position always survives the same gate the caller applies afterward.
  it('never resolves a position that fails collidesWithClearance for a self-margined item', () => {
    const selfMargin = { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 }
    const neighbour = { x: 6, y: 0, width: 2, length: 2 }
    for (const [tx, ty] of [
      [5.4, 0.3],
      [5.8, 1.0],
      [5.1, 1.9],
    ]) {
      const result = resolveSnappedDragPosition(
        tx, ty, 1, 1, 0, 0, [neighbour], 20, 8, 0, 0.1, 1, undefined, selfMargin
      )
      const resolvedTarget = { x: result.x, y: result.y, width: 1, length: 1, clearanceMargin: selfMargin }
      expect(collidesWithClearance(resolvedTarget, [neighbour], 0.1)).toBe(false)
    }
  })
})

describe('checkZoneLoads', () => {
  const zone = (partial: Partial<LoadZone> & { id: string }): LoadZone => ({
    x: 0, y: 0, width: 10, length: 10, maxLoadPerArea: 5, ...partial,
  })
  const placement = (partial: { x: number; y: number; width: number; length: number; totalWeightKg: number }) => partial

  it('returns an empty array when no zones are configured', () => {
    const p = [placement({ x: 0, y: 0, width: 2, length: 2, totalWeightKg: 100000 })]
    expect(checkZoneLoads(p, undefined)).toEqual([])
    expect(checkZoneLoads(p, [])).toEqual([])
  })

  it('does not flag a zone no placement overlaps', () => {
    const zones = [zone({ id: 'z1', x: 0, y: 0, width: 2, length: 2, maxLoadPerArea: 1 })]
    const p = [placement({ x: 5, y: 5, width: 1, length: 1, totalWeightKg: 100000 })]
    expect(checkZoneLoads(p, zones)).toEqual([])
  })

  it('does not flag a zone exactly at the limit (boundary is not a violation)', () => {
    // 1t over the zone's own 1m² area == 1 t/m², limit is exactly 1 t/m²
    const zones = [zone({ id: 'z1', x: 0, y: 0, width: 1, length: 1, maxLoadPerArea: 1 })]
    const p = [placement({ x: 0, y: 0, width: 1, length: 1, totalWeightKg: 1000 })]
    expect(checkZoneLoads(p, zones)).toEqual([])
  })

  it('divides by the ZONE area, not the item footprint area — a small item in a big zone is not flagged just because its own local density is high', () => {
    const zones = [zone({ id: 'z1', x: 0, y: 0, width: 10, length: 10, maxLoadPerArea: 1 })]
    // 2000kg over a tiny 1x1 footprint = 2 t/m² locally, but over the zone's
    // 100m² it's only 0.02 t/m² — well under the 1 t/m² limit.
    const p = [placement({ x: 0, y: 0, width: 1, length: 1, totalWeightKg: 2000 })]
    expect(checkZoneLoads(p, zones)).toEqual([])
  })

  it('flags a zone whose aggregate density exceeds its limit', () => {
    const zones = [zone({ id: 'z1', x: 0, y: 0, width: 1, length: 1, maxLoadPerArea: 1 })]
    const p = [placement({ x: 0, y: 0, width: 1, length: 1, totalWeightKg: 2000 })]
    const result = checkZoneLoads(p, zones)
    expect(result).toHaveLength(1)
    expect(result[0].zoneId).toBe('z1')
    expect(result[0].limitTPerM2).toBe(1)
    expect(result[0].densityTPerM2).toBe(2)
    expect(result[0].totalWeightKg).toBe(2000)
  })

  it('sums the weight of MULTIPLE placements sharing a zone — two individually-fine items can collectively overload it', () => {
    const zones = [zone({ id: 'z1', x: 0, y: 0, width: 2, length: 1, maxLoadPerArea: 1 })]
    // Zone area = 2m², limit = 1 t/m² -> 2000kg total allowed.
    // Two 900kg items each sit well under any per-item threshold, but
    // together (1800kg... still under) — push to 1200kg each = 2400kg total,
    // which exceeds the zone's 2000kg capacity even though neither item
    // alone would ever trip a per-item check.
    const p = [
      placement({ x: 0, y: 0, width: 1, length: 1, totalWeightKg: 1200 }),
      placement({ x: 1, y: 0, width: 1, length: 1, totalWeightKg: 1200 }),
    ]
    const result = checkZoneLoads(p, zones)
    expect(result).toHaveLength(1)
    expect(result[0].totalWeightKg).toBe(2400)
    expect(result[0].densityTPerM2).toBeCloseTo(1.2, 9)
  })

  it('a placement overlapping two zones contributes its full weight to both, independently', () => {
    const zones = [
      zone({ id: 'a', x: 0, y: 0, width: 1, length: 1, maxLoadPerArea: 1 }),
      zone({ id: 'b', x: 0.5, y: 0, width: 1, length: 1, maxLoadPerArea: 1 }),
    ]
    const p = [placement({ x: 0, y: 0, width: 1.5, length: 1, totalWeightKg: 2000 })]
    const result = checkZoneLoads(p, zones)
    expect(result.map((r) => r.zoneId).sort()).toEqual(['a', 'b'])
    for (const r of result) expect(r.totalWeightKg).toBe(2000)
  })

  it('guards against a zero-area zone', () => {
    const zones = [zone({ id: 'z1', x: 0, y: 0, width: 0, length: 5, maxLoadPerArea: 1 })]
    const p = [placement({ x: 0, y: 0, width: 1, length: 1, totalWeightKg: 100000 })]
    expect(checkZoneLoads(p, zones)).toEqual([])
  })

  it('uses the zone rectangle area unchanged when no deck outline is set', () => {
    const zones = [zone({ id: 'z1', x: 0, y: 0, width: 2, length: 2, maxLoadPerArea: 1 })]
    const p = [placement({ x: 0, y: 0, width: 1, length: 1, totalWeightKg: 4000 })]
    // 4000kg / 4m^2 = 1 t/m^2, exactly at the limit -> not flagged.
    expect(checkZoneLoads(p, zones, undefined)).toEqual([])
  })

  it('clips the zone area to the deck outline — a zone overhanging a cut corner has less real area than its bare rectangle', () => {
    // A 2x2 zone (4m^2 bare), but the deck outline only covers the left
    // half (x: 0..1) — a triangular-ish cut removes the rest. Real area
    // within the outline is exactly 2m^2 (the left half rectangle).
    const outline = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 2 },
      { x: 0, y: 2 },
    ]
    const zones = [zone({ id: 'z1', x: 0, y: 0, width: 2, length: 2, maxLoadPerArea: 1 })]
    // 1500kg over the bare 4m^2 rectangle = 0.375 t/m^2 (would pass against
    // the bare rectangle), but over the real 2m^2 area it's 0.75 t/m^2 —
    // still under the 1 t/m^2 limit, so not yet flagged.
    const under = checkZoneLoads([placement({ x: 0, y: 0, width: 1, length: 1, totalWeightKg: 1500 })], zones, outline)
    expect(under).toEqual([])

    // 2500kg: bare-rectangle density would be 0.625 t/m^2 (still under the
    // limit) but the real clipped area gives 1.25 t/m^2 — this MUST be
    // flagged, and would be silently missed without outline-aware area.
    const over = checkZoneLoads([placement({ x: 0, y: 0, width: 1, length: 1, totalWeightKg: 2500 })], zones, outline)
    expect(over).toHaveLength(1)
    expect(over[0].areaM2).toBeCloseTo(2, 9)
    expect(over[0].densityTPerM2).toBeCloseTo(1.25, 9)
  })

  it('treats a zone entirely outside the deck outline as zero real area (no divide-by-zero, just skipped)', () => {
    const outline = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]
    const zones = [zone({ id: 'z1', x: 5, y: 5, width: 2, length: 2, maxLoadPerArea: 1 })]
    const p = [placement({ x: 5, y: 5, width: 1, length: 1, totalWeightKg: 100000 })]
    expect(checkZoneLoads(p, zones, outline)).toEqual([])
  })
})

describe('zoneAreaWithinOutline', () => {
  it('returns the bare rectangle area when no outline is given', () => {
    expect(zoneAreaWithinOutline({ x: 0, y: 0, width: 3, length: 4 }, undefined)).toBe(12)
  })

  it('returns the full rectangle area when the zone is entirely inside the outline', () => {
    const outline = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]
    expect(zoneAreaWithinOutline({ x: 1, y: 1, width: 2, length: 2 }, outline)).toBeCloseTo(4, 9)
  })

  it('clips correctly against a concave (L-shaped) outline', () => {
    // L-shape: full 4x4 square minus the top-right 2x2 quadrant.
    const outline = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 4 },
      { x: 0, y: 4 },
    ]
    // Zone spans the full bounding box (0..4, 0..4) = 16m^2 bare, but only
    // the L's 12m^2 is real deck.
    expect(zoneAreaWithinOutline({ x: 0, y: 0, width: 4, length: 4 }, outline)).toBeCloseTo(12, 9)
  })
})

describe('zoneIdsOverlapping', () => {
  const zone = (partial: Partial<LoadZone> & { id: string }): LoadZone => ({
    x: 0, y: 0, width: 10, length: 10, maxLoadPerArea: 5, ...partial,
  })

  it('returns every zone id a footprint overlaps', () => {
    const zones = [
      zone({ id: 'a', x: 0, y: 0, width: 1, length: 1 }),
      zone({ id: 'b', x: 0.5, y: 0, width: 1, length: 1 }),
      zone({ id: 'c', x: 5, y: 5, width: 1, length: 1 }),
    ]
    expect(zoneIdsOverlapping({ x: 0, y: 0, width: 1.5, length: 1 }, zones).sort()).toEqual(['a', 'b'])
  })

  it('returns an empty array with no zones', () => {
    expect(zoneIdsOverlapping({ x: 0, y: 0, width: 1, length: 1 }, undefined)).toEqual([])
  })
})

describe('checkLashingBalance', () => {
  const placement = { x: 0, y: 0, width: 2, length: 2, weight: 2000 }
  const lashing = (partial: Partial<LashingPoint> & { id: string }): LashingPoint => ({
    x: -5, y: 0, cornerX: 0, cornerY: 0, verticalAngleDeg: 0, mslKg: 300, ...partial,
  })

  it('returns null when nothing is attached (unsecured cargo is informational, not a failure)', () => {
    expect(checkLashingBalance(placement, [], DEFAULT_VESSEL_MOTION)).toBeNull()
    expect(
      checkLashingBalance(placement, [{ id: 'l1', x: 1, y: 1 }], DEFAULT_VESSEL_MOTION)
    ).toBeNull()
  })

  it('passes when friction + lashing MSL comfortably covers the required force', () => {
    const lashings = [lashing({ id: 'l1' }), lashing({ id: 'l2', x: 0, y: -5, cornerX: 0, cornerY: 0 })]
    const result = checkLashingBalance(placement, lashings, DEFAULT_VESSEL_MOTION)
    expect(result).not.toBeNull()
    expect(result!.ok).toBe(true)
  })

  it('fails when a single weak lashing cannot cover the required force even with friction', () => {
    const weak = [lashing({ id: 'l1', mslKg: 1 })]
    const heavy = { ...placement, weight: 100000 }
    const result = checkLashingBalance(heavy, weak, DEFAULT_VESSEL_MOTION)
    expect(result).not.toBeNull()
    expect(result!.ok).toBe(false)
  })

  it('a marginal transverse case passes under "coastal" but fails under "open-sea" (higher ay)', () => {
    const lashings = [lashing({ id: 'l1' })]
    const coastal = checkLashingBalance(placement, lashings, DEFAULT_VESSEL_MOTION)
    const openSea = checkLashingBalance(placement, lashings, { ...VESSEL_MOTION_PRESETS['open-sea'], preset: 'open-sea' })
    expect(coastal!.transverse.ok).toBe(true)
    expect(openSea!.transverse.ok).toBe(false)
  })
})

describe('violatesSeparation', () => {
  const rule = (partial: Partial<SeparationRule> & { id: string }): SeparationRule => ({
    categoryA: 'hazard', categoryB: 'standard', minDistance: 5, ...partial,
  })

  it('is false when no rules or no category', () => {
    expect(violatesSeparation({ x: 0, y: 0, width: 1, length: 1 }, [], undefined)).toBe(false)
    expect(
      violatesSeparation(
        { x: 0, y: 0, width: 1, length: 1, category: undefined },
        [{ x: 2, y: 0, width: 1, length: 1, category: 'standard' }],
        [rule({ id: 'r1' })]
      )
    ).toBe(false)
  })

  it('rejects a placement closer than minDistance to a matching category', () => {
    const rules = [rule({ id: 'r1' })]
    const others = [{ x: 3, y: 0, width: 1, length: 1, category: 'standard' }]
    // Candidate ends at x=1, other starts at x=3 -> edge distance 2 < 5
    expect(
      violatesSeparation({ x: 0, y: 0, width: 1, length: 1, category: 'hazard' }, others, rules)
    ).toBe(true)
  })

  it('accepts a placement at or beyond minDistance', () => {
    const rules = [rule({ id: 'r1' })]
    const others = [{ x: 6, y: 0, width: 1, length: 1, category: 'standard' }]
    // Candidate ends at x=1, other starts at x=6 -> edge distance 5 == minDistance
    expect(
      violatesSeparation({ x: 0, y: 0, width: 1, length: 1, category: 'hazard' }, others, rules)
    ).toBe(false)
  })

  it('matches a rule symmetrically (B, A) as well as (A, B)', () => {
    const rules = [rule({ id: 'r1' })]
    const others = [{ x: 3, y: 0, width: 1, length: 1, category: 'hazard' }]
    expect(
      violatesSeparation({ x: 0, y: 0, width: 1, length: 1, category: 'standard' }, others, rules)
    ).toBe(true)
  })

  it('ignores pairs with no matching rule', () => {
    const rules = [rule({ id: 'r1' })]
    const others = [{ x: 0.5, y: 0, width: 1, length: 1, category: 'standard' }]
    expect(
      violatesSeparation({ x: 0, y: 0, width: 1, length: 1, category: 'standard' }, others, rules)
    ).toBe(false)
  })
})

describe('packDeck with separation rules', () => {
  it('does not place a hazardous item within the required distance of a standard one', () => {
    const rules: SeparationRule[] = [{ id: 'r1', categoryA: 'hazard', categoryB: 'standard', minDistance: 3 }]
    const items = [
      item({ id: 'std', width: 2, length: 2, quantity: 1, category: 'standard' }),
      item({ id: 'haz', width: 2, length: 2, quantity: 1, category: 'hazard' }),
    ]
    const res = packDeck(10, 3, items, { separationRules: rules, gap: 0 })
    const std = res.placed.find((p) => p.itemId === 'std')
    const haz = res.placed.find((p) => p.itemId === 'haz')
    expect(std).toBeDefined()
    if (haz) {
      const dx = Math.max(std!.x - (haz.x + haz.width), haz.x - (std!.x + std!.width), 0)
      const dy = Math.max(std!.y - (haz.y + haz.length), haz.y - (std!.y + std!.length), 0)
      expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(3 - 1e-9)
    } else {
      expect(res.unplaced.some((u) => u.itemId === 'haz' && u.reason.includes('сепарац'))).toBe(true)
    }
  })

  it('places items normally when categories/rules are absent', () => {
    const items = [item({ id: 'a', width: 2, length: 2, quantity: 2 })]
    const res = packDeck(10, 10, items, {})
    expect(res.placed).toHaveLength(2)
  })
})

describe('packMultiTrip', () => {
  it('splits cargo that does not fit in one trip across multiple trips', () => {
    // Deck fits exactly 4 items (2x2 each) per trip on a 4x4 deck; 10 requested -> 3 trips.
    const items = [item({ id: 'a', width: 2, length: 2, quantity: 10 })]
    const trips = packMultiTrip(4, 4, items, { gap: 0 }, 10)
    expect(trips.length).toBeGreaterThan(1)
    const totalPlaced = trips.reduce((s, t) => s + t.placedCount, 0)
    expect(totalPlaced).toBe(10)
    expect(trips[trips.length - 1].unplaced).toHaveLength(0)
  })

  it('stops without an infinite loop when an item is oversized for every deck', () => {
    const items = [item({ id: 'huge', width: 100, length: 100, quantity: 3 })]
    const trips = packMultiTrip(4, 4, items, {}, 5)
    expect(trips.length).toBeLessThanOrEqual(5)
    expect(trips.every((t) => t.placedCount === 0)).toBe(true)
  })

  it('fits everything in a single trip when it all fits', () => {
    const items = [item({ id: 'a', width: 2, length: 2, quantity: 2 })]
    const trips = packMultiTrip(10, 10, items, {}, 5)
    expect(trips).toHaveLength(1)
    expect(trips[0].unplaced).toHaveLength(0)
  })

  it('conserves total requested count across all trips (placed + final unplaced)', () => {
    const items = [item({ id: 'a', width: 2, length: 2, quantity: 9 })]
    const trips = packMultiTrip(4, 4, items, { gap: 0 }, 10)
    const totalPlaced = trips.reduce((s, t) => s + t.placedCount, 0)
    expect(totalPlaced).toBe(9)
    expect(trips[trips.length - 1].unplaced).toHaveLength(0)
  })

  it('applies a pin only to its own trip via pinnedByTrip', () => {
    // 4x4 deck, gap 0, 2x2 items fit 4 per trip -> 10 items -> 3 trips.
    const items = [item({ id: 'a', width: 2, length: 2, quantity: 10 })]
    const pinOnTrip1: PinnedPlacement = {
      id: 'pin-trip1',
      itemId: 'a',
      name: 'Груз',
      x: 2,
      y: 2,
      width: 2,
      length: 2,
      layers: 1,
      rotated: false,
      color: '#0ea5e9',
    }
    const trips = packMultiTrip(4, 4, items, { gap: 0 }, 10, { 1: [pinOnTrip1] })
    expect(trips.length).toBeGreaterThan(1)
    // Trip index 1 (the second trip) must honor the pinned position.
    expect(trips[1].placed.some((p) => p.x === 2 && p.y === 2)).toBe(true)
    // Trip 0 is unaffected by the pin scoped to trip 1 — it still fills normally.
    expect(trips[0].placedCount).toBe(4)
    const totalPlaced = trips.reduce((s, t) => s + t.placedCount, 0)
    expect(totalPlaced).toBe(10)
  })

  it('does not leak options.pinned onto trips missing from pinnedByTrip once pinnedByTrip is provided', () => {
    // 4x4 deck, gap 0, 2x2 items fit 4 per trip -> 8 items -> exactly 2 trips.
    const items = [item({ id: 'a', width: 2, length: 2, quantity: 8 })]
    // Off-grid position a normal (unpinned) 2x2 packing on this deck could
    // never land on — free-rect splits for uniform 2x2 items only ever
    // produce corners at (0,0)/(2,0)/(0,2)/(2,2), never (0.5, 0.5). If this
    // shows up in any trip's placed list, options.pinned leaked onto it.
    const globalPin: PinnedPlacement = {
      id: 'global-pin',
      itemId: 'a',
      name: 'Груз',
      x: 0.5,
      y: 0.5,
      width: 2,
      length: 2,
      layers: 1,
      rotated: false,
      color: '#0ea5e9',
    }
    const trips = packMultiTrip(4, 4, items, { gap: 0, pinned: [globalPin] }, 10, {})
    expect(trips.length).toBe(2)
    const leaked = trips.some((t) => t.placed.some((p) => p.x === 0.5 && p.y === 0.5))
    expect(leaked).toBe(false)
  })

  it('returns one empty trip instead of an empty array when there is no cargo', () => {
    const trips = packMultiTrip(10, 10, [], {}, 5)
    expect(trips).toHaveLength(1)
    expect(trips[0].placedCount).toBe(0)
    expect(trips[0].requestedCount).toBe(0)
  })
})
