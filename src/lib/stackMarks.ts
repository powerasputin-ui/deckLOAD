// The marks in a stack's corners (spec 6.3), measured in screen pixels: the
// deck draws them at these sizes, the plan on paper (planDrawing.ts) at a
// fixed fraction of them. They keep INSET from the stack's edges.
export const INSET = 2

// «!» in a red triangle, top left: a stack over an overloaded load zone.
export const OVERLOAD_MARK = { w: 16, h: 14 }

// A badge in a stack's corner: 14 × 14, a white glyph on it.
export const BADGE = 14

// Where the corner marks go on a stack `w` × `h` screen px whose label
// takes `labelW` × `labelH` px in its middle (0 × 0 without one): a mark is
// drawn only where it leaves the number clear (spec 6.2 — the number comes
// first). The stack's outline still shows a lock (dashed) and a problem
// (red); «Проверки» and the inspector list everything.
export function cornerMarksFit(w: number, h: number, labelW: number, labelH: number) {
  // Clear of the label sideways when its inner edge is `edge` px from the
  // stack's side, or above or below it when `edge` px from the top or bottom.
  const clear = (sideways: number, upright: number) =>
    labelW === 0 || (w - labelW) / 2 >= sideways || (h - labelH) / 2 >= upright
  const holds = (mw: number, mh: number) => w >= mw + 2 * INSET && h >= mh + 2 * INSET
  return {
    overload: holds(OVERLOAD_MARK.w, OVERLOAD_MARK.h) && clear(OVERLOAD_MARK.w + INSET, OVERLOAD_MARK.h + INSET),
    badge: holds(BADGE, BADGE) && clear(BADGE + INSET, BADGE + INSET),
    // A second badge beside the first one in the bottom left corner.
    secondBadge: holds(2 * BADGE + INSET, BADGE) && clear(2 * BADGE + 2 * INSET, BADGE + INSET),
    mixed: holds(12, 12) && clear(36, 15),
    rotated: holds(12, 12) && clear(17, 14),
  }
}
