'use client'

import { ItemList } from '@/components/calculator/ItemList'
import { StampPicker } from '@/components/calculator/PlacementPanel'
import { PresetsBar } from '@/components/calculator/PresetsBar'
import type { PackingResult, PlacedItem } from '@/lib/packing'
import type { Unit } from '@/lib/units'

// «Грузы» (spec 13, stage 2): the cargo list, picking a cargo to place by
// click, and the presets — today's content. Stage 3 replaces it with the
// catalogue and the cargo table.
export function CargoSection({
  result,
  placedAcrossTrips,
  unit,
  hoveredItemId,
  onHover,
  onPlaceCustomShape,
}: {
  result: PackingResult
  placedAcrossTrips: PlacedItem[]
  unit: Unit
  hoveredItemId: string | null
  onHover: (id: string | null) => void
  onPlaceCustomShape: React.ComponentProps<typeof PresetsBar>['onPlaceCustomShape']
}) {
  return (
    <>
      <div data-tour="cargo-list">
        <ItemList embedded result={result} placedAcrossTrips={placedAcrossTrips} unit={unit} hoveredItemId={hoveredItemId} onHover={onHover} />
      </div>
      <StampPicker result={result} placedAcrossTrips={placedAcrossTrips} />
      <div className="px-4 py-3">
        <PresetsBar onPlaceCustomShape={onPlaceCustomShape} />
      </div>
    </>
  )
}
