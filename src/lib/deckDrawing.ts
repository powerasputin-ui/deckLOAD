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

export type HullSide = 'bow' | 'stern' | 'port' | 'starboard'
export type DrawingEdge = 'top' | 'right' | 'bottom' | 'left'

export const HULL_SIDE_LABEL: Record<HullSide, string> = {
  bow: 'НОС',
  stern: 'КОРМА',
  port: 'ЛЕВЫЙ БОРТ',
  starboard: 'ПРАВЫЙ БОРТ',
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
