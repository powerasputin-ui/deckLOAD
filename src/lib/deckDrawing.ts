// The deck drawn as a plan (spec 6.1): which edge of the drawing each side of
// the hull lies on, and the scale bar.
//
// The sides follow the stability model (stability.ts), so the labels always
// agree with the list and trim it reports: the deck's x (its width) runs from
// port to starboard, and the bow is at the +y or −y end of its length per
// deckForwardIsPositiveY. The long side of the deck lies along the drawing's
// horizontal: a deck longer than it is wide is drawn transposed, deck y along
// screen x.
//
// Transposing is a reflection, so in two of the four cases (not transposed
// with the bow at +y, the bow then at the bottom, and transposed with the
// bow at −y, the bow on the left) the plan was the mirror image of the deck
// seen from above: port where a general arrangement shows starboard, and a
// photo under the plan against the labels. Decided 2026-11-07: in those two
// the deck's x runs the other way on the drawing (deckDrawnMirrored), so
// the plan is the deck seen from above in every orientation — on screen, in
// the PDF and in 3D alike. The deck's own coordinates, and with them every
// calculation, don't change.

import type { ObjectKind } from './objectKind'

export type HullSide = 'bow' | 'stern' | 'port' | 'starboard'
export type DrawingEdge = 'top' | 'right' | 'bottom' | 'left'

export const HULL_SIDE_LABEL: Record<HullSide, string> = {
  bow: 'НОС',
  stern: 'КОРМА',
  port: 'ЛЕВЫЙ БОРТ',
  starboard: 'ПРАВЫЙ БОРТ',
}

// A fixed platform has no bow and no board (spec 2026-11-06, 5): its sides
// go by the compass, north at the end a vessel's bow would be.
export const COMPASS_SIDE_LABEL: Record<HullSide, string> = {
  bow: 'СЕВЕР',
  stern: 'ЮГ',
  port: 'ЗАПАД',
  starboard: 'ВОСТОК',
}

export function sideLabels(kind?: ObjectKind): Record<HullSide, string> {
  return kind === 'fixed' ? COMPASS_SIDE_LABEL : HULL_SIDE_LABEL
}

// The deck's own fields and lines in the same words: a semi-submersible has
// a bow and boards as a vessel has.
export interface DeckWords {
  width: string
  length: string
  offset: string
  // «Нос на схеме: снизу», and the deck's line «нос справа».
  bowOnDrawing: string
  bow: string
}

// An area's own level (LoadZone.elevationM) as its label carries it:
// « · +3 м», « · −1.5 м»; nothing for an area at the deck's level.
export function zoneLevelSuffix(elevationM: number | undefined): string {
  if (elevationM === undefined || !Number.isFinite(elevationM) || elevationM === 0) return ''
  return ` · ${elevationM > 0 ? '+' : '−'}${Math.round(Math.abs(elevationM) * 100) / 100} м`
}

export function deckWords(kind?: ObjectKind): DeckWords {
  return kind === 'fixed'
    ? { width: 'Ширина (запад–восток)', length: 'Длина (юг–север)', offset: 'Отступ от края', bowOnDrawing: 'Север на схеме', bow: 'север' }
    : { width: 'Ширина (борт–борт)', length: 'Длина (нос–корма)', offset: 'Отступ от борта', bowOnDrawing: 'Нос на схеме', bow: 'нос' }
}

// For «Нос на схеме: снизу».
export const DRAWING_EDGE_WORD: Record<DrawingEdge, string> = {
  top: 'сверху',
  right: 'справа',
  bottom: 'снизу',
  left: 'слева',
}

export function deckDrawnTransposed(deckWidth: number, deckLength: number): boolean {
  return deckLength > deckWidth
}

// Whether the deck's x (port → starboard) runs right to left on the drawing
// — bottom to top when it is drawn transposed — so the plan stays the deck
// seen from above: with the bow at the bottom, port is on the right; with
// the bow on the left, port is at the bottom.
export function deckDrawnMirrored(deckWidth: number, deckLength: number, forwardIsPositiveY: boolean): boolean {
  return deckDrawnTransposed(deckWidth, deckLength) !== forwardIsPositiveY
}

// A move the way it points on the drawing, as a move along the deck's own
// axes: on a deck drawn transposed the screen's x is the deck's y (its
// length) and the screen's y its x; mirrored, the deck's x runs against it.
export function drawingToDeckMove(
  screenX: number,
  screenY: number,
  deckWidth: number,
  deckLength: number,
  forwardIsPositiveY = true
): { dx: number; dy: number } {
  const sign = deckDrawnMirrored(deckWidth, deckLength, forwardIsPositiveY) ? -1 : 1
  return deckDrawnTransposed(deckWidth, deckLength) ? { dx: sign * screenY, dy: screenX } : { dx: sign * screenX, dy: screenY }
}

export function hullSideEdges(
  deckWidth: number,
  deckLength: number,
  forwardIsPositiveY: boolean
): Record<HullSide, DrawingEdge> {
  const transposed = deckDrawnTransposed(deckWidth, deckLength)
  // Deck x runs left → right on the drawing (top → bottom when transposed),
  // the other way when mirrored; deck y top → bottom (left → right when
  // transposed).
  const across: DrawingEdge[] = transposed ? ['top', 'bottom'] : ['left', 'right']
  const [xLow, xHigh] = deckDrawnMirrored(deckWidth, deckLength, forwardIsPositiveY) ? [across[1], across[0]] : across
  const [yLow, yHigh]: DrawingEdge[] = transposed ? ['left', 'right'] : ['top', 'bottom']
  return {
    port: xLow,
    starboard: xHigh,
    bow: forwardIsPositiveY ? yHigh : yLow,
    stern: forwardIsPositiveY ? yLow : yHigh,
  }
}

const SCALE_BAR_STEPS = [1, 2, 5, 10, 20, 50]

// How many grid steps the scale bar spans: whichever of 1, 2, 5, 10, 20, 50
// draws closest to `targetPx` on screen (closest by ratio).
export function scaleBarSteps(stepPx: number, targetPx = 96): number {
  if (!(stepPx > 0)) return 1
  const off = (n: number) => Math.abs(Math.log((n * stepPx) / targetPx))
  return SCALE_BAR_STEPS.reduce((best, n) => (off(n) < off(best) ? n : best))
}

// A footprint's own outline on the drawing. `outline` is in the deck's
// units, from the footprint's corner nearest the deck's origin, unturned
// (`turned` — the cargo stands turned a quarter: the outline's own length
// runs across the deck); `box` is where the footprint is drawn, `k` drawing
// units per deck unit. Taken through the same transpose and mirror as the
// deck itself (decided 2026-11-07): a drawn shape or a triangle used to be
// laid on the box as if the deck were never transposed.
export function footprintOutlineOnDrawing(
  outline: readonly { x: number; y: number }[],
  box: { x: number; y: number; w: number; h: number },
  k: number,
  view: { transposed: boolean; mirrored: boolean },
  turned: boolean
): { x: number; y: number }[] {
  // The footprint's extent along the deck's x and y.
  const across = (view.transposed ? box.h : box.w) / k
  const along = (view.transposed ? box.w : box.h) / k
  // Turned, the unturned outline spans along × across: its own width runs
  // along the deck now.
  const local = turned ? turnOutline(outline, along, across) : outline
  return local.map((q) => {
    const x = view.mirrored ? across - q.x : q.x
    return view.transposed ? { x: box.x + q.y * k, y: box.y + x * k } : { x: box.x + x * k, y: box.y + q.y * k }
  })
}

// A quarter turn of an outline that spans width × length — packing.ts's
// rotateOutline90 to the letter (deckDrawing.test.ts holds them together),
// kept here so the drawing doesn't import the packer.
export function turnOutline(outline: readonly { x: number; y: number }[], _width: number, length: number): { x: number; y: number }[] {
  return outline.map((p) => ({ x: length - p.y, y: p.x }))
}

export type Corner = 'nw' | 'ne' | 'sw' | 'se'

// The deck-local corner (n: y low, s: y high, w: x low, e: x high) under a
// corner of a rectangle as it is drawn (n: top, s: bottom, w: left, e:
// right): transposed, the screen's x is the deck's y; mirrored, the deck's
// x runs against the screen.
export function deckCornerOfScreenCorner(k: Corner, transposed: boolean, mirrored: boolean): Corner {
  const screenRight = k[1] === 'e'
  const screenBottom = k[0] === 's'
  const yHigh = transposed ? screenRight : screenBottom
  const viewXHigh = transposed ? screenBottom : screenRight
  const xHigh = mirrored ? !viewXHigh : viewXHigh
  return `${yHigh ? 's' : 'n'}${xHigh ? 'e' : 'w'}` as Corner
}
