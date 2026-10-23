'use client'

import { PlacementControls } from '@/components/calculator/PlacementPanel'
import { PanelBlock } from '@/components/shell/SectionPanel'
import type { PackVariant, PackingResult } from '@/lib/packing'

// «Размещение» (spec 13, stage 2): how the mode works, rotation, variants,
// clearing the layout and the trips. Stage 4 completes it per 8.2.
export function PlacementSection({
  mode,
  tripIndex,
  result,
  trips,
  onAutoRedistribute,
  variants,
  onSelectVariant,
}: {
  mode: 'auto' | 'manual'
  tripIndex: number
  result: PackingResult
  trips: readonly { placedCount: number; utilization: number }[]
  onAutoRedistribute: () => void
  variants?: PackVariant[]
  onSelectVariant?: (v: PackVariant) => void
}) {
  return (
    <>
      <PlacementControls
        mode={mode}
        tripIndex={tripIndex}
        result={result}
        onAutoRedistribute={onAutoRedistribute}
        variants={variants}
        onSelectVariant={onSelectVariant}
      />
      {trips.length > 1 && (
        <PanelBlock title="Рейсы">
          <ul className="space-y-1 text-sm tabular-nums">
            {trips.map((t, i) => (
              <li key={i} className={i === tripIndex ? 'font-medium' : 'text-ink-2'}>
                Рейс {i + 1} · {t.placedCount} ед. · {Math.round(t.utilization * 100)}%
              </li>
            ))}
          </ul>
        </PanelBlock>
      )}
    </>
  )
}
