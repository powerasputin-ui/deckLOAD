'use client'

import { PenLine, Ship } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PanelBlock } from '@/components/shell/SectionPanel'
import { DeckSettings, LoadZonesSection, VesselStabilitySection } from '@/components/calculator/Sidebar'
import { useCalculator } from '@/store/calculator'
import { VESSEL_TEMPLATES, type VesselTemplate } from '@/lib/vesselTemplates'
import type { ZoneLoadCheck } from '@/lib/packing'
import { cn, fmtNumber } from '@/lib/utils'

// «Судно» (spec 13, stage 2): the vessel library, the deck, its shape, load
// zones and the vessel's stability data — today's content, moved here.
export function VesselSection({
  onApplyVesselTemplate,
  zoneLoads,
}: {
  onApplyVesselTemplate: (tpl: VesselTemplate) => void
  zoneLoads?: ZoneLoadCheck[]
}) {
  const vesselTemplateId = useCalculator((s) => s.deck.vesselTemplateId)
  const setEditingDeckOutline = useCalculator((s) => s.setEditingDeckOutline)

  return (
    <>
      <PanelBlock title="Судно из библиотеки">
        <ul className="space-y-1">
          {VESSEL_TEMPLATES.map((tpl) => {
            const applied = tpl.id === vesselTemplateId
            return (
              <li key={tpl.id}>
                <button
                  type="button"
                  onClick={() => onApplyVesselTemplate(tpl)}
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors hover:bg-accent',
                    applied ? 'border-line-strong bg-accent' : 'border-line'
                  )}
                >
                  <Ship className="mt-0.5 h-4 w-4 shrink-0 text-ink-2" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="flex items-baseline gap-1.5">
                      <span className="text-sm font-medium">{tpl.label}</span>
                      {applied && <span className="shrink-0 text-xs text-ink-2">применено</span>}
                    </span>
                    <span className="block text-xs text-ink-2">{vesselSummary(tpl)}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        <p className="text-xs text-ink-2">Создаёт новый расчёт с палубой и данными судна; груз остаётся пустым.</p>
      </PanelBlock>

      <div className="px-4 py-3">
        <DeckSettings />
        <Button variant="outline" size="sm" className="mt-1 w-full" onClick={() => setEditingDeckOutline(true)}>
          <PenLine className="mr-1.5 h-4 w-4" />
          Форма палубы
        </Button>
      </div>
      <div className="px-4 py-3">
        <LoadZonesSection zoneLoads={zoneLoads} />
      </div>
      <div className="px-4 py-3">
        <VesselStabilitySection />
      </div>
    </>
  )
}

// «Палуба 16.9×49.1 м · до 2550 т · 5–10 т/м²»
function vesselSummary(tpl: VesselTemplate): string {
  const parts = [`Палуба ${fmtNumber(tpl.deck.width)}×${fmtNumber(tpl.deck.length)} м`]
  if (tpl.limits?.maxDeckCargoT) parts.push(`до ${fmtNumber(tpl.limits.maxDeckCargoT)} т`)
  const strength = tpl.limits?.deckStrengthTPerM2
  if (strength) {
    parts.push(strength.min === strength.max ? `${fmtNumber(strength.min)} т/м²` : `${fmtNumber(strength.min)}–${fmtNumber(strength.max)} т/м²`)
  }
  return parts.join(' · ')
}
