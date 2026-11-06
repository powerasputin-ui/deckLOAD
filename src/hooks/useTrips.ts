'use client'

import { useMemo, useState } from 'react'
import type { PackingResult } from '@/lib/packing'
import { computeTrips, shownTripsOf } from '@/lib/trips'
import type { useCalculator } from '@/store/calculator'

type Calculation = ReturnType<typeof useCalculator.getState>

// The trips the cargo goes in and the one open on screen (spec 6.9). Moved
// out of page.tsx as it was (spec 12.3).
export function useTrips({
  mode,
  deck,
  items,
  manualPlacements,
  pinnedPlacementsByTrip,
  sortStrategy,
  globalRotation,
  separationRulesInUnit,
}: {
  mode: Calculation['mode']
  deck: Calculation['deck']
  items: Calculation['items']
  manualPlacements: Calculation['manualPlacements']
  pinnedPlacementsByTrip: Calculation['pinnedPlacementsByTrip']
  sortStrategy: Calculation['sortStrategy']
  globalRotation: Calculation['globalRotation']
  // Separation rules with their distances in the deck's unit.
  separationRulesInUnit: Calculation['separationRules']
}) {
  const [activeTripIndex, setActiveTripIndex] = useState(0)
  // Worked out by computeTrips (src/lib/trips.ts), as for a saved
  // calculation's trips — again only when what the packing reads changes,
  // not on every edit of the vessel's data.
  const { width, length, gap, boardOffset, clearance, outline, restrictionZones, loadZones, unit, maxDeckCargoT, objectKind } = deck
  const trips: PackingResult[] = useMemo(
    () =>
      computeTrips({
        mode,
        deck: { width, length, gap, boardOffset, clearance, outline, restrictionZones, loadZones, unit, maxDeckCargoT, objectKind },
        items,
        manualPlacements,
        pinnedPlacementsByTrip,
        sortStrategy,
        globalRotation,
        separationRulesInUnit,
      }),
    [mode, width, length, gap, boardOffset, clearance, outline, restrictionZones, loadZones, unit, maxDeckCargoT, objectKind, items, manualPlacements, pinnedPlacementsByTrip, sortStrategy, globalRotation, separationRulesInUnit]
  )

  // Clamp (rather than store) the selected trip in range as the trip count
  // changes (e.g. cargo edited so fewer/more voyages are needed) — avoids a
  // setState-in-effect render cascade for something purely derived. The
  // empty last trip packMultiTrip keeps isn't shown (shownTripsOf).
  const { shownTrips, lastTrip, hasEmptyTrailingTrip } = shownTripsOf(trips, mode, pinnedPlacementsByTrip)
  const clampedTripIndex = Math.max(0, Math.min(activeTripIndex, shownTrips.length - 1))
  const result = shownTrips[clampedTripIndex] ?? shownTrips[0]
  return { activeTripIndex, setActiveTripIndex, trips, lastTrip, hasEmptyTrailingTrip, shownTrips, clampedTripIndex, result }
}
