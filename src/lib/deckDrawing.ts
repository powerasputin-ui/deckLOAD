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
// with the bow at +y — the demo deck — and transposed with the bow at −y) the
// plan is the mirror image of the deck seen from above. The labels still say
// where each side really is in the calculation; flipping the drawing itself
// changes the canvas transform and is left to stage 2.

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

// A move the way it points on the drawing, as a move along the deck's own
// axes: on a deck drawn transposed the screen's x is the deck's y (its
// length) and the screen's y its x.
export function drawingToDeckMove(
  screenX: number,
  screenY: number,
  deckWidth: number,
  deckLength: number
): { dx: number; dy: number } {
  return deckDrawnTransposed(deckWidth, deckLength) ? { dx: screenY, dy: screenX } : { dx: screenX, dy: screenY }
}

export function hullSideEdges(
  deckWidth: number,
  deckLength: number,
  forwardIsPositiveY: boolean
): Record<HullSide, DrawingEdge> {
  const transposed = deckDrawnTransposed(deckWidth, deckLength)
  // Deck x runs left → right on the drawing (top → bottom when transposed),
  // deck y top → bottom (left → right when transposed).
  const [xLow, xHigh]: DrawingEdge[] = transposed ? ['top', 'bottom'] : ['left', 'right']
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
