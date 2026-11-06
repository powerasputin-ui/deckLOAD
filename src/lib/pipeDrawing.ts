// Pipes on the plan, on screen and on paper alike (revision 2026-11-06, the
// drafting look the owner chose over capsules): a pipe seen from above is a
// strip with square ends — only its end is round, and that isn't seen from
// here — and a strip wide enough carries its axis, dash-dot, as a body of
// revolution does on a drawing. Pipes side by side (a pile's base row, a
// штабель's tier) share one outline with a hairline between them, faint
// when they are thin, so forty drill pipes read as a bundle rather than a
// barcode. The label under the number says what the drawing can't: the
// outer diameter, the pipes and the tiers.
import { decomposePipePyramid, isPipeShape, type PlacedItem } from './packing'
import { toMeters, type Unit } from './units'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

type PipeLike = Pick<PlacedItem, 'shape' | 'width' | 'length' | 'height'>

// Lying pipe: a штабель, or a cylinder long for its girth (packing.ts's
// isPipeShape). A cylinder standing on its end — a drum — is round from above
// and keeps its round drawing and its name.
export const drawsAsPipe = (p: PipeLike) => p.shape === 'pipe-nest' || isPipeShape(p)

// The same, from a drawn footprint alone (the stamp's shadow, a pile): round
// cargo is long from above only when it lies.
export const footprintIsPipe = (shape: PlacedItem['shape'], w: number, h: number, count = 1) =>
  shape === 'pipe-nest' || (shape === 'cylinder' && (count > 1 || Math.max(w, h) > 1.5 * Math.min(w, h)))

// The tiers of a pipe stack holding `units`: a pile's rows (the packer's
// pyramid), a штабель's own tiers.
export function pipeTiers(p: Pick<PlacedItem, 'shape' | 'nest'>, units: number): number {
  if (p.shape === 'pipe-nest' && p.nest) return p.nest.tierCounts.length
  return units > 1 ? decomposePipePyramid(units).length : 1
}

// The pipes across a footprint: `count` strips side by side, along screen x
// for 'w' (each strip then as tall as the footprint, the pipes running up and
// down) or along y for 'h'. One strip is the footprint itself, its pipe along
// the longer side.
export function pipeStrips(r: Box, count: number, axis?: 'w' | 'h'): { strips: Box[]; along: 'x' | 'y' } {
  if (count <= 1 || !axis) return { strips: [r], along: r.w >= r.h ? 'x' : 'y' }
  const strips: Box[] = []
  if (axis === 'w') {
    const seg = r.w / count
    for (let i = 0; i < count; i++) strips.push({ x: r.x + i * seg, y: r.y, w: seg, h: r.h })
    return { strips, along: 'y' }
  }
  const seg = r.h / count
  for (let i = 0; i < count; i++) strips.push({ x: r.x, y: r.y + i * seg, w: r.w, h: seg })
  return { strips, along: 'x' }
}

// A strip's width across its pipe.
export const stripAcross = (s: Box, along: 'x' | 'y') => (along === 'x' ? s.h : s.w)

// The hairlines between the strips and the axes along them, as segments.
// `minAxis` is the strip width (in the drawing's units) from which an axis
// is drawn: on a thin pipe it would only blacken the strip.
type Segment = [x1: number, y1: number, x2: number, y2: number]

export function pipeLines(strips: Box[], along: 'x' | 'y', minAxis: number): { between: Segment[]; axes: Segment[] } {
  const between: Segment[] = []
  const axes: Segment[] = []
  strips.forEach((s, i) => {
    if (i > 0) between.push(along === 'y' ? [s.x, s.y, s.x, s.y + s.h] : [s.x, s.y, s.x + s.w, s.y])
    if (stripAcross(s, along) >= minAxis) {
      axes.push(along === 'y' ? [s.x + s.w / 2, s.y, s.x + s.w / 2, s.y + s.h] : [s.x, s.y + s.h / 2, s.x + s.w, s.y + s.h / 2])
    }
  })
  return { between, axes }
}

// The line under a pipe stack's number: the pipe's outer diameter in mm, as
// pipe is named; for a штабель (one unit of the list) the pipes in it; the
// tiers when there are several. A pile's pipe count is the number's «×N».
export function pipeLabelLine(p: PipeLike & Pick<PlacedItem, 'stackedCount' | 'nest'>, unit: Unit): string | undefined {
  if (p.shape === 'pipe-nest' && p.nest) {
    const tiers = p.nest.tierCounts.length
    return [`Ø${Math.round(p.nest.pipeOuterDiameterM * 1000)}`, `${p.nest.pipeCount} шт`, tiers > 1 ? `${tiers} яр.` : undefined].filter(Boolean).join(' · ')
  }
  if (!drawsAsPipe(p)) return undefined
  const mm = Math.round(toMeters(Math.min(p.width, p.length), unit) * 1000)
  const tiers = pipeTiers(p, p.stackedCount)
  return tiers > 1 ? `Ø${mm} · ${tiers} яр.` : `Ø${mm}`
}
