---
Task ID: AUDIT-1
Agent: general-purpose
Task: Audit DeckLoad project for bugs

Work Log:
- Read all source files: src/lib/packing.ts, src/store/calculator.ts, src/store/projects.ts, src/app/page.tsx, src/components/calculator/{DeckVisualization,PlacementPanel,ItemList,StatsPanel,Sidebar}.tsx
- Analyzed packing algorithm (Maximal Rectangles + BSSF), stores (Zustand), components (React 19 hooks)
- Traced data flow for project loading, mode switching, drag-and-drop, layer changes, variant generation
- Checked consistency between local `selectedManual` state and store `selectedManualIds`
- Checked localStorage migration / data consistency for old saved projects

Stage Summary:

=====================================================================
CRITICAL / HIGH SEVERITY
=====================================================================

1. [HIGH] src/app/page.tsx:163-218 (deck-change effect destroys loaded manual placements)
   The `useEffect` watching `[deck.gap, deck.boardOffset, deck.width, deck.length, deck.clearance]`
   re-runs `packDeck` and OVERWRITES `manualPlacements` whenever the deck geometry changes.
   This is triggered not only by the user editing deck params, but ALSO by the load-project
   effect (lines 86-107) which calls `useCalculator.setState({ deck: { ...proj.deck } })`.
   When the user switches from Project B (deck 30x12) back to Project A (deck 20x8) which
   has saved manual placements, the deck-change effect fires on the next render, reads
   `useCalculator.getState()` (which now has Project A's manualPlacements), re-packs the
   items with `packDeck`, and replaces the user's manual placements with an auto-packed
   layout. The auto-save effect (lines 110-128) then persists this destroyed state to
   localStorage, causing PERMANENT DATA LOSS of the user's manual layout.
   Fix: skip the effect when `loadedProjectId.current` was just updated, or guard against
   running right after a project load.

2. [HIGH] src/lib/packing.ts:315-320 (rejected pinned placements still subtract from item quantity)
   `remainingByItem` is decremented for EVERY pin in `pinned` (lines 317-320) BEFORE the
   validation loop (lines 327-358) runs. Pins that are rejected (outside deck or overlapping
   an accepted pin) have already had their `pin.layers` subtracted from the item's remaining
   quantity. As a result those units are "lost" — they are neither placed (rejected) nor
   available for the auto-packer (already subtracted). They also don't appear in `unplaced`
   because the `remaining > 0` check (line 511) sees a falsy/NaN-ish value.
   Fix: only subtract from `remainingByItem` for ACCEPTED pins inside the validation loop.

=====================================================================
MEDIUM SEVERITY
=====================================================================

3. [MEDIUM] src/components/calculator/DeckVisualization.tsx:103, 199-218, 509-512, 638-724
   (selectedManual local state vs selectedManualIds store state — inconsistent)
   The component keeps a local `useState<string | null>` called `selectedManual` for
   single-selection (canvas action buttons) while the store keeps `selectedManualIds: string[]`
   for multi-selection (PlacementPanel group actions). They are never synchronised:
     - Non-additive click (line 211): sets `selectedManual` only — store stays empty, so
       PlacementPanel shows no group actions even though the canvas shows per-item buttons.
     - Additive (shift/ctrl) click (line 208): updates `selectedManualIds` only — local
       `selectedManual` is stale, so canvas buttons may target the wrong placement.
     - `clearManualSelection` (store): clears `selectedManualIds` but NOT `selectedManual` —
       canvas buttons remain visible.
     - ✕ remove (line 708): clears `selectedManual` but NOT `selectedManualIds` — panel
       still shows group actions for a now-deleted placement.
   `isSelected` (lines 509-512) OR-s the two, masking some cases, but the action surfaces
   diverge. Fix: collapse to a single source of truth (use `selectedManualIds[0]` for the
   canvas buttons, or sync the two on every change).

4. [MEDIUM] src/lib/packing.ts:770-789 (packingResultFromManual — breakdown.requested hardcoded to 0)
   `packingResultFromManual` only receives `totalRequested` (a number), not the per-item
   quantities. The `breakdown` map initialises `requested: 0` (line 776) and never updates
   it. `breakdown[i].layers` is also hardcoded to `1` (line 779). Result: in manual mode
   StatsPanel shows "4/0" in the per-item table and "×1" layers even when stacks have
   multiple tiers. Fix: pass `items: CargoItem[]` (or a Map<itemId, qty>) into the function
   and populate `requested`/`layers` correctly.

5. [MEDIUM] src/lib/packing.ts:803 (packingResultFromManual — maxStackHeight always 0)
   `maxStackHeight: 0` is hardcoded. StatsPanel only shows "Макс. высота штабеля" when
   `maxStackHeight > 0`, so the row is never displayed in manual mode. Fix: compute
   `item.height * layers` per placement.

6. [MEDIUM] src/store/projects.ts:78-91 (loadFromStorage — no schema validation / migration)
   `JSON.parse(raw)` is returned as-is. Old localStorage data may have:
     - `manualPlacements[i].layers` undefined
     - `pinnedPlacements[i].layers` undefined
     - missing `pinnedPlacements` array entirely (the load-project effect at page.tsx:95
       guards with `(proj.pinnedPlacements ?? [])` but the store itself doesn't).
   When `pin.layers` is undefined, `packDeck` (packing.ts:378-387) writes `layers: undefined,
   stackedCount: undefined` into `result.placed`, and `result.placedCount += pin.layers`
   becomes NaN — StatsPanel renders "NaN ед.". Also `remainingByItem.set(pin.itemId,
   Math.max(0, r - pin.layers))` (line 319) becomes `Math.max(0, NaN) = NaN`, which makes
   the auto-packer silently drop that item's units (the `while (r > 0)` loop at line 408
   never executes because `NaN > 0` is false). Fix: normalise loaded data with a migration
   function that coerces `layers` to `Math.max(1, layers ?? 1)` and backfills missing arrays.

7. [MEDIUM] src/app/page.tsx:504-526 (handleAutoRedistribute ignores pinned placements)
   `packDeckVariants` is called without `pinned` in the options object. The generated
   variants therefore don't respect existing pins. Then `applyVariant(newVariants[0])`
   (line 523) runs immediately and — in auto mode — clears `pinnedPlacements: []`
   (applyVariant line 552-556). The user's pins are silently discarded. Fix: pass
   `pinned: pinnedPlacements` or warn the user before clearing.

8. [MEDIUM] src/store/calculator.ts:226-227, 234 (removeItem / clearItems orphan placements)
   `removeItem` filters `items` but does not remove `manualPlacements` / `pinnedPlacements`
   whose `itemId === id`. `clearItems` empties `items` but leaves all placements intact.
   The orphaned placements keep referencing a deleted `itemId`, which causes
   `packingResultFromManual` and `packDeck` to produce breakdown entries / pinned placements
   with no matching CargoItem. Fix: cascade-delete placements whose `itemId` matches.

9. [MEDIUM] src/app/page.tsx:375-386 vs src/store/calculator.ts:309
   (handleRemovePinned vs clearPinned — inconsistent quantity side-effect)
   `handleRemovePinned` (the ✕ button and "Открепить" in PlacementPanel) DECREMENTS the
   cargo item's `quantity` by `pin.layers` so the auto-packer doesn't re-place the freed
   units. `clearPinned` (the "Снять все закрепления" button) does NOT decrement quantities,
   so all units get re-packed. Two operations that the UI presents as similar ("remove pin"
   vs "clear all pins") have opposite semantics. Fix: pick one behaviour and apply it to both
   (or rename the buttons to make the distinction explicit).

10. [MEDIUM] src/app/page.tsx:163-218 (deck-change effect — destructive even when intentional)
    Even setting aside bug #1, when the user intentionally changes deck gap/offset/size in
    the Sidebar, ALL their manual placements are replaced by an auto-pack result
    (`useCalculator.setState({ manualPlacements: newManual, ... })` at line 209). There is
    no confirmation, no undo, and the original layout is lost. This is a destructive UX even
    when not triggered by a project switch. Fix: either scale/clamp existing placements
    instead of re-packing, or warn the user.

11. [MEDIUM] src/components/calculator/DeckVisualization.tsx:317-363 (handlePointerMove
    triggers store update + full re-pack on every pointermove)
    During a pinned-placement drag, `onUpdatePinned` is called on every `pointermove` event
    (line 361). That updates `pinnedPlacements` in the store, which is a dependency of the
    `result` useMemo (page.tsx:145), which re-runs `packDeck` — an O(n·m) operation — on
    every mouse move. With many items this causes severe lag. Fix: throttle/drag via local
    state and commit to the store on `pointerup`.

12. [MEDIUM] src/lib/packing.ts:370-387 + 319 (pin.layers NaN propagation from old localStorage)
    Direct consequence of bug #6: `packDeck` uses `pin.layers` without `Math.max(1, ...)`
    in `result.placed.layers`, `result.placed.stackedCount`, `result.placedCount += pin.layers`
    and `result.totalWeight += pin.weight * pin.layers`. A single undefined `layers` poisons
    `placedCount` and `totalWeight` for the whole result. Fix: coerce at the boundary in
    `loadFromStorage`.

=====================================================================
LOW SEVERITY
=====================================================================

13. [LOW] src/app/page.tsx:91-105 (load-project effect doesn't reset selectedManualIds)
    `selectedPinIds: []` is set but `selectedManualIds` is not. After loading a project the
    stale multi-selection from the previous project persists in the store (and in the local
    `selectedManual` state inside DeckVisualization, which can't be reset from here).

14. [LOW] src/app/page.tsx:107 (load-project effect has `projects` in deps)
    `projects` is a new array reference every time `saveSnapshot` runs (debounced 400ms).
    The effect fires on every save, but the `loadedProjectId.current === activeId` guard
    short-circuits the body. Functionally OK but causes unnecessary effect runs.

15. [LOW] src/store/calculator.ts:267-272 (removeManualPlacement — dead code)
    `activeStampId: s.activeStampId === id ? null : s.activeStampId` compares an item id
    (`activeStampId`) with a placement id (`id`). The branch is never taken.

16. [LOW] src/store/calculator.ts:241-250, 251-256 (loadPreset / setMode don't reset
    selectedManualIds) — stale multi-selection persists across preset loads and mode switches.

17. [LOW] src/app/page.tsx:220-249 (handleNewCalculation / handleResetCurrent don't reset
    selectedManualIds) — same stale-selection issue.

18. [LOW] src/components/calculator/DeckVisualization.tsx:365-379 (handlePointerUp free-space
    click doesn't clear selection)
    The fill check matches `'#ffffff'` and `'url(#deck-grid)'` but not `'url(#free-hatch)'`,
    so clicking on a hatched free-space rectangle doesn't clear the pin selection.

19. [LOW] src/lib/packing.ts:504 (maxStackHeight ignores pinned placements)
    Only auto-packed stacks update `maxStackHeight`. Pinned placements always carry
    `height: 0` (line 377), so even if computed they'd contribute 0 — but the original
    `CargoItem.height` is lost in `PinnedPlacement`, so a manual recompute is impossible
    without changes to the type.

20. [LOW] src/app/page.tsx:253-278 (tryRotatePlacement doesn't check item.allowRotation)
    The user can rotate any pinned/manual placement via the ↻ button even when the source
    CargoItem has `allowRotation: false`. The rotation succeeds, producing a layout the
    auto-packer would never have chosen.

21. [LOW] src/components/calculator/DeckVisualization.tsx:525 (key uses array index in auto mode)
    `key={mode === 'manual' ? \`m-${p.manualId}\` : \`p-${idx}\`}` — auto mode keys by array
    index, which can cause React to reuse the wrong DOM nodes when `result.placed` is
    reordered by re-packing. Use `p.itemId` + stable position hash, or assign a stable id.

22. [LOW] src/components/calculator/PlacementPanel.tsx:355 (StampRow ignores stampRotated)
    The stamp selector always shows `item.width×item.length` even when `stampRotated` is
    true (next click will place `length×width`). Misleading preview.

23. [LOW] src/components/calculator/DeckVisualization.tsx:103, 708 (selectedManual not cleared
    when manualPlacements change externally)
    Applying a variant (page.tsx:530-558) or loading a project replaces `manualPlacements`,
    but the local `selectedManual` in DeckVisualization is never reset. It may point to a
    placement id that no longer exists. The `manualPlacements.find(...)` guard at line 641
    prevents a crash, but `isSelected` (line 511) may briefly highlight a phantom.

24. [LOW] src/lib/packing.ts:265-268 (maxLayersFor returns 1 when item.height <= 0 even with
    clearance > 0) — items with height 0 are treated as single-tier regardless of clearance.
    Likely intentional but undocumented; can surprise users who set height=0 to "ignore".

25. [LOW] src/components/calculator/Sidebar.tsx:372, 383 (DeckSettings allows width/length = 0)
    `Number(e.target.value) || 0` permits 0. `packDeck` handles 0 gracefully (returns empty
    result) but the SVG renders a zero-size deck and `scale = Math.min(.../Math.max(deckWidth,1), …)`
    masks the problem. Use `Math.max(0.1, ...)`.

26. [LOW] src/components/calculator/DeckVisualization.tsx:727-741 (preview stamp calls
    clampToDeck twice per render) — once for x, once for y. Minor perf, no correctness issue.

27. [LOW] src/lib/packing.ts:453, 467 (unplaced dedup hides second reason)
    Once an item is added to `unplaced` (e.g. "Превышает размеры палубы"), the
    "Не вместилось N ед." branch (line 511) is suppressed by the `!result.unplaced.some(...)`
    check, so the user only sees the first reason even if some units did fit and others didn't.

28. [LOW] src/app/page.tsx:689-699 (getLayerInfo callback recreated every render)
    `getLayerInfo` is an inline arrow closing over `items`, `deck.clearance`,
    `pinnedPlacements`, `manualPlacements` — recreated on every render, defeating any
    `React.memo` on DeckVisualization. Wrap in `useCallback` (with proper deps) or move to
    a ref.

29. [LOW] src/store/projects.ts:78-91 (loadFromStorage doesn't validate project shape)
    If `parsed.projects` contains objects missing `id`, `deck`, `items`, etc., downstream
    code (`p.id`, `p.deck.width`, `p.items.length`) will throw. No try/catch around
    individual project validation.

30. [LOW] src/app/page.tsx:584 / StatsPanel.tsx:38 (unplacedCount can be misleading when
    `placedCount > requestedCount` due to stacking) — `Math.max(0, requested - placed)`
    hides the over-placement; not a crash, just confusing stats.

=====================================================================
NOTES (not bugs, but worth flagging)
=====================================================================

- packing.ts `pruneFreeList` (lines 113-127) is correct but mutates the list with splice
  inside nested loops — O(n²) and tricky to reason about. Consider rewriting with filter.

- DeckVisualization.tsx `resolveDragPosition` (lines 265-315) binary-search slide is a nice
  touch but only searches 10 iterations along the original movement vector; if the best
  slide is perpendicular to the movement, it won't be found.

- calculator.ts `setUnit` (lines 182-219) converts all dimensions but not `clearance`
  consistency — actually it DOES convert clearance (line 195), good. But it does not convert
  `item.height` for items that are currently 0 (skipped by `conv(0) === 0`, fine).

- The `useEffect` at page.tsx:163-218 uses `useCalculator.getState()` inside the effect body
  to read fresh state, which is correct, but the closure `deck` variable is also used
  (lines 188-193) — these could diverge if multiple updates batch. In practice they match
  because the effect's deps include all deck fields.
