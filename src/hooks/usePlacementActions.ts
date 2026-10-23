'use client'

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import {
  addClearanceMargins,
  clampToDeck,
  collidesWithClearance,
  computeFreeRects,
  computeGridStep,
  lashingPointExclusionRects,
  maxLayersFor,
  pyramidSpreadAsClearance,
  rectInsidePolygon,
  restrictionZoneExclusions,
  rotatePlacementAnywhere,
  stackHeightBudget,
  withClearanceFootprint,
  type CargoItem,
  type CargoShape,
  type ClearanceMargin,
  type CompositionSegment,
  type PackingResult,
  type PinnedPlacement,
  type PlacedItem,
} from '@/lib/packing'
import {
  exceedsHeightBudget,
  placementLayersOfItem,
  placementPop,
  placementPush,
  placementTotalLayers,
  placementTotalWeightKg,
  stackHeight,
} from '@/lib/placementComposition'
import { pluralRu } from '@/lib/utils'
import { roundForDisplay, UNIT_LABEL, useCalculator } from '@/store/calculator'

// What is done to one stack on the deck: turning it, moving it with the
// arrow keys, adding and taking layers, removing it, locking it. Auto-placed
// stacks are pinned first. Moved out of page.tsx as it was (spec 12.3).
export function usePlacementActions({
  clampedTripIndex,
  pinnedPlacements,
  result,
  usableOutline,
  selectedAutoStack,
  viewMode,
  wouldExceedMaxDeckCargo,
}: {
  clampedTripIndex: number
  // The open trip's pins and packing result.
  pinnedPlacements: PinnedPlacement[]
  result: PackingResult
  // The deck's contour less the board offset, on a non-rectangular deck.
  usableOutline: { x: number; y: number }[] | undefined
  // The one purely auto-placed stack selected, if any.
  selectedAutoStack: PlacedItem | undefined
  viewMode: '2d' | '3d'
  wouldExceedMaxDeckCargo: (addedWeightKg: number) => boolean
}) {
  const deck = useCalculator((s) => s.deck)
  const items = useCalculator((s) => s.items)
  const mode = useCalculator((s) => s.mode)
  const manualPlacements = useCalculator((s) => s.manualPlacements)
  const pinnedPlacementsByTrip = useCalculator((s) => s.pinnedPlacementsByTrip)
  const selectedPinIds = useCalculator((s) => s.selectedPinIds)
  const selectedManualIds = useCalculator((s) => s.selectedManualIds)
  const updateManualPlacement = useCalculator((s) => s.updateManualPlacement)
  const removeManualPlacement = useCalculator((s) => s.removeManualPlacement)
  const pinFromPlaced = useCalculator((s) => s.pinFromPlaced)
  const updatePinned = useCalculator((s) => s.updatePinned)
  const removePinned = useCalculator((s) => s.removePinned)

  // Why a stack can't be turned whatever room it has: a cargo in it doesn't
  // allow rotation. The inspector and the mini-panel show it on a disabled
  // «Повернуть» (spec 6.3); Space says it in a toast.
  //
  // rotationLocked (set by a cross-item merge whose dragged item didn't
  // allow rotation) wins even if the placement's own itemId's CargoItem
  // currently allows it — the merge may have folded in units that don't.
  //
  // Round 29 corrective pass: `rotationLocked` alone is NOT proven
  // authoritative for every composed placement — it's correctly
  // maintained by every LIVE creation path (merge/`+`/`-`/removeItem),
  // but hydration only type-checks it (`typeof pin.rotationLocked ===
  // 'boolean'`), never re-derives it from the loaded `composition` +
  // current catalog `allowRotation`. An imported/hand-edited project can
  // carry a composed placement whose `rotationLocked` is stale or absent
  // even though a real constituent disallows rotation — trusting
  // `rotationLocked` alone there would wrongly ALLOW rotating cargo that
  // shouldn't move. For a composed placement, checked live from
  // `composition` + the current catalog (most-restrictive-wins across
  // every constituent, the same check planComposedMerge itself uses) —
  // `rotationLocked` is OR'd in on top, never replaced, so a lock already
  // set by a live merge can only stay at least as restrictive, never
  // become more permissive. An uncomposed placement keeps the exact
  // original single-item check (self.itemId is its own sole identity).
  const rotationBlockReason = (self: {
    itemId: string
    name: string
    rotationLocked?: boolean
    composition?: CompositionSegment[]
  }): string | undefined => {
    const fixed = self.composition
      ?.map((seg) => items.find((it) => it.id === seg.itemId))
      .find((it) => it?.allowRotation === false)
    if (fixed) return `Груз «${fixed.name}» в штабеле не разрешает поворот`
    if (!self.composition && !items.find((it) => it.id === self.itemId)?.allowRotation)
      return `Груз «${self.name}» не разрешает поворот`
    if (self.rotationLocked) return 'Штабель объединён с грузом, который не разрешает поворот'
    return undefined
  }

  // Shared by handleRotatePinned/handleRotateManual below — these two were
  // ~50 lines of near-identical logic each (build `others`, call
  // rotatePlacementAnywhere, re-check rectInsidePolygon, build
  // preciseOthers, call collidesWithClearance), differing only in which
  // store list/updater they touch. A future fix to the rotation-collision
  // logic (e.g. the own-zone-after-rotation check documented below) had to
  // be applied to both copies by hand, with nothing enforcing they stay
  // identical — this collapses them into one implementation.
  const attemptRotate = (
    self: { itemId: string; name: string; x: number; y: number; width: number; length: number; layers: number; rotated: boolean; clearanceMargin?: ClearanceMargin; rotationLocked?: boolean; composition?: CompositionSegment[] },
    siblings: { x: number; y: number; width: number; length: number; clearanceMargin?: ClearanceMargin }[],
    excludeFromResultPlaced: (p: (typeof result.placed)[number]) => boolean,
    commit: (patch: { x: number; y: number; width: number; length: number; rotated: boolean }) => void
  ): void => {
    const blocked = rotationBlockReason(self)
    if (blocked) {
      toast.warning(blocked)
      return
    }
    // Geometry (outline/shape/height, used below for the post-rotation
    // collision check) still needs SOME catalog item — falls back to the
    // first composition segment's own item when the nominal `itemId`
    // doesn't resolve (Tier-1: valid composition, broken nominal identity).
    // Every real composed placement's constituents share one physical
    // shape/footprint by construction (planComposedMerge's own pipe-shape/
    // dimension compatibility gate), so any constituent's own item is an
    // equally valid geometry source — never a guess about which one.
    const item =
      items.find((it) => it.id === self.itemId) ??
      (self.composition ? items.find((it) => it.id === self.composition![0].itemId) : undefined)
    if (!item) {
      // No catalog item at all could be resolved (composed placement whose
      // EVERY constituent is unknown — malformed.invalidComposition would
      // normally already exclude this placement from ever being rendered/
      // selectable, but this stays a safe, explicit fallback rather than
      // reading `undefined` fields below).
      toast.warning(`Груз «${self.name}» повреждён — поворот недоступен`)
      return
    }
    const lashingRects: { x: number; y: number; width: number; length: number; clearanceMargin?: ClearanceMargin }[] = lashingPointExclusionRects(deck.lashingPoints ?? [], deck.gap)
    const zoneRects = restrictionZoneExclusions(deck.restrictionZones ?? [])
    const others = [...siblings, ...lashingRects, ...zoneRects].map((p) => withClearanceFootprint(p))
    const rotated = rotatePlacementAnywhere(self, deck.width, deck.length, deck.boardOffset, deck.gap, others, usableOutline)
    if (!rotated) {
      toast.warning('Невозможно повернуть: нет места')
      return
    }
    if (usableOutline && !rectInsidePolygon(rotated, usableOutline)) {
      toast.warning('Невозможно повернуть: груз выйдет за пределы палубы')
      return
    }
    // rotatePlacementAnywhere above only inflates the OTHER side's clearance
    // zones — swapping width/length here can newly overlap a neighbour that
    // was clear before the rotation, if it's this placement's OWN zone
    // that's now in the way. Additive precision check for custom (possibly
    // concave) outlines too — rotatePlacementAnywhere is bbox-only and
    // unchanged; this only rejects a bbox-approved rotation that a real
    // outline-vs-outline check finds actually overlapping.
    const preciseOthers = [
      ...result.placed
        .filter((p) => !excludeFromResultPlaced(p))
        .map((p) => ({ x: p.x, y: p.y, width: p.width, length: p.length, rotated: p.rotated, outline: p.outline, clearanceMargin: p.clearanceMargin, shape: p.shape, height: p.height, stackedCount: p.stackedCount })),
      ...zoneRects,
    ]
    // The rotated placement's own footprint also needs pipe-pyramid
    // self-widening (see collidesWithClearance) so it can't rotate itself
    // right up against a neighbour closer than its own pyramid base allows.
    const target = { x: rotated.x, y: rotated.y, width: rotated.width, length: rotated.length, rotated: !self.rotated, outline: item.outline, clearanceMargin: self.clearanceMargin, shape: item.shape, height: item.height, stackedCount: self.layers }
    if (collidesWithClearance(target, preciseOthers, deck.gap)) {
      toast.warning('Невозможно повернуть: нет места')
      return
    }
    commit({ x: rotated.x, y: rotated.y, width: rotated.width, length: rotated.length, rotated: !self.rotated })
  }

  const handleRotatePinned = (id: string) => {
    const pin = pinnedPlacements.find((p) => p.id === id)
    if (!pin) return
    const siblings = pinnedPlacements
      .filter((p) => p.id !== id)
      .map((p) => ({ x: p.x, y: p.y, width: p.width, length: p.length, clearanceMargin: p.clearanceMargin }))
    attemptRotate(
      pin,
      siblings,
      (p) => p.itemId === pin.itemId && Math.abs(p.x - pin.x) < 0.01 && Math.abs(p.y - pin.y) < 0.01,
      // Rotating is the user's choice of how the stack sits — «Закреплён».
      (patch) => updatePinned(clampedTripIndex, id, { ...patch, locked: true })
    )
  }

  const handleRotateManual = (id: string) => {
    const mp = manualPlacements.find((m) => m.id === id)
    if (!mp) return
    const siblings = manualPlacements
      .filter((m) => m.id !== id)
      .map((m) => ({ x: m.x, y: m.y, width: m.width, length: m.length, clearanceMargin: m.clearanceMargin }))
    attemptRotate(
      mp,
      siblings,
      (p) => manualPlacements[p.index]?.id === id,
      (patch) => updateManualPlacement(id, patch)
    )
  }

  // Moves the selected placement a quarter grid step (arrow keys), with the
  // same edge, outline and collision checks as a drag. A pin moved this way
  // becomes «Закреплён».
  const nudgePlacement = (selectedId: string, dx: number, dy: number) => {
    const step = computeGridStep(deck.width, deck.length, deck.unit) / 4
    const placements = mode === 'manual' ? manualPlacements : pinnedPlacements
    const current = placements.find((p) => p.id === selectedId)
    if (!current) return
    const nudgedItem = items.find((it) => it.id === current.itemId)
    const target2 = {
      x: current.x + dx * step,
      y: current.y + dy * step,
      width: current.width,
      length: current.length,
    }
    // Clamp the WIDENED footprint (own clearanceMargin + a pipe pyramid's
    // own base-row spread) against the deck edge/board-offset, not just
    // the raw single-unit rect — otherwise a nudge can walk the raw rect
    // flush against the edge while the wider footprint actually drawn on
    // screen sticks out past it. Same reasoning as resolveSnappedDragPosition's
    // selfMargin handling.
    const nudgeMargin = addClearanceMargins(
      current.clearanceMargin,
      nudgedItem ? pyramidSpreadAsClearance(nudgedItem, current.layers) : undefined
    )
    const ml = nudgeMargin?.left ?? 0
    const mr = nudgeMargin?.right ?? 0
    const mt = nudgeMargin?.top ?? 0
    const mb = nudgeMargin?.bottom ?? 0
    const wideClamped = clampToDeck(
      { x: target2.x - ml, y: target2.y - mt, width: current.width + ml + mr, length: current.length + mt + mb },
      deck.width,
      deck.length,
      deck.boardOffset
    )
    const clamped = { x: wideClamped.x + ml, y: wideClamped.y + mt }
    if (
      usableOutline &&
      !rectInsidePolygon(
        { x: clamped.x - ml, y: clamped.y - mt, width: current.width + ml + mr, length: current.length + mt + mb },
        usableOutline
      )
    )
      return
    // Single check (bbox + outline + both-direction clearance margin) —
    // sourced from result.placed like the rotate handlers above, since
    // raw ManualPlacement/PinnedPlacement never carry outline data.
    type CollisionCandidate = { x: number; y: number; width: number; length: number; rotated?: boolean; outline?: { x: number; y: number }[]; clearanceMargin?: ClearanceMargin; shape?: CargoShape; height?: number; stackedCount?: number }
    const placedRects: CollisionCandidate[] =
      mode === 'manual'
        ? result.placed
            .filter((p) => manualPlacements[p.index]?.id !== selectedId)
            .map((p) => ({ x: p.x, y: p.y, width: p.width, length: p.length, rotated: p.rotated, outline: p.outline, clearanceMargin: p.clearanceMargin, shape: p.shape, height: p.height, stackedCount: p.stackedCount }))
        : result.placed
            .filter((p) => !(p.itemId === current.itemId && Math.abs(p.x - current.x) < 0.01 && Math.abs(p.y - current.y) < 0.01))
            .map((p) => ({ x: p.x, y: p.y, width: p.width, length: p.length, rotated: p.rotated, outline: p.outline, clearanceMargin: p.clearanceMargin, shape: p.shape, height: p.height, stackedCount: p.stackedCount }))
    const lashingRects3: CollisionCandidate[] = lashingPointExclusionRects(deck.lashingPoints ?? [], deck.gap)
    const zoneRects3: CollisionCandidate[] = restrictionZoneExclusions(deck.restrictionZones ?? [])
    const preciseOthers = [...placedRects, ...lashingRects3, ...zoneRects3]
    // Same pipe-pyramid self-widening as the rotate handlers above, so a
    // nudged pipe stack can't be walked closer to a neighbour than its
    // own pyramid base actually allows.
    const target3 = { x: clamped.x, y: clamped.y, width: current.width, length: current.length, rotated: current.rotated, outline: nudgedItem?.outline, clearanceMargin: current.clearanceMargin, shape: nudgedItem?.shape, height: nudgedItem?.height, stackedCount: current.layers }
    if (collidesWithClearance(target3, preciseOthers, deck.gap)) return
    if (mode === 'manual') updateManualPlacement(selectedId, { x: clamped.x, y: clamped.y })
    else updatePinned(clampedTripIndex, selectedId, { x: clamped.x, y: clamped.y, locked: true })
  }

  // Buttons and keys that change a purely auto-placed stack (see the store's
  // selectedAutoKeys) first pin it — locked, the change is the user's choice —
  // and then act on that pin. The handlers below read placements and the
  // packing result from this render, which doesn't have the new pin yet, so
  // the action waits for the render that does (runPendingPinAction).
  type PinAction = { kind: 'rotate' } | { kind: 'layers'; delta: number } | { kind: 'remove' } | { kind: 'nudge'; dx: number; dy: number }
  const pendingPinActionRef = useRef<{ id: string; action: PinAction } | null>(null)
  const pinAutoStack = (placed: PlacedItem) =>
    pinFromPlaced(clampedTripIndex, {
      itemId: placed.itemId,
      name: placed.name,
      x: placed.x,
      y: placed.y,
      width: placed.width,
      length: placed.length,
      layers: placed.layers,
      rotated: placed.rotated,
      color: placed.color,
      weight: placed.weight,
      locked: true,
    })
  const actOnAutoStack = (placed: PlacedItem, action: PinAction) => {
    pendingPinActionRef.current = { id: pinAutoStack(placed), action }
  }
  // A stack that can't turn isn't pinned just to be told so.
  const rotateAutoStack = (placed: PlacedItem) => {
    const blocked = rotationBlockReason(placed)
    if (blocked) toast.warning(blocked)
    else actOnAutoStack(placed, { kind: 'rotate' })
  }
  // A plain field patch (clearance zone, wire type…) needs no placement
  // lookups, so it lands on the new pin straight away.
  const patchAutoStack = (placed: PlacedItem, patch: Partial<PinnedPlacement>) => {
    updatePinned(clampedTripIndex, pinAutoStack(placed), patch)
  }

  // Arrow keys nudge the selected cargo item; Space rotates it — 2D only
  // (alongside its existing pointer-drag, as a keyboard alternative). The 3D
  // view stays camera-only (rotate/zoom), no keyboard-driven editing there.
  // Skipped while focus is inside a text input (same guard as the other two
  // keydown listeners above), and for Space on a focused button or control,
  // which the browser presses. Space anywhere else is swallowed even with
  // nothing selected, so the page doesn't scroll. Arrow keys are only swallowed while something is
  // selected (round 31 — with nothing to nudge they used to kill keyboard
  // scrolling), and nothing inside a dialog/popover/menu is touched. Which
  // item is selected is read fresh on every keypress rather than once when
  // the effect was set up, so selecting a new item takes effect immediately
  // without waiting for the effect to re-subscribe.
  // The latest handler, so the window listener below subscribes once per
  // view instead of on every render (it reads selection, placements and the
  // packing result, which change all the time).
  const deckKeyDownRef = useRef<(e: KeyboardEvent) => void>(() => {})
  useEffect(() => {
    deckKeyDownRef.current = (e: KeyboardEvent) => {
      // e.target is typed as HTMLElement by KeyboardEvent's declaration, but
      // at runtime it can be a non-Element EventTarget (document, window —
      // e.g. when nothing has focus, or on a synthetically dispatched
      // event), which has neither .tagName nor .getAttribute/.closest and
      // would throw. Guard with a real instanceof check instead of trusting
      // the type cast.
      const target = e.target instanceof Element ? e.target : null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target as HTMLElement | null)?.isContentEditable) return
      // Also stay out of the way of open dropdowns/comboboxes (deck unit,
      // packing strategy, etc.) — those use arrows/Space for their own
      // keyboard navigation (Radix's Select trigger has role="combobox",
      // its option list role="listbox") and would otherwise get hijacked by
      // this listener now that it's active outside the 3D view too.
      if (target?.getAttribute('role') === 'combobox' || target?.closest('[role="listbox"]')) return
      // Dialogs, popovers and menus own their keyboard too — Space/Enter on
      // their buttons, arrows between their items. Swallowing Space here made
      // every button inside them (e.g. "Отмена" in a confirmation) dead to
      // the keyboard.
      if (target?.closest('[role="dialog"], [role="alertdialog"], [role="menu"]')) return

      const isSpace = e.key === ' ' || e.code === 'Space'
      // A focused button or other control takes Space itself: the browser
      // presses it. Swallowing Space here made every toolbar button dead to
      // the keyboard (L9). A click on the deck moves focus off the toolbar,
      // so Space still rotates the selection after working on the deck.
      if (isSpace && target?.closest('button, a[href], [role="button"], [role="radio"], [role="checkbox"], [role="switch"], [role="tab"], summary')) return
      let dx = 0
      let dy = 0
      if (e.key === 'ArrowLeft') dx = -1
      else if (e.key === 'ArrowRight') dx = 1
      else if (e.key === 'ArrowUp') dy = -1
      else if (e.key === 'ArrowDown') dy = 1
      else if (!isSpace) return

      // A purely auto-placed stack selected (no pin yet): the key changes
      // it, so it's pinned first and the change follows (actOnAutoStack).
      if (selectedAutoStack) {
        e.preventDefault()
        if (isSpace) rotateAutoStack(selectedAutoStack)
        else actOnAutoStack(selectedAutoStack, { kind: 'nudge', dx, dy })
        return
      }

      const selectedId = mode === 'manual' ? selectedManualIds[0] : selectedPinIds[0]
      // An arrow key only means "nudge" when there is something to nudge —
      // with no selection it must keep scrolling the page like any other
      // arrow press. Space is swallowed regardless (see the comment above).
      if (!selectedId && !isSpace) return
      e.preventDefault()
      if (!selectedId) return

      if (isSpace) {
        if (mode === 'manual') handleRotateManual(selectedId)
        else handleRotatePinned(selectedId)
        return
      }

      nudgePlacement(selectedId, dx, dy)
    }
  })
  useEffect(() => {
    if (viewMode !== '2d') return
    const onKeyDown = (e: KeyboardEvent) => deckKeyDownRef.current(e)
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [viewMode])

  // A composed stack is ONE physical column: its total height has to fit the
  // whole-column budget (stackHeightBudget — the deck clearance and each
  // constituent's own maxStackHeightM), exactly as a single-item stack of the
  // same height must. checkLayerChange only ever sees one item's share, so a
  // merge of 8 + 8 pipes of 0.25 m used to stand 4 m tall under a 2 m
  // clearance (and "+" could grow a composed stack past it the same way).
  // The per-item «Ярусов» caps stay with checkLayerChange.
  const checkStackHeight = (segs: CompositionSegment[]): { ok: true } | { ok: false; reason: string } => {
    const constituents = [...new Set(segs.map((seg) => seg.itemId))]
      .map((id) => items.find((it) => it.id === id))
      .filter((it): it is CargoItem => !!it)
    const budget = stackHeightBudget(constituents, deck.clearance, deck.unit)
    const height = stackHeight(segs, items)
    if (!exceedsHeightBudget(height, budget)) return { ok: true }
    const unitLabel = UNIT_LABEL[deck.unit]
    return { ok: false, reason: `Выше предельной высоты: ${roundForDisplay(height)} ${unitLabel} из ${roundForDisplay(budget)} ${unitLabel}` }
  }

  // Check whether a layer change is allowed for a placement.
  // - maxPhys: physical ceiling from clearance / item.height
  // - totalPlacedForItem: current sum of layers across all placements of this item
  // - item.quantity: total units requested
  // Returns { ok: boolean, reason?: string }
  const checkLayerChange = (
    itemId: string,
    currentLayers: number,
    delta: number,
    excludeIds?: string | string[],
    // Quantity the item is ABOUT to gain (the legacy cross-item merge moves the
    // dragged item's whole quantity into the target before this check can see
    // it) — added to item.quantity for the "already placed" budget below.
    extraQuantity = 0
  ): { ok: boolean; reason?: string; maxPhys: number } => {
    const excluded = new Set(excludeIds ? (Array.isArray(excludeIds) ? excludeIds : [excludeIds]) : [])
    const item = items.find((it) => it.id === itemId)
    if (!item) return { ok: false, reason: 'Груз не найден', maxPhys: 1 }
    const maxPhys = maxLayersFor(item, deck.clearance, deck.unit)
    const newLayers = currentLayers + delta
    if (newLayers < 1) return { ok: false, reason: 'Минимум 1 ярус', maxPhys }
    if (newLayers > maxPhys) {
      // Which limit binds (see maxLayersFor): without a height budget the
      // cargo's own «Ярусов» decides, one tier when it is 0; with one, the
      // «Ярусов» cap when it is the tighter, else the height. The reason is
      // shown by the inactive «+», so it names the field to change.
      const userCap = item.maxLayers && item.maxLayers > 0 ? Math.floor(item.maxLayers) : undefined
      const heightLimited = Number.isFinite(stackHeightBudget([item], deck.clearance, deck.unit))
      const reason = !heightLimited
        ? userCap
          ? `Не больше ${userCap} ${pluralRu(userCap, 'яруса', 'ярусов', 'ярусов')} — так задано в поле «Ярусов» у груза`
          : 'Один ярус: у груза «Ярусов» 0, а высота штабеля не задана — задайте «Ярусов» у груза или предельную высоту в «Судно» → «Палуба»'
        : userCap && userCap <= maxPhys
          ? `Превышен лимит ярусов для этого груза (${userCap}) — измените поле «Ярусов» в списке грузов`
          : 'Превышена предельная высота штабеля — увеличьте её в «Судно» → «Палуба», чтобы добавить ярус'
      return { ok: false, reason, maxPhys }
    }
    // Sum of layers across all placements of this item (excluding the one(s)
    // being changed) — across ALL trips, since the item's quantity is a single
    // shipment-wide budget, not per-trip.
    //
    // Round 15 (quantity scanning): scan each placement's composition for
    // THIS itemId's own layer count via placementLayersOfItem, rather than
    // filtering `placement.itemId === itemId` and summing the whole
    // placement — a composed placement can contain `itemId` as a
    // non-nominal constituent (missed by the old filter) or have `itemId`
    // as its nominal itemId while also containing other items (over-counted
    // by summing the whole placement). Exclusion (excludeIds — the
    // placement currently being edited) still applies at the placement
    // level first, unchanged. The uncomposed branch keeps the exact old
    // Math.max(1, ...) arithmetic, so this stays byte-identical for every
    // existing (uncomposed) placement.
    //
    // Round 29 corrective pass: a Tier-2 malformed placement (`malformed`
    // set, no valid `composition` to trust — see PinnedPlacement.malformed's
    // own doc comment) is excluded from `result.placed`/capacity, but this
    // scan reads the RAW store arrays directly, not `result.placed` — it
    // used to still phantom-count such a placement's raw, untrustworthy
    // `layers` toward this itemId's "already placed" sum (since its own
    // `itemId` is very often a genuinely valid one — the common
    // `malformed.invalidComposition` case), wrongly blocking the user from
    // placing more of an item that isn't actually visible anywhere on the
    // deck. Excluded here the same way it's excluded from packing.
    const layersOfIdIn = (p: { id: string; itemId: string; layers: number; composition?: CompositionSegment[]; malformed?: PinnedPlacement['malformed'] }) =>
      excluded.has(p.id) || (p.malformed && !p.composition) ? 0 : p.composition ? placementLayersOfItem(p, itemId) : p.itemId === itemId ? Math.max(1, p.layers) : 0
    const sumPlaced =
      Object.values(pinnedPlacementsByTrip)
        .flat()
        .reduce((s, p) => s + layersOfIdIn(p), 0) +
      manualPlacements.reduce((s, m) => s + layersOfIdIn(m), 0)
    const quantityBudget = item.quantity + extraQuantity
    if (sumPlaced + newLayers > quantityBudget) {
      return {
        ok: false,
        reason: `Все ${quantityBudget} ед. этого груза уже размещены — увеличьте количество в списке грузов`,
        maxPhys,
      }
    }
    return { ok: true, maxPhys }
  }

  // Find a collision-free spot on the open deck for one unpinned unit of an
  // item — tries unrotated first, then rotated (if allowed), picking the
  // first free rectangle it fits in.
  const findFreeSpotForItem = (
    item: { width: number; length: number; allowRotation?: boolean }
  ): { x: number; y: number; rotated: boolean } | null => {
    const freeRects = computeFreeRects(deck.width, deck.length, result.placed, deck.gap, deck.boardOffset, deck.outline)
    for (const r of freeRects) {
      const cellW = item.width + deck.gap
      const cellL = item.length + deck.gap
      if (cellW <= r.width && cellL <= r.height) {
        return { x: r.x + deck.gap / 2, y: r.y + deck.gap / 2, rotated: false }
      }
      if (item.allowRotation) {
        const cellWRot = item.length + deck.gap
        const cellLRot = item.width + deck.gap
        if (cellWRot <= r.width && cellLRot <= r.height) {
          return { x: r.x + deck.gap / 2, y: r.y + deck.gap / 2, rotated: true }
        }
      }
    }
    return null
  }

  // A unit taken off a stack with «−» stands on its own at the first free
  // spot instead of going back to the packer, which would stack it onto
  // another freed unit (a reported bug). In auto mode that takes a pin — a
  // locked one, so it's visible as «Закреплён» rather than a hidden pin.
  const standFreedUnit = (freedItemId: string, keepSelectedId: string) => {
    const item = items.find((it) => it.id === freedItemId)
    if (!item) return
    const spot = findFreeSpotForItem(item)
    if (!spot) return
    const unit = {
      itemId: item.id,
      name: item.name,
      x: spot.x,
      y: spot.y,
      width: spot.rotated ? item.length : item.width,
      length: spot.rotated ? item.width : item.length,
      layers: 1,
      rotated: spot.rotated,
      color: item.color,
      weight: item.weight,
    }
    if (mode === 'manual') {
      useCalculator.getState().addManualPlacement({ id: crypto.randomUUID(), ...unit })
      // Keep acting on the stack the user is clicking «−» on.
      useCalculator.setState({ selectedManualIds: [keepSelectedId] })
    } else {
      pinFromPlaced(clampedTripIndex, { ...unit, locked: true })
      useCalculator.setState({ selectedPinIds: [keepSelectedId], selectedAutoKeys: [] })
    }
  }

  const handleLayerChangePinned = (id: string, delta: number) => {
    const pin = pinnedPlacements.find((p) => p.id === id)
    if (!pin) return

    // Round 21: a composed placement's own `composition` array IS its
    // physical stack — "+"/"-" push/pop one unit on top of it directly,
    // instead of hunting for another placement to merge with (that's what
    // drag-merge/handleMergePinned is for, untouched here per C2's scope).
    // Still dormant in production: no real placement carries `composition`
    // until the merge switch-on round (24) — reachable today only via
    // hand-built composition literals in tests.
    if (pin.composition) {
      if (delta > 0) {
        // The unit "+" adds is one more of the placement's own NOMINAL
        // itemId (C2 contract) — its weight, not the composed placement's
        // own averaged `weight` field, is what genuinely adds to deck load.
        const nominalItem = items.find((it) => it.id === pin.itemId)
        if (wouldExceedMaxDeckCargo(nominalItem?.weight ?? 0)) {
          toast.error(`Превышен лимит груза на палубе (${deck.maxDeckCargoT} т)`)
          return
        }
        // checkLayerChange's own physical/quantity caps are keyed to a
        // single itemId's own layer count — pass the nominal itemId's
        // OWN count within this placement (composition-aware since Round
        // 15), not the placement's total layers across every constituent.
        const ownLayers = placementLayersOfItem(pin, pin.itemId)
        const check = checkLayerChange(pin.itemId, ownLayers, delta, id)
        if (!check.ok) {
          toast.warning(check.reason ?? 'Невозможно изменить ярусы')
          return
        }
        const composition = placementPush(pin.composition, pin.itemId, 1)
        const height = checkStackHeight(composition)
        if (!height.ok) {
          toast.warning(height.reason)
          return
        }
        const layers = placementTotalLayers({ itemId: pin.itemId, layers: 0, composition })
        // `weight` is stored PER-UNIT (existing convention) — divide the
        // composition's total back down.
        const weight = placementTotalWeightKg({ itemId: pin.itemId, layers, composition }, items) / Math.max(1, layers)
        updatePinned(clampedTripIndex, id, { composition, layers, weight, locked: true })
        return
      }
      const popped = placementPop(pin.composition)
      if (popped.remainingSingleton) {
        // Only one constituent left -> un-compose back to an ordinary
        // placement, identity transferring to the survivor (C2 contract).
        const singleton = popped.remainingSingleton
        const catalogItem = items.find((it) => it.id === singleton.itemId)
        updatePinned(clampedTripIndex, id, {
          composition: undefined,
          itemId: singleton.itemId,
          layers: singleton.layers,
          weight: catalogItem?.weight,
          locked: true,
        })
      } else if (popped.composition) {
        const composition = popped.composition
        const layers = placementTotalLayers({ itemId: pin.itemId, layers: 0, composition })
        const weight = placementTotalWeightKg({ itemId: pin.itemId, layers, composition }, items) / Math.max(1, layers)
        updatePinned(clampedTripIndex, id, { composition, layers, weight, locked: true })
      } else {
        // Defensive only: a composed placement always has >=2 segments, so
        // a single pop can never empty it. If it somehow does, fall back
        // to the existing safe full-removal path instead of leaving a
        // corrupt zero-layer placement on the deck.
        handleRemovePinned(id)
        return
      }
      // The unit that was physically on top (popped.freedItemId) may differ
      // from the placement's nominal itemId.
      standFreedUnit(popped.freedItemId, id)
      return
    }

    // «+» adds exactly one unit. It used to absorb a whole other stack of
    // this cargo, while its own tooltip promised one layer.
    const check = checkLayerChange(pin.itemId, pin.layers, delta, id)
    if (delta > 0) {
      if (check.ok) {
        // A unit the auto-packer placed elsewhere — or one that fit nowhere —
        // moves onto this stack. It only adds weight to this trip if no such
        // unit was already on it.
        const freeUnitOnThisTrip = result.placed.some(
          (p) =>
            p.itemId === pin.itemId &&
            !pinnedPlacements.some((pp) => pp.itemId === p.itemId && Math.abs(pp.x - p.x) < 0.01 && Math.abs(pp.y - p.y) < 0.01)
        )
        if (!freeUnitOnThisTrip && wouldExceedMaxDeckCargo(pin.weight ?? 0)) {
          toast.error(`Превышен лимит груза на палубе (${deck.maxDeckCargoT} т)`)
          return
        }
        updatePinned(clampedTripIndex, id, { layers: pin.layers + 1, locked: true })
        return
      }
      // Every unit is already in a placement: take one off the lowest other
      // stack of this cargo on this trip (same deck, so no weight change).
      const source =
        pin.layers + 1 <= check.maxPhys
          ? pinnedPlacements
              .filter((p) => p.id !== id && p.itemId === pin.itemId && !p.composition && !p.malformed)
              .sort((a, b) => a.layers - b.layers)[0]
          : undefined
      if (!source) {
        toast.warning(check.reason ?? 'Невозможно изменить ярусы')
        return
      }
      if (source.layers > 1) updatePinned(clampedTripIndex, source.id, { layers: source.layers - 1 })
      else removePinned(clampedTripIndex, source.id)
      updatePinned(clampedTripIndex, id, { layers: pin.layers + 1, locked: true })
      return
    }
    if (!check.ok) {
      toast.warning(check.reason ?? 'Невозможно изменить ярусы')
      return
    }
    updatePinned(clampedTripIndex, id, { layers: pin.layers - 1, locked: true })
    standFreedUnit(pin.itemId, id)
  }

  // Delete a pinned placement from the deck. Unlike unpinning, this also
  // decreases item.quantity by the placement's layer count — otherwise the
  // auto-packer would immediately re-place the freed unit elsewhere, making
  // the ✕ button look like it does nothing.
  //
  // Round 16: composition-aware — each constituent's OWN quantity is
  // decreased by its OWN physical layer count, never the nominal itemId's
  // quantity by the pin's full total (placement.itemId is never the sole
  // source of quantity — see the migration plan's Quantity contract). A
  // composition can contain the SAME itemId in more than one non-adjacent
  // segment (e.g. [A2,B3,A1]), so segments are aggregated per itemId first,
  // then applied once each. Dormant for an uncomposed pin: its implicit
  // one-segment "composition" degenerates to the exact old single update.
  const handleRemovePinned = (id: string) => {
    const pin = pinnedPlacements.find((p) => p.id === id)
    if (!pin) return
    removePinUnits(pin)
    toast.info(`Груз «${pin.name}» удалён (−${pin.layers} ед.)`)
  }
  // Drops the pin and takes its units off each cargo's quantity.
  const removePinUnits = (pin: PinnedPlacement) => {
    removePinned(clampedTripIndex, pin.id)
    const segments = pin.composition ?? [{ itemId: pin.itemId, layers: pin.layers }]
    const layersByItemId = new Map<string, number>()
    for (const seg of segments) {
      layersByItemId.set(seg.itemId, (layersByItemId.get(seg.itemId) ?? 0) + seg.layers)
    }
    for (const [itemId, removedLayers] of layersByItemId) takeUnits(itemId, removedLayers)
  }
  const takeUnits = (itemId: string, units: number) => {
    const currentItem = useCalculator.getState().items.find((it) => it.id === itemId)
    if (currentItem) {
      useCalculator.getState().updateItem(itemId, { quantity: Math.max(0, currentItem.quantity - units) })
    }
  }

  // Locks/unlocks a pinned placement — a locked one stops responding to
  // drag until unlocked via the deck's right-click menu. Purely a drag
  // gate: unlike handleRemovePinned, it never touches item.quantity or the
  // placement's existence.
  const handleTogglePinLock = (id: string, locked: boolean) => {
    updatePinned(clampedTripIndex, id, { locked })
  }

  const handleLayerChangeManual = (id: string, delta: number) => {
    const mp = manualPlacements.find((m) => m.id === id)
    if (!mp) return

    // Round 21: same composed push/pop wiring as handleLayerChangePinned
    // above — see its comment for the full rationale. Manual-mode
    // equivalent, using manualPlacements/updateManualPlacement/
    // addManualPlacement instead of the pinned-trip equivalents.
    if (mp.composition) {
      if (delta > 0) {
        const nominalItem = items.find((it) => it.id === mp.itemId)
        if (wouldExceedMaxDeckCargo(nominalItem?.weight ?? 0)) {
          toast.error(`Превышен лимит груза на палубе (${deck.maxDeckCargoT} т)`)
          return
        }
        const ownLayers = placementLayersOfItem(mp, mp.itemId)
        const check = checkLayerChange(mp.itemId, ownLayers, delta, id)
        if (!check.ok) {
          toast.warning(check.reason ?? 'Невозможно изменить ярусы')
          return
        }
        const composition = placementPush(mp.composition, mp.itemId, 1)
        const height = checkStackHeight(composition)
        if (!height.ok) {
          toast.warning(height.reason)
          return
        }
        const layers = placementTotalLayers({ itemId: mp.itemId, layers: 0, composition })
        const weight = placementTotalWeightKg({ itemId: mp.itemId, layers, composition }, items) / Math.max(1, layers)
        updateManualPlacement(id, { composition, layers, weight })
        return
      }
      const popped = placementPop(mp.composition)
      if (popped.remainingSingleton) {
        const singleton = popped.remainingSingleton
        const catalogItem = items.find((it) => it.id === singleton.itemId)
        updateManualPlacement(id, {
          composition: undefined,
          itemId: singleton.itemId,
          layers: singleton.layers,
          weight: catalogItem?.weight,
        })
      } else if (popped.composition) {
        const composition = popped.composition
        const layers = placementTotalLayers({ itemId: mp.itemId, layers: 0, composition })
        const weight = placementTotalWeightKg({ itemId: mp.itemId, layers, composition }, items) / Math.max(1, layers)
        updateManualPlacement(id, { composition, layers, weight })
      } else {
        // Defensive only, see handleLayerChangePinned's identical comment.
        removeManualPlacement(id)
        return
      }
      standFreedUnit(popped.freedItemId, id)
      return
    }

    const current = Math.max(1, mp.layers)

    // «+» adds exactly one unit: one not placed yet if there is one (that
    // adds weight to the deck), else one off the lowest other stack of this
    // cargo. It used to merge a whole other stack.
    const check = checkLayerChange(mp.itemId, current, delta, id)
    if (delta > 0) {
      if (check.ok) {
        if (wouldExceedMaxDeckCargo(mp.weight ?? 0)) {
          toast.error(`Превышен лимит груза на палубе (${deck.maxDeckCargoT} т)`)
          return
        }
        updateManualPlacement(id, { layers: current + 1 })
        return
      }
      const source =
        current + 1 <= check.maxPhys
          ? manualPlacements
              .filter((m) => m.id !== id && m.itemId === mp.itemId && !m.composition && !m.malformed)
              .sort((a, b) => Math.max(1, a.layers) - Math.max(1, b.layers))[0]
          : undefined
      if (!source) {
        toast.warning(check.reason ?? 'Невозможно изменить ярусы')
        return
      }
      if (Math.max(1, source.layers) > 1) updateManualPlacement(source.id, { layers: Math.max(1, source.layers) - 1 })
      else removeManualPlacement(source.id)
      updateManualPlacement(id, { layers: current + 1 })
      return
    }
    if (!check.ok) {
      toast.warning(check.reason ?? 'Невозможно изменить ярусы')
      return
    }
    updateManualPlacement(id, { layers: current - 1 })
    standFreedUnit(mp.itemId, id)
  }

  useEffect(function runPendingPinAction() {
    const pending = pendingPinActionRef.current
    if (!pending || !pinnedPlacements.some((p) => p.id === pending.id)) return
    pendingPinActionRef.current = null
    const { id, action } = pending
    if (action.kind === 'rotate') handleRotatePinned(id)
    else if (action.kind === 'layers') handleLayerChangePinned(id, action.delta)
    else if (action.kind === 'remove') handleRemovePinned(id)
    else nudgePlacement(id, action.dx, action.dy)
  })
  return {
    rotationBlockReason,
    handleRotatePinned,
    handleRotateManual,
    pinAutoStack,
    actOnAutoStack,
    rotateAutoStack,
    patchAutoStack,
    checkStackHeight,
    checkLayerChange,
    handleLayerChangePinned,
    handleRemovePinned,
    removePinUnits,
    takeUnits,
    handleTogglePinLock,
    handleLayerChangeManual,
  }
}
