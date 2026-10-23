'use client'

import { toast } from 'sonner'
import type { usePlacementActions } from '@/hooks/usePlacementActions'
import { isPipeShape, stackHeightBudget, type CargoItem, type CompositionSegment, type ManualPlacement, type PinnedPlacement } from '@/lib/packing'
import { placementConcatComposition, segmentsOf, stackHeight } from '@/lib/placementComposition'
import { roundForDisplay, UNIT_LABEL, useCalculator } from '@/store/calculator'

type PlacementActions = ReturnType<typeof usePlacementActions>

// Dragging one stack onto another to make one stack of them (spec 6.7): the
// drop itself and what it would give, shown while the drag is on the target.
// Moved out of page.tsx as it was (spec 12.3).
export function useMergeActions({
  clampedTripIndex,
  pinnedPlacements,
  checkLayerChange,
  checkStackHeight,
}: {
  clampedTripIndex: number
  // The open trip's pins.
  pinnedPlacements: PinnedPlacement[]
  // The same checks «+» makes on a stack.
  checkLayerChange: PlacementActions['checkLayerChange']
  checkStackHeight: PlacementActions['checkStackHeight']
}) {
  const deck = useCalculator((s) => s.deck)
  const items = useCalculator((s) => s.items)
  const mode = useCalculator((s) => s.mode)
  const manualPlacements = useCalculator((s) => s.manualPlacements)
  const updateManualPlacement = useCalculator((s) => s.updateManualPlacement)
  const removeManualPlacement = useCalculator((s) => s.removeManualPlacement)
  const updatePinned = useCalculator((s) => s.updatePinned)
  const removePinned = useCalculator((s) => s.removePinned)

  // Round 24 (merge switch-on): drag one placement onto another — target
  // absorbs the dragged one's ENTIRE physical composition via
  // placementConcatComposition, instead of the pre-Round-24 flat
  // mergedPlacementWeight/layers arithmetic that blended two different
  // items' weight into a single scalar and lost per-constituent identity
  // (the original Round 10 bug this whole migration exists to fix).
  // `composition` is the source of truth for the merge result; `layers`/
  // `weight` are DERIVED from it, never computed independently. The
  // target's itemId always survives as the nominal identity, regardless of
  // whether target or dragged was itself already composed.
  //
  // Quantity semantics — planComposedMerge itself never mutates catalog
  // quantity (it only VALIDATES it via checkLayerChange, exactly as `+`
  // does). Whether a merge ALSO moves catalog quantity between the two
  // items is a separate, narrower decision, split by whether composition is
  // actually involved — see legacyStandaloneCrossItemQuantityTransfer right
  // below this function for the full explanation and the exact boundary
  // (pure standalone cross-item merge that drains the dragged item: legacy
  // transfer, collapsed into the target; any other merge — partial, or with
  // a `composition` on either side: no transfer at all, on purpose). This
  // does not reinterpret
  // the Round 16 quantity-direction invariant (remove/unpin still decreases
  // quantity, never restores it) in either case.
  const planComposedMerge = (
    target: { id: string; itemId: string; layers: number; composition?: CompositionSegment[]; rotationLocked?: boolean },
    dragged: { id: string; itemId: string; layers: number; composition?: CompositionSegment[]; rotationLocked?: boolean }
  ):
    | { ok: true; composition: CompositionSegment[] | undefined; itemId: string; layers: number; weight: number; rotationLocked: boolean }
    | { ok: false; reason: string } => {
    const targetComposition = segmentsOf(target)
    const draggedComposition = segmentsOf(dragged)
    const distinctIds = Array.from(new Set([...targetComposition, ...draggedComposition].map((s) => s.itemId)))
    const sumLayersOfId = (segs: CompositionSegment[], id: string) =>
      segs.filter((s) => s.itemId === id).reduce((sum, s) => sum + s.layers, 0)

    if (distinctIds.length > 1) {
      // Pipe-shape/dimension/category compatibility — generalized from the
      // old reconcileCrossItemMerge's single-pair check to the FULL
      // constituent set on BOTH sides. A merge between two placements that
      // happen to share the same NOMINAL itemId used to skip this check
      // entirely even when their non-nominal constituents actually
      // differed — a transitive gap the Round 24 investigation identified
      // (e.g. composed(A+B) onto composed(A+C) with B/C incompatible,
      // hidden behind the matching nominal A on both sides).
      const catalogItems = distinctIds.map((id) => items.find((it) => it.id === id))
      const missingIndex = catalogItems.findIndex((it) => !it)
      if (missingIndex !== -1) return { ok: false, reason: 'Груз не найден' }
      const resolved = catalogItems as NonNullable<(typeof catalogItems)[number]>[]
      const first = resolved[0]
      for (const it of resolved) {
        if (!isPipeShape(it)) return { ok: false, reason: 'Объединение перетаскиванием доступно только для труб' }
        if (it.width !== first.width || it.length !== first.length) {
          return { ok: false, reason: `«${it.name}» и «${first.name}» — разные размеры труб, объединить нельзя` }
        }
        if (it.category !== first.category) {
          return { ok: false, reason: `«${it.name}» и «${first.name}» — разные категории груза, объединить нельзя` }
        }
      }
    }

    // Per-constituent maxLayers/quantity — reuse checkLayerChange (the same
    // tested primitive `+`/`-` and same-item merge already rely on), once
    // per distinct itemId across the COMBINED result. currentLayers=0 and
    // delta=combinedOwnLayers makes it check the new total for that item
    // directly; excluding target+dragged drops their current (about to be
    // replaced) layers from the "already placed elsewhere" sum.
    for (const id of distinctIds) {
      const combinedOwnLayers = sumLayersOfId(targetComposition, id) + sumLayersOfId(draggedComposition, id)
      const check = checkLayerChange(id, 0, combinedOwnLayers, [target.id, dragged.id])
      if (!check.ok) return { ok: false, reason: check.reason ?? 'Невозможно объединить' }
    }

    const newComposition = placementConcatComposition(targetComposition, draggedComposition)
    const height = checkStackHeight(newComposition)
    if (!height.ok) return height
    const newLayers = newComposition.reduce((sum, s) => sum + s.layers, 0)
    const newWeightTotal = newComposition.reduce((sum, s) => sum + s.layers * (items.find((it) => it.id === s.itemId)?.weight ?? 0), 0)
    const newWeight = newWeightTotal / Math.max(1, newLayers)

    // Rotation: most-restrictive-wins across EVERY constituent on BOTH
    // sides (the pre-Round-24 code only ever checked the dragged side's
    // NOMINAL item) — keeps the existing sticky rotationLocked flag/field
    // architecture unchanged, just widens what feeds into it.
    const anyNonRotatable = distinctIds.some((id) => items.find((it) => it.id === id)?.allowRotation === false)
    const rotationLocked = Boolean(target.rotationLocked || dragged.rotationLocked || anyNonRotatable)

    if (newComposition.length === 1) {
      // Collapse back to the plain/uncomposed representation — the data
      // model's invariant is that `composition` only exists for 2+ segments.
      return { ok: true, composition: undefined, itemId: newComposition[0].itemId, layers: newLayers, weight: newWeight, rotationLocked }
    }
    return { ok: true, composition: newComposition, itemId: target.itemId, layers: newLayers, weight: newWeight, rotationLocked }
  }

  // Round 24 corrective pass: the pre-Round-24 reconcileCrossItemMerge did
  // ONE more thing besides the physical checks planComposedMerge above now
  // owns — it moved catalog quantity from the dragged item to the target
  // item, since the old blended-weight representation could only attribute
  // a merged stack to ONE catalog item (the survivor), and moving quantity
  // was the only way to keep both items' own "Кол-во" truthful under that
  // constraint. That is a LEGACY contract this pass deliberately preserves
  // byte-for-byte for the exact case it originally covered — a pure
  // standalone (uncomposed on BOTH sides) cross-item merge — since nothing
  // about composition existing elsewhere in the app changes what a plain,
  // never-composed merge has always done.
  //
  // The moment EITHER side already carries a `composition`, this must NOT
  // fire: composition already tracks each constituent's units individually
  // (see planComposedMerge's own doc comment), so transferring quantity on
  // top of that would incorrectly shrink/zero a constituent's catalog
  // quantity even though its units remain legitimately placed — just now
  // nested inside a placement's composition instead of standing alone. This
  // is a strict superset-safe split, not a new quantity rule: a same-item
  // merge (target.itemId === dragged.itemId) never transferred quantity
  // either, before or after Round 24 — only a genuine cross-item, fully
  // uncomposed merge does. Does not touch remove/unpin's own quantity
  // semantics (Round 16's decrease-only contract, untouched) or removeItem.
  //
  // Round 34: ...and it only ever applies when it DRAINS the dragged item
  // (Round 31's collapse below — the dragged units become the target's). A
  // partial transfer used to fire on top of the composition planComposedMerge
  // builds for every cross-item merge, so the moved units were counted twice:
  // once inside the composition under the dragged item, once more as the
  // target's quantity — AUTO then placed a ghost stack (24 units on deck from
  // 17, weight inflated to match) and the dragged item showed "8/1 разм.".
  // The composition alone already accounts for every unit, exactly as for the
  // composed case above.
  //
  // legacyCrossItemTransferOf is the ONE place that decides whether that
  // transfer applies (and by how much) — shared by planMerge (which needs to
  // know in advance) and the applier below, so the two can't disagree.
  const legacyCrossItemTransferOf = (
    target: { itemId: string; layers: number; composition?: CompositionSegment[] },
    dragged: { itemId: string; layers: number; composition?: CompositionSegment[] }
  ) => {
    if (target.composition || dragged.composition) return null
    if (target.itemId === dragged.itemId) return null
    const store = useCalculator.getState()
    const draggedItem = store.items.find((it) => it.id === dragged.itemId)
    const targetItem = store.items.find((it) => it.id === target.itemId)
    if (!draggedItem || !targetItem) return null
    const delta = dragged.layers
    const remaining = draggedItem.quantity - delta
    if (remaining > 0) return null
    return { draggedItem, targetItem, delta, remaining }
  }

  const legacyStandaloneCrossItemQuantityTransfer = (
    target: { itemId: string; layers: number; composition?: CompositionSegment[] },
    dragged: { itemId: string; layers: number; composition?: CompositionSegment[] }
  ) => {
    const transfer = legacyCrossItemTransferOf(target, dragged)
    if (!transfer) return
    const store = useCalculator.getState()
    // A transfer only ever drains the dragged item (see above).
    store.removeItem(transfer.draggedItem.id)
    store.updateItem(transfer.targetItem.id, { quantity: transfer.targetItem.quantity + transfer.delta })
  }

  // Round 31 (fixes the "orphan constituent" the e2e suite caught): when the
  // legacy transfer takes the dragged item's ENTIRE remaining quantity it
  // deletes that item from the catalog (removeItem) — yet planComposedMerge's
  // result still lists it as a composition segment, so the merged placement
  // ended up pointing at an item that no longer exists, while the target's
  // quantity (which now includes the transferred units) was only half
  // covered by composition. AUTO mode then placed the "missing" units as a
  // ghost second stack (counts like 24/16). In that one case the dragged
  // units simply BECOME the target item's units — exactly what the
  // transferred quantity says — so the result collapses to a plain placement
  // of the target item, and the target's own limits (cap / height /
  // quantity incl. the transferred units) are re-checked for the merged
  // total instead of for the two halves separately. Every other merge
  // (partial transfer, same item, anything composed) is untouched.
  const planMerge = (
    target: Parameters<typeof planComposedMerge>[0],
    dragged: Parameters<typeof planComposedMerge>[1]
  ): ReturnType<typeof planComposedMerge> => {
    const plan = planComposedMerge(target, dragged)
    if (!plan.ok) return plan
    const transfer = legacyCrossItemTransferOf(target, dragged)
    if (!transfer) return plan
    const merged = checkLayerChange(target.itemId, 0, plan.layers, [target.id, dragged.id], transfer.delta)
    if (!merged.ok) return { ok: false, reason: merged.reason ?? 'Невозможно объединить' }
    return { ...plan, composition: undefined, itemId: target.itemId, weight: transfer.targetItem.weight ?? 0 }
  }

  const handleMergePinned = (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return
    const dragged = pinnedPlacements.find((p) => p.id === draggedId)
    const target = pinnedPlacements.find((p) => p.id === targetId)
    if (!dragged || !target) return
    const plan = planMerge(target, dragged)
    if (!plan.ok) {
      toast.warning(plan.reason)
      return
    }
    legacyStandaloneCrossItemQuantityTransfer(target, dragged)
    updatePinned(clampedTripIndex, target.id, {
      composition: plan.composition,
      itemId: plan.itemId,
      layers: plan.layers,
      weight: plan.weight,
      rotationLocked: plan.rotationLocked,
      locked: true,
    })
    removePinned(clampedTripIndex, dragged.id)
    toast.success(`Объединено: ${plan.layers} яр. груза «${target.name}»`)
  }


  const handleMergeManual = (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return
    const dragged = manualPlacements.find((m) => m.id === draggedId)
    const target = manualPlacements.find((m) => m.id === targetId)
    if (!dragged || !target) return
    const plan = planMerge(target, dragged)
    if (!plan.ok) {
      toast.warning(plan.reason)
      return
    }
    legacyStandaloneCrossItemQuantityTransfer(target, dragged)
    updateManualPlacement(target.id, {
      composition: plan.composition,
      itemId: plan.itemId,
      layers: plan.layers,
      weight: plan.weight,
      rotationLocked: plan.rotationLocked,
    })
    removeManualPlacement(dragged.id)
    toast.success(`Объединено: ${plan.layers} яр. груза «${target.name}»`)
  }

  // What a drag-to-merge would give, named next to its target while the
  // drag is on it (spec 6.7): «Объединить: 16 яр., 4 м из 6 м», or why it
  // can't be done — the same check, in the same words, as the drop itself.
  const previewMerge = (draggedId: string, targetId: string): { ok: boolean; text: string } | null => {
    const placements: (ManualPlacement | PinnedPlacement)[] = mode === 'manual' ? manualPlacements : pinnedPlacements
    const dragged = placements.find((p) => p.id === draggedId)
    const target = placements.find((p) => p.id === targetId)
    if (!dragged || !target) return null
    const plan = planMerge(target, dragged)
    if (!plan.ok) return { ok: false, text: plan.reason }
    const segs = plan.composition ?? [{ itemId: plan.itemId, layers: plan.layers }]
    const constituents = [...new Set(segs.map((seg) => seg.itemId))]
      .map((id) => items.find((it) => it.id === id))
      .filter((it): it is CargoItem => !!it)
    const height = stackHeight(segs, items)
    const budget = stackHeightBudget(constituents, deck.clearance, deck.unit)
    const unitLabel = UNIT_LABEL[deck.unit]
    const heightText =
      height > 0
        ? `, ${roundForDisplay(height)} ${unitLabel}${Number.isFinite(budget) ? ` из ${roundForDisplay(budget)} ${unitLabel}` : ''}`
        : ''
    return { ok: true, text: `Объединить: ${plan.layers} яр.${heightText}` }
  }

  return { handleMergePinned, handleMergeManual, previewMerge }
}
