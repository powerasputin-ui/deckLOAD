'use client'

import { useRef } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StabilityData } from '@/components/stability/StabilityData'
import { StabilityResults } from '@/components/stability/StabilityResults'
import { NO_DECK_HEIGHT, type TripStabilityResult } from '@/lib/stabilityConditions'
import { useCalculator } from '@/store/calculator'

// The stability workspace (spec 2026-10-24, 6.1; redesign spec 8.5): in
// place of the deck, the vessel's data on the left and the open trip's
// result on the right. «← К палубе» or Esc goes back.
export function StabilityWorkspace({
  evaluation,
  missing,
  trip,
  onClose,
  onChooseVessel,
}: {
  // The open trip by the booklet check; unset without the vessel's data.
  evaluation: TripStabilityResult | undefined
  // Why it isn't worked out though the vessel's data is there.
  missing?: string
  trip?: { index: number; count: number }
  onClose: () => void
  // Without the vessel's data (spec 10.3): the library, in «Судно».
  onChooseVessel: () => void
}) {
  const hasVessel = useCalculator((s) => !!s.deck.vessel)
  const dataRef = useRef<HTMLDivElement>(null)
  // «Заполнить данные»: the first field of the data column.
  const fillData = () => {
    const first = dataRef.current?.querySelector<HTMLElement>('input, select, textarea')
    first?.scrollIntoView({ block: 'center' })
    first?.focus()
  }
  // The deck's height above the keel, when that is what's missing.
  const fillDeckHeight = () => {
    const label = Array.from(dataRef.current?.querySelectorAll('label') ?? []).find((l) => l.textContent?.startsWith('Высота палубы над килем'))
    const field = label?.control as HTMLElement | null | undefined
    field?.scrollIntoView({ block: 'center' })
    field?.focus()
  }

  return (
    <section aria-labelledby="stability-workspace-title" className="flex min-h-0 flex-1 flex-col" data-testid="stability-workspace">
      <header className="flex items-center gap-3 border-b border-line px-4 py-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />К палубе
        </Button>
        <h2 id="stability-workspace-title" className="text-base font-semibold">
          Остойчивость{trip && trip.count > 1 && ` — рейс ${trip.index + 1} из ${trip.count}`}
        </h2>
      </header>
      <div className="min-h-0 flex-1 overflow-auto lg:grid lg:grid-cols-[minmax(24rem,30rem)_minmax(0,1fr)] lg:overflow-hidden">
        <div ref={dataRef} className="border-line px-4 py-3 lg:min-h-0 lg:overflow-auto lg:border-r">
          <StabilityData />
        </div>
        <div className="px-4 py-3 lg:min-h-0 lg:overflow-auto">
          <StabilityResults
            evaluation={evaluation}
            hasVessel={hasVessel}
            missing={missing}
            onChooseVessel={onChooseVessel}
            onFillData={missing === NO_DECK_HEIGHT ? fillDeckHeight : fillData}
          />
        </div>
      </div>
    </section>
  )
}
