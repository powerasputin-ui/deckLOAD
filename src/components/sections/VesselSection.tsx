'use client'

import { useState } from 'react'
import { Scale } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FoldingBlocksContext, PanelBlock, type FoldingBlocks } from '@/components/shell/SectionPanel'
import { LoadZonesBlock } from '@/components/sections/vessel/LoadZonesBlock'
import { VERDICT_WORD, VerdictIcon } from '@/components/stability/StabilityResults'
import { DeckLashingPointsBlock, MarksBlock, ObstaclesBlock, SocketsBlock } from '@/components/sections/vessel/DeckMarksBlocks'
import { DeckPhotoBlock } from '@/components/sections/vessel/DeckPhotoBlock'
import { VesselLibrary } from '@/components/sections/vessel/VesselLibrary'
import { VesselCard } from '@/components/sections/vessel/VesselCard'
import { DeckBlock } from '@/components/sections/vessel/DeckBlock'
import { DRAWING_EDGE_WORD, hullSideEdges } from '@/lib/deckDrawing'
import { NO_DECK_HEIGHT, STATE_LABEL } from '@/lib/stabilityConditions'
import { firstOpenStep, REQUIRED_STEPS, vesselSteps, type VesselStepId } from '@/lib/vesselSteps'
import { vesselTemplateById, type VesselTemplate } from '@/lib/vesselTemplates'
import type { CheckStatus } from '@/lib/checks'
import type { StatusLineInput } from '@/lib/statusLine'
import type { ZoneLoadCheck } from '@/lib/packing'
import { useCalculator, UNIT_LABEL } from '@/store/calculator'
import { useVesselSteps } from '@/store/vesselSteps'
import { cn } from '@/lib/utils'

// «Судно» (spec 8.1, revision 2026-10-30) as steps to fill in, in order —
// the vessel from the library or the user's own deck, the deck, the
// vessel's limits, the load zones, its stability — and, below them, what's
// optional: obstacles, the deck's photo, sockets, lashing points tied to no
// stack, marks. Each block folds to its title and a line of what it holds,
// with a mark when something in it needs looking at. Entering the section
// opens the first step with a problem, or the first step of a calculation
// nothing is chosen for yet; after that the blocks open and fold only as
// the user opens and folds them. The vessel's stability data opens in the
// stability workspace (spec 2026-10-24, 6.2), with the open trip's verdict
// shown here.
export function VesselSection({
  projectId,
  fresh,
  checks,
  onNewCalculationForVessel,
  onApplyVesselToCurrent,
  zoneLoads,
  stability,
  stabilityMissing,
  hasVessel,
  onOpenStability,
}: {
  // The open calculation: which blocks the user opened is kept per one.
  projectId: string
  // Nothing is chosen for the vessel yet (workflow.ts, «Судно» not done).
  fresh: boolean
  // The checks whose findings belong to blocks here.
  checks: { deckWeight?: CheckStatus; zones?: CheckStatus }
  onNewCalculationForVessel: (tpl: VesselTemplate) => void
  onApplyVesselToCurrent: (tpl: VesselTemplate) => void
  zoneLoads?: ZoneLoadCheck[]
  // The open trip's worse state, as the status line shows it; unset
  // without the vessel's data.
  stability: StatusLineInput['gm']
  // Why it isn't worked out though the vessel's data is there.
  stabilityMissing?: string
  hasVessel: boolean
  onOpenStability: () => void
}) {
  const deck = useCalculator((s) => s.deck)
  const tpl = vesselTemplateById(deck.vesselTemplateId)
  const strength = tpl?.limits?.deckStrengthTPerM2
  const steps = vesselSteps({
    vesselLabel: tpl?.label,
    fresh,
    deck: {
      width: deck.width,
      length: deck.length,
      unitLabel: UNIT_LABEL[deck.unit],
      bow: DRAWING_EDGE_WORD[hullSideEdges(deck.width, deck.length, deck.deckForwardIsPositiveY ?? true).bow],
      bowAssumed: !!tpl && tpl.deckForwardIsPositiveY === undefined,
      maxDeckCargoT: deck.maxDeckCargoT,
      strength: strength && { chosenTPerM2: deck.deckStrengthChoiceTPerM2, pending: deck.deckStrengthChoiceTPerM2 === undefined },
      zones: deck.loadZones?.length ?? 0,
      obstacles: deck.restrictionZones?.length ?? 0,
      photo: !!deck.backgroundImage,
      sockets: deck.powerSockets?.length ?? 0,
      lashingPoints: (deck.lashingPoints ?? []).filter((p) => !p.placementId).length,
      marks: deck.annotations?.length ?? 0,
    },
    checks,
    stability: { gm: stability, missing: stabilityMissing, hasVessel },
  })

  // Picked once, on entering: nothing opens or folds under the user's hands.
  const [firstOpen] = useState(() => firstOpenStep(steps, fresh))
  const chosen = useVesselSteps((s) => s.byProject[projectId])
  const setChosen = useVesselSteps((s) => s.set)
  const isOpen = (id: VesselStepId) => (chosen ? !!chosen[id] : id === firstOpen)
  const folding: FoldingBlocks = {
    isOpen: (id) => isOpen(id as VesselStepId),
    toggle: (id) => {
      const step = id as VesselStepId
      setChosen(projectId, { ...(chosen ?? (firstOpen ? { [firstOpen]: true } : {})), [step]: !isOpen(step) })
    },
    line: (id) => {
      const step = id as VesselStepId
      const n = REQUIRED_STEPS.indexOf(step)
      return { ...steps[step], step: n >= 0 ? n + 1 : undefined }
    },
  }

  // A vessel chosen in step 1 is done with it: that block folds and the
  // step the vessel leaves to look at opens — its deck strength when its
  // sources disagree, else its deck. A new calculation for it opens on its
  // own pick, from its deck.
  const applyToCurrent = (tpl: VesselTemplate) => {
    onApplyVesselToCurrent(tpl)
    setChosen(projectId, { [tpl.limits?.deckStrengthTPerM2 ? 'card' : 'deck']: true })
  }

  return (
    <FoldingBlocksContext.Provider value={folding}>
      <VesselLibrary onNewCalculation={onNewCalculationForVessel} onApplyToCurrent={applyToCurrent} />
      <DeckBlock />
      <VesselCard />
      <LoadZonesBlock zoneLoads={zoneLoads} />
      <PanelBlock title="Остойчивость" fold="stability">
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
          <p className={cn('text-sm', stabilityMissing === NO_DECK_HEIGHT ? 'text-warn' : 'text-ink-2')} data-testid="vessel-stability-summary">
            {hasVessel ? (stabilityMissing === NO_DECK_HEIGHT ? `${NO_DECK_HEIGHT} — GM не посчитана` : 'Нет гидростатики судна') : 'Нет данных судна'}
          </p>
        )}
        <Button variant="outline" size="sm" className="w-full" onClick={onOpenStability}>
          <Scale className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Открыть остойчивость
        </Button>
      </PanelBlock>
      <p className="px-4 pb-2 pt-5 text-xs font-medium text-ink-2">Дополнительно</p>
      <ObstaclesBlock />
      <DeckPhotoBlock />
      <SocketsBlock />
      <DeckLashingPointsBlock />
      <MarksBlock />
    </FoldingBlocksContext.Provider>
  )
}
