import { describe, it, expect } from 'vitest'
import { deckCornerOfScreenCorner, deckDrawnMirrored, deckDrawnTransposed, drawingToDeckMove, footprintOutlineOnDrawing, hullSideEdges, scaleBarSteps, turnOutline, zoneLevelSuffix } from './deckDrawing'
import { rotateOutline90 } from './packing'

describe('an area\'s level on its label', () => {
  it('signs it, rounds it to the centimetre, and says nothing at the deck\'s level', () => {
    expect(zoneLevelSuffix(3)).toBe(' · +3 м')
    expect(zoneLevelSuffix(-1.256)).toBe(' · −1.26 м')
    expect(zoneLevelSuffix(0)).toBe('')
    expect(zoneLevelSuffix(undefined)).toBe('')
    expect(zoneLevelSuffix(Number.NaN)).toBe('')
  })
})

// Decided 2026-11-07: the plan is the deck seen from above in every
// orientation — looking down with the bow up, port is on the left; with the
// bow down, on the right; with the bow right, at the top; left, at the bottom.
describe('hull sides on the drawing', () => {
  it('a deck wider than long (20 m across, 8 m fore and aft) keeps bow and stern on its long edges, top and bottom', () => {
    expect(deckDrawnTransposed(20, 8)).toBe(false)
    expect(hullSideEdges(20, 8, false)).toEqual({ port: 'left', starboard: 'right', bow: 'top', stern: 'bottom' })
    // The bow at the bottom: turned half round, port is on the right.
    expect(hullSideEdges(20, 8, true)).toEqual({ port: 'right', starboard: 'left', bow: 'bottom', stern: 'top' })
    expect(deckDrawnMirrored(20, 8, true)).toBe(true)
    expect(deckDrawnMirrored(20, 8, false)).toBe(false)
  })

  it('a deck longer than wide is drawn transposed: bow and stern left and right, sides top and bottom', () => {
    expect(deckDrawnTransposed(16, 51)).toBe(true)
    expect(hullSideEdges(16, 51, true)).toEqual({ port: 'top', starboard: 'bottom', bow: 'right', stern: 'left' })
    // The bow on the left: port is at the bottom.
    expect(hullSideEdges(16, 51, false)).toEqual({ port: 'bottom', starboard: 'top', bow: 'left', stern: 'right' })
    expect(deckDrawnMirrored(16, 51, true)).toBe(false)
    expect(deckDrawnMirrored(16, 51, false)).toBe(true)
  })

  it('in all four, port lies a quarter turn to the left of the bow, as seen from above', () => {
    const clockwise = ['top', 'right', 'bottom', 'left']
    for (const [w, l] of [[20, 8], [16, 51]])
      for (const forward of [true, false]) {
        const e = hullSideEdges(w, l, forward)
        expect(clockwise[(clockwise.indexOf(e.bow) + 3) % 4]).toBe(e.port)
        expect(clockwise[(clockwise.indexOf(e.bow) + 1) % 4]).toBe(e.starboard)
      }
  })

  it('a square deck is not transposed', () => {
    expect(hullSideEdges(10, 10, true).bow).toBe('bottom')
  })
})

describe('a move on the drawing', () => {
  it('on a deck drawn transposed, right on screen is along the deck and down is across it', () => {
    expect(drawingToDeckMove(0.1, 0, 8, 20)).toEqual({ dx: 0, dy: 0.1 })
    expect(drawingToDeckMove(0, -1, 8, 20)).toEqual({ dx: -1, dy: 0 })
    // The bow on the left: down on screen is toward port.
    expect(drawingToDeckMove(0, 1, 8, 20, false)).toEqual({ dx: -1, dy: 0 })
  })

  it('on a deck drawn as it is, the screen and the deck agree — but the deck\'s x runs right to left with the bow at the bottom', () => {
    expect(drawingToDeckMove(0.1, 0, 20, 8, false)).toEqual({ dx: 0.1, dy: 0 })
    expect(drawingToDeckMove(0, 1, 20, 8, false)).toEqual({ dx: 0, dy: 1 })
    expect(drawingToDeckMove(0.1, 0, 20, 8)).toEqual({ dx: -0.1, dy: 0 })
  })
})

describe('scale bar', () => {
  it('spans the number of grid steps that draws closest to the target length', () => {
    expect(scaleBarSteps(32)).toBe(2) // 64 px beats 160 px for a 96 px target
    expect(scaleBarSteps(96)).toBe(1)
    expect(scaleBarSteps(10)).toBe(10)
    expect(scaleBarSteps(1)).toBe(50)
  })

  it('falls back to one step when the step has no size', () => {
    expect(scaleBarSteps(0)).toBe(1)
    expect(scaleBarSteps(Number.NaN)).toBe(1)
  })
})

// Decided 2026-11-07: a footprint's own outline goes on the drawing through
// the deck's transpose and mirror, as its corners do.
describe('a footprint\'s outline on the drawing', () => {
  // An L of 2 × 1 deck units, its foot toward the deck's +x.
  const L = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 0.5 },
    { x: 2, y: 0.5 },
    { x: 2, y: 1 },
    { x: 0, y: 1 },
  ]

  it('turns as the packer turns it', () => {
    expect(turnOutline(L, 2, 1)).toEqual(rotateOutline90(L, 2, 1))
  })

  it('as it is on a deck drawn as it is', () => {
    expect(footprintOutlineOnDrawing(L, { x: 10, y: 20, w: 20, h: 10 }, 10, { transposed: false, mirrored: false }, false)).toEqual(
      L.map((q) => ({ x: 10 + q.x * 10, y: 20 + q.y * 10 }))
    )
  })

  it('its x runs the other way on a mirrored deck, and along the screen\'s y on a transposed one', () => {
    const mirrored = footprintOutlineOnDrawing(L, { x: 0, y: 0, w: 2, h: 1 }, 1, { transposed: false, mirrored: true }, false)
    expect(mirrored).toEqual(L.map((q) => ({ x: 2 - q.x, y: q.y })))
    // Transposed: the box is 1 wide on screen (the deck's y) and 2 high (its x).
    const transposed = footprintOutlineOnDrawing(L, { x: 0, y: 0, w: 1, h: 2 }, 1, { transposed: true, mirrored: false }, false)
    expect(transposed).toEqual(L.map((q) => ({ x: q.y, y: q.x })))
    // Both: the deck's x runs up the screen.
    const both = footprintOutlineOnDrawing(L, { x: 0, y: 0, w: 1, h: 2 }, 1, { transposed: true, mirrored: true }, false)
    expect(both).toEqual(L.map((q) => ({ x: q.y, y: 2 - q.x })))
  })

  it('turned, it fills its turned box', () => {
    // Turned, the 2 × 1 L stands 1 across and 2 along the deck.
    const pts = footprintOutlineOnDrawing(L, { x: 0, y: 0, w: 1, h: 2 }, 1, { transposed: false, mirrored: false }, true)
    expect(pts).toEqual(rotateOutline90(L, 2, 1))
    expect(Math.max(...pts.map((p) => p.x))).toBe(1)
    expect(Math.max(...pts.map((p) => p.y))).toBe(2)
  })
})

describe('a drawn corner\'s corner on the deck', () => {
  it('is itself on a deck drawn as it is, and across the diagonal when transposed (as before)', () => {
    for (const k of ['nw', 'ne', 'sw', 'se'] as const) expect(deckCornerOfScreenCorner(k, false, false)).toBe(k)
    expect([deckCornerOfScreenCorner('nw', true, false), deckCornerOfScreenCorner('ne', true, false), deckCornerOfScreenCorner('sw', true, false), deckCornerOfScreenCorner('se', true, false)]).toEqual(['nw', 'sw', 'ne', 'se'])
  })

  it('swaps the deck\'s port and starboard ends when mirrored', () => {
    expect(deckCornerOfScreenCorner('nw', false, true)).toBe('ne')
    expect(deckCornerOfScreenCorner('se', false, true)).toBe('sw')
    // Transposed and mirrored: the screen's top-left is the deck's stern-starboard.
    expect(deckCornerOfScreenCorner('nw', true, true)).toBe('ne')
    expect(deckCornerOfScreenCorner('sw', true, true)).toBe('nw')
  })
})
