'use client'

import { Scale } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PanelBlock } from '@/components/shell/SectionPanel'
import { LoadZonesSection } from '@/components/calculator/Sidebar'
import { VERDICT_WORD, VerdictIcon } from '@/components/stability/StabilityResults'
import { MarksBlock, ObstaclesBlock, SocketsBlock } from '@/components/sections/vessel/DeckMarksBlocks'
import { VesselLibrary } from '@/components/sections/vessel/VesselLibrary'
import { VesselCard } from '@/components/sections/vessel/VesselCard'
import { DeckBlock } from '@/components/sections/vessel/DeckBlock'
import { STATE_LABEL } from '@/lib/stabilityConditions'
import type { StatusLineInput } from '@/lib/statusLine'
import type { VesselTemplate } from '@/lib/vesselTemplates'
import type { ZoneLoadCheck } from '@/lib/packing'

// «Судно» (spec 8.1): the vessel from the library and its card, the deck,
// its shape, obstacles, load zones, sockets and marks; the vessel's
// stability data opens in the stability workspace (spec 2026-10-24, 6.2),
// with the open trip's verdict shown here.
export function VesselSection({
  onNewCalculationForVessel,
  onApplyVesselToCurrent,
  zoneLoads,
  stability,
  hasVessel,
  onOpenStability,
}: {
  onNewCalculationForVessel: (tpl: VesselTemplate) => void
  onApplyVesselToCurrent: (tpl: VesselTemplate) => void
  zoneLoads?: ZoneLoadCheck[]
  // The open trip's worse state, as the status line shows it; unset
  // without the vessel's data.
  stability: StatusLineInput['gm']
  hasVessel: boolean
  onOpenStability: () => void
}) {
  return (
    <>
      <VesselLibrary onNewCalculation={onNewCalculationForVessel} onApplyToCurrent={onApplyVesselToCurrent} />
      <VesselCard />
      <DeckBlock />
      <ObstaclesBlock />
      <div className="px-4 py-3">
        <LoadZonesSection zoneLoads={zoneLoads} />
      </div>
      <SocketsBlock />
      <MarksBlock />
      <PanelBlock title="Остойчивость">
        {stability ? (
          <div className="flex items-start gap-2" data-testid="vessel-stability-summary">
            <VerdictIcon verdict={stability.status} className="mt-0.5" />
            <div className="min-w-0 text-sm">
              <div className="font-medium tabular-nums">
                GM {stability.estimated && '≈'}
                {stability.valueM.toFixed(2)} м ({STATE_LABEL[stability.state].toLowerCase()})
              </div>
              <div className="text-xs text-ink-2">{VERDICT_WORD[stability.status]}</div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-ink-2" data-testid="vessel-stability-summary">
            {hasVessel ? 'Нет гидростатики судна' : 'Нет данных судна'}
          </p>
        )}
        <Button variant="outline" size="sm" className="w-full" onClick={onOpenStability}>
          <Scale className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Открыть остойчивость
        </Button>
      </PanelBlock>
    </>
  )
}
