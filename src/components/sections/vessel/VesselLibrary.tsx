'use client'

import { useState } from 'react'
import { Ship } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { PanelBlock } from '@/components/shell/SectionPanel'
import { useCalculator } from '@/store/calculator'
import { VESSEL_TEMPLATES, type VesselTemplate } from '@/lib/vesselTemplates'
import { deckForVesselDrops } from '@/lib/vesselDeck'
import { cn, fmtNumber } from '@/lib/utils'

// «Судно из библиотеки» (spec 8.1). Without cargo the vessel goes onto the
// open calculation; with cargo the user chooses a new calculation for it or
// the open one with its deck replaced, the cargo kept. What the old deck
// loses is said before it goes.
export function VesselLibrary({
  onNewCalculation,
  onApplyToCurrent,
}: {
  onNewCalculation: (tpl: VesselTemplate) => void
  onApplyToCurrent: (tpl: VesselTemplate) => void
}) {
  const vesselTemplateId = useCalculator((s) => s.deck.vesselTemplateId)
  const [asking, setAsking] = useState<{ tpl: VesselTemplate; hasCargo: boolean; drops: string[] } | null>(null)

  const choose = (tpl: VesselTemplate) => {
    const s = useCalculator.getState()
    const hasCargo = s.items.some((it) => it.quantity >= 1)
    const positions =
      s.mode === 'manual' ? s.manualPlacements.length : Object.values(s.pinnedPlacementsByTrip).reduce((n, pins) => n + pins.length, 0)
    const drops = deckForVesselDrops(s.deck, { mode: s.mode, count: positions })
    if (!hasCargo && drops.length === 0) onApplyToCurrent(tpl)
    else setAsking({ tpl, hasCargo, drops })
  }

  return (
    <PanelBlock title="Судно из библиотеки" fold="library">
      <ul className="space-y-1" aria-label="Суда из библиотеки">
        {VESSEL_TEMPLATES.map((tpl) => {
          const applied = tpl.id === vesselTemplateId
          return (
            <li key={tpl.id}>
              <button
                type="button"
                onClick={() => choose(tpl)}
                aria-current={applied ? 'true' : undefined}
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
                  {/* The vessel's data doesn't say which end of the deck is
                      the bow, so +y is assumed (spec 6.1). */}
                  {tpl.deckForwardIsPositiveY === undefined && (
                    <span className="block text-xs text-warn">Направление носа по умолчанию — проверьте</span>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <AlertDialog open={!!asking} onOpenChange={(open) => !open && setAsking(null)}>
        {asking && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{asking.hasCargo ? `Судно «${asking.tpl.label}»` : `Применить «${asking.tpl.label}» к расчёту?`}</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-sm text-ink-2">
                  {asking.hasCargo && <p>В расчёте есть груз. Начать новый расчёт с этим судном или заменить палубу в этом?</p>}
                  {asking.drops.length > 0 && (
                    <div>
                      <p>{asking.hasCargo ? 'При замене палубы будет удалено' : 'Будет удалено'} — это привязано к старой палубе:</p>
                      <ul className="mt-1 list-disc pl-5" aria-label="Будет удалено">
                        {asking.drops.map((d) => (
                          <li key={d}>{d}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {asking.hasCargo && <p>Груз останется и встанет на новую палубу заново; что не встанет — появится в «Проверках».</p>}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
              {asking.hasCargo && (
                <Button
                  onClick={() => {
                    onNewCalculation(asking.tpl)
                    setAsking(null)
                  }}
                >
                  Новый расчёт с этим судном
                </Button>
              )}
              <Button
                variant={asking.hasCargo ? 'outline' : 'default'}
                onClick={() => {
                  onApplyToCurrent(asking.tpl)
                  setAsking(null)
                }}
              >
                {asking.hasCargo ? 'Заменить палубу в текущем (груз останется)' : 'Применить'}
              </Button>
              <AlertDialogCancel>Отмена</AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </PanelBlock>
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
