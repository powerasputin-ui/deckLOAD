'use client'

import { Table2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ItemList } from '@/components/calculator/ItemList'
import { StampPicker } from '@/components/calculator/PlacementPanel'
import { PresetsBar } from '@/components/calculator/PresetsBar'
import type { PackingResult, PlacedItem } from '@/lib/packing'
import type { Unit } from '@/lib/units'

// «Грузы» (spec 13, stage 2): the cargo list, picking a cargo to place by
// click, and the presets — today's content. Stage 3 replaces it with the
// catalogue and the cargo table.
export function CargoSection({
  onOpenTable,
  result,
  placedAcrossTrips,
  unit,
  hoveredItemId,
  onHover,
  onPlaceCustomShape,
}: {
  // Opens the cargo table across the bottom (spec 5.4).
  onOpenTable: () => void
  result: PackingResult
  placedAcrossTrips: PlacedItem[]
  unit: Unit
  hoveredItemId: string | null
  onHover: (id: string | null) => void
  onPlaceCustomShape: React.ComponentProps<typeof PresetsBar>['onPlaceCustomShape']
}) {
  return (
    <>
      <div className="px-4 pt-4">
        <Button type="button" variant="outline" size="sm" className="w-full" onClick={onOpenTable}>
          <Table2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Таблица
        </Button>
      </div>
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
