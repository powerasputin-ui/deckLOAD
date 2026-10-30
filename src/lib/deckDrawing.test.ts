import { describe, it, expect } from 'vitest'
import { deckDrawnTransposed, drawingToDeckMove, hullSideEdges, scaleBarSteps } from './deckDrawing'

describe('hull sides on the drawing', () => {
  it('a deck wider than long (20 m across, 8 m fore and aft) keeps bow and stern on its long edges, top and bottom', () => {
    expect(deckDrawnTransposed(20, 8)).toBe(false)
    expect(hullSideEdges(20, 8, true)).toEqual({ port: 'left', starboard: 'right', bow: 'bottom', stern: 'top' })
    expect(hullSideEdges(20, 8, false)).toEqual({ port: 'left', starboard: 'right', bow: 'top', stern: 'bottom' })
  })

  it('a deck longer than wide is drawn transposed: bow and stern left and right, sides top and bottom', () => {
    expect(deckDrawnTransposed(16, 51)).toBe(true)
    expect(hullSideEdges(16, 51, true)).toEqual({ port: 'top', starboard: 'bottom', bow: 'right', stern: 'left' })
    expect(hullSideEdges(16, 51, false)).toEqual({ port: 'top', starboard: 'bottom', bow: 'left', stern: 'right' })
  })

  it('a square deck is not transposed', () => {
    expect(hullSideEdges(10, 10, true).bow).toBe('bottom')
  })
})

describe('a move on the drawing', () => {
  it('on a deck drawn transposed, right on screen is along the deck and down is across it', () => {
    expect(drawingToDeckMove(0.1, 0, 8, 20)).toEqual({ dx: 0, dy: 0.1 })
    expect(drawingToDeckMove(0, -1, 8, 20)).toEqual({ dx: -1, dy: 0 })
  })

  it('on a deck drawn as it is, the screen and the deck agree', () => {
    expect(drawingToDeckMove(0.1, 0, 20, 8)).toEqual({ dx: 0.1, dy: 0 })
    expect(drawingToDeckMove(0, 1, 20, 8)).toEqual({ dx: 0, dy: 1 })
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
