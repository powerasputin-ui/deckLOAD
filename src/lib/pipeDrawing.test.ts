import { describe, it, expect } from 'vitest'
import { footprintIsPipe, pipeLabelLine, pipeLines, pipeStrips, pipeTiers } from './pipeDrawing'
import { decomposePipePyramid, type PlacedItem } from './packing'

// Revision 2026-11-06: pipes drawn as on a drawing — square ends, hairlines,
// dash-dot axes — and labelled by their pipe.
describe('pipe drawing', () => {
  const pipe = (patch: Partial<PlacedItem>) => ({ shape: 'cylinder' as const, stackedCount: 1, width: 12.38, length: 0.957, height: 0.957, ...patch })

  it('labels a pipe by its outer diameter in mm, whatever the deck unit', () => {
    expect(pipeLabelLine(pipe({}), 'm')).toBe('Ø957')
    expect(pipeLabelLine(pipe({ width: 40.62, length: 3.14, height: 3.14 }), 'ft')).toBe('Ø957')
    expect(pipeLabelLine(pipe({ width: 950, length: 15, height: 15 }), 'cm')).toBe('Ø150')
  })

  it('adds a pile\'s tiers; its pipes are the number\'s «×N»', () => {
    const tiers = decomposePipePyramid(20).length
    expect(tiers).toBeGreaterThan(1)
    expect(pipeLabelLine(pipe({ width: 9.5, length: 0.15, height: 0.15, stackedCount: 20 }), 'm')).toBe(`Ø150 · ${tiers} яр.`)
    expect(pipeTiers({ shape: 'cylinder' }, 20)).toBe(tiers)
    expect(pipeTiers({ shape: 'cylinder' }, 1)).toBe(1)
  })

  it('gives a штабель its pipes and tiers, a single tier without «яр.»', () => {
    const nest = { pipeOuterDiameterM: 0.957, pipeLengthM: 12.38, pipeWeightKg: 15000, usableWidthM: 16.9, pipesPerRow: 17, tierCounts: [17, 16], pipeCount: 33, heightM: 2.064, vcgAboveDeckM: 1.107, crateHeightM: 0.15, limited: false, requestedPipeCount: 33, requestedTiers: 2 }
    expect(pipeLabelLine({ shape: 'pipe-nest', stackedCount: 1, width: 16.9, length: 12.38, height: 2.064, nest }, 'm')).toBe('Ø957 · 33 шт · 2 яр.')
    expect(pipeLabelLine({ shape: 'pipe-nest', stackedCount: 1, width: 16.9, length: 12.38, height: 1.1, nest: { ...nest, tierCounts: [17], pipeCount: 17 } }, 'm')).toBe('Ø957 · 17 шт')
  })

  it('says nothing for cargo that isn\'t pipe', () => {
    expect(pipeLabelLine({ shape: undefined, stackedCount: 1, width: 6.06, length: 2.44, height: 2.59 }, 'm')).toBeUndefined()
  })

  it('leaves a drum standing on its end round and named: it is no pipe from above', () => {
    expect(pipeLabelLine(pipe({ width: 0.6, length: 0.6, height: 0.9 }), 'm')).toBeUndefined()
    expect(footprintIsPipe('cylinder', 20, 20)).toBe(false)
    expect(footprintIsPipe('cylinder', 300, 30)).toBe(true)
    expect(footprintIsPipe('cylinder', 40, 30, 3)).toBe(true)
    expect(footprintIsPipe('pipe-nest', 200, 200)).toBe(true)
    expect(footprintIsPipe(undefined, 300, 30)).toBe(false)
  })

  it('splits a footprint into its pipes side by side, with a hairline between each and an axis only on the wide ones', () => {
    const r = { x: 0, y: 0, w: 40, h: 300 }
    const four = pipeStrips(r, 4, 'w')
    expect(four.along).toBe('y')
    expect(four.strips.map((s) => [s.x, s.w, s.h])).toEqual([[0, 10, 300], [10, 10, 300], [20, 10, 300], [30, 10, 300]])
    const lines = pipeLines(four.strips, four.along, 8)
    expect(lines.between).toEqual([[10, 0, 10, 300], [20, 0, 20, 300], [30, 0, 30, 300]])
    expect(lines.axes).toHaveLength(4)
    // Thin pipes: the hairlines, no axes.
    const forty = pipeStrips(r, 40, 'w')
    expect(pipeLines(forty.strips, forty.along, 8)).toMatchObject({ axes: [] })
    // One pipe lies along the footprint's longer side.
    expect(pipeStrips({ x: 0, y: 0, w: 300, h: 30 }, 1).along).toBe('x')
  })
})
