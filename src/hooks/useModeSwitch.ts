'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import type { ManualPlacement, PackingResult, PinnedPlacement } from '@/lib/packing'
import { useCalculator } from '@/store/calculator'
import { isQuarantined, matchLashingCarryover } from '@/store/placementCarryover'

type Calculation = ReturnType<typeof useCalculator.getState>

// Switching between auto and manual placement, and the question asked first
// when a switch would quietly change saved data (Phase 0, L5/L21). Moved out
// of page.tsx as it was (spec 12.3).
export function useModeSwitch({
  mode,
  result,
  shownTrips,
  clampedTripIndex,
  activeTripIndex,
  manualPlacements,
  pinnedPlacements,
  pinnedPlacementsByTrip,
}: {
  mode: Calculation['mode']
  // The open trip, and every trip shown.
  result: PackingResult
  shownTrips: readonly PackingResult[]
  clampedTripIndex: number
  activeTripIndex: number
  manualPlacements: ManualPlacement[]
  // The open trip's pins.
  pinnedPlacements: PinnedPlacement[]
  pinnedPlacementsByTrip: Calculation['pinnedPlacementsByTrip']
}) {
  // A mode switch that would quietly change saved data asks first (Phase 0,
  // L5/L21) — see handleModeChange.
  const [modeSwitchPrompt, setModeSwitchPrompt] = useState<
    null | { to: 'auto' } | { to: 'manual'; strandedUnits: number }
  >(null)

  // Switch mode while preserving placements:
  //  - auto -> manual: all placed items (pinned + auto-packed) become manual placements
  //  - manual -> auto: all manual placements become pinned, auto-packer keeps their positions
  const switchToManual = () => {
    // Convert current auto-mode result (pinned + auto-packed) into manual placements,
    // preserving the number of stacked tiers per footprint.
    const newManual: ManualPlacement[] = result.placed.map((p) => ({
      id: crypto.randomUUID(),
      itemId: p.itemId,
      name: p.name,
      x: p.x,
      y: p.y,
      width: p.width,
      length: p.length,
      layers: Math.max(1, p.stackedCount),
      rotated: p.rotated,
      color: p.color,
      weight: p.weight,
      clearanceMargin: p.clearanceMargin,
      // Round 20 — composition-only preservation. PlacedItem already
      // carries `composition` (copied through verbatim by packDeck/
      // packingResultFromManual, never synthesized — Round 14), so this
      // is a straight passthrough, not a new source of truth. Dormant
      // today (nothing writes composition until the merge switch-on
      // round); scoped deliberately to composition ONLY — stabilityOverride/
      // lashingWireType/lashingJustification/rotationLocked are NOT
      // present on PlacedItem at all (a structural gap, not a missed
      // copy here) and are tracked separately as a future placement-
      // metadata-ownership decision, not fixed in this round.
      composition: p.composition,
    }))
    // Lashing points only ever attach to a real placement id (pinned or
    // manual) — auto-mode's non-pinned, algorithm-placed slots never have
    // one, so only pinnedPlacements (not the full result.placed) can be a
    // carryover source here.
    const matches = matchLashingCarryover(pinnedPlacements, newManual)
    useCalculator.setState({
      mode: 'manual',
      manualPlacements: [...newManual, ...pinnedPlacements.filter(isQuarantined)],
      // Only the trip actually being converted moves into manualPlacements
      // — every OTHER trip's pins must survive untouched. This used to be
      // `pinnedPlacementsByTrip: {}`, wiping every other trip's data the
      // instant the user switched to MANUAL from anywhere but trip 0 —
      // there was no way back to it after switching back to AUTO.
      pinnedPlacementsByTrip: { ...pinnedPlacementsByTrip, [clampedTripIndex]: [] },
      selectedPinIds: [],
      selectedAutoKeys: [],
      activeStampId: null,
    })
    useCalculator.getState().remapLashingPointsForRedistribute(matches)
    toast.info('Ручной режим — размещения сохранены')
  }

  // keepPositions: every manual placement becomes a pin of the trip that was
  // open when the user switched to manual (the old, only behaviour).
  // Otherwise the cargo is re-packed from scratch on that trip, and lashing
  // points tied to the dropped placements go with them.
  const switchToAuto = (keepPositions: boolean) => {
    if (!keepPositions) {
      useCalculator.setState({
        mode: 'auto',
        pinnedPlacementsByTrip: { ...pinnedPlacementsByTrip, [activeTripIndex]: [] },
        manualPlacements: [],
        selectedPinIds: [],
        selectedAutoKeys: [],
        selectedManualIds: [],
        activeStampId: null,
      })
      useCalculator.getState().pruneStaleLashingPoints()
      toast.info('Авто-режим — груз расставлен заново')
      return
    }
    // Convert manual placements into pinned placements, preserving layers.
    const newPinned = manualPlacements.map((m) => ({
      id: crypto.randomUUID(),
      itemId: m.itemId,
      name: m.name,
      x: m.x,
      y: m.y,
      width: m.width,
      length: m.length,
      layers: Math.max(1, m.layers),
      rotated: m.rotated,
      color: m.color,
      weight: m.weight,
      clearanceMargin: m.clearanceMargin,
      // Round 20 — composition-only preservation. `m` is a raw stored
      // ManualPlacement here (not PlacedItem), which already carries
      // `composition` at the type level — straight passthrough.
      composition: m.composition,
      // Keeps a quarantined placement quarantined — see isQuarantined.
      malformed: m.malformed,
      // «Оставить позиции»: the user chose these places by hand — they stay
      // «Закреплён» (lock badge, kept by «Автораспределение»).
      locked: true,
    }))
    const matches = matchLashingCarryover(manualPlacements, newPinned)
    useCalculator.setState({
      mode: 'auto',
      // Manual mode has no trip concept of its own — the edits go back
      // into whichever trip was active when the user switched TO manual.
      // NOT clampedTripIndex: manual's own `trips` array is always
      // length 1, so `clampedTripIndex = min(activeTripIndex, 0)` is
      // forced down to 0 for the whole time the user is in manual mode,
      // regardless of which trip they were on before switching —
      // activeTripIndex is the one value that still remembers it. Used
      // to hard-code trip 0 outright and replace the whole map, which
      // both mis-filed the edit under the wrong trip whenever the user
      // had switched from trip N != 0, and discarded every other trip's
      // pins in the process.
      pinnedPlacementsByTrip: { ...pinnedPlacementsByTrip, [activeTripIndex]: newPinned },
      manualPlacements: [],
      selectedPinIds: [],
      selectedAutoKeys: [],
      activeStampId: null,
    })
    useCalculator.getState().remapLashingPointsForRedistribute(matches)
    toast.info('Авто-режим — размещения сохранены как закреплённые')
  }

  const handleModeChange = (newMode: 'auto' | 'manual') => {
    if (newMode === mode) return
    if (newMode === 'manual') {
      // Manual mode has a single trip: only the open trip's cargo moves onto
      // the manual deck, everything on the other trips becomes unplaced until
      // the user goes back to auto. That used to happen without a word.
      const strandedUnits = shownTrips.reduce((sum, t, i) => (i === clampedTripIndex ? sum : sum + t.placedCount), 0)
      if (strandedUnits > 0) {
        setModeSwitchPrompt({ to: 'manual', strandedUnits })
        return
      }
      switchToManual()
      return
    }
    // Every manual placement used to turn into a pin silently, after which
    // auto mode no longer packed that cargo — ask instead.
    if (manualPlacements.some((m) => !isQuarantined(m))) {
      setModeSwitchPrompt({ to: 'auto' })
      return
    }
    switchToAuto(true)
  }
  return { modeSwitchPrompt, setModeSwitchPrompt, switchToManual, switchToAuto, handleModeChange }
}
