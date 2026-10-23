// Whether a stack on the open trip is selected (spec 6.4): a manual stack by
// its id, a pinned stack by its pin's id, and a stack the auto-packer placed
// (no pin yet) by its key — the trip, cargo and position it was selected at
// (autoPlacementKey).
export interface StackSelection {
  pinIds: readonly string[]
  manualIds: readonly string[]
  autoKeys: readonly string[]
}

export function isStackSelected(
  stack: { placementId?: string; autoKey?: string },
  mode: 'auto' | 'manual',
  selection: StackSelection
): boolean {
  if (mode === 'manual') return !!stack.placementId && selection.manualIds.includes(stack.placementId)
  if (stack.placementId) return selection.pinIds.includes(stack.placementId)
  return !!stack.autoKey && selection.autoKeys.includes(stack.autoKey)
}

// A press moves cargo only once the pointer has travelled this far (CSS px):
// a click that wobbles a pixel or two is still a click, not a drag. In 3D a
// "click" after a longer travel was the end of a camera turn, not a choice
// of the stack.
export const DRAG_THRESHOLD_PX = 4
