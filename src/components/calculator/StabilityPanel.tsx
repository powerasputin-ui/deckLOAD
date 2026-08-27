'use client'

import { Ship, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import type { PackingResult } from '@/lib/packing'
import {
  buildLoadingConditionFromPlacements,
  computeStabilityResult,
  computeGZCurve,
  checkIMOCriteria,
  G_METACENTRIC_MIN_SAFE,
  type VesselStabilityData,
  type DeckShipFrame,
} from '@/lib/stability'
import { fmtNumber } from '@/lib/utils'

interface StabilityPanelProps {
  result: PackingResult
  deckWidth: number
  deckLength: number
  vessel?: VesselStabilityData
  shipFrame?: DeckShipFrame
  deckForwardIsPositiveY?: boolean
}

// A short, always-visible line — never a dismissable toast, never a
// close-button banner — reminding whoever reads these numbers that this is
// a planning aid, not the vessel's own approved loading instrument.
function Disclaimer() {
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50/60 dark:bg-amber-950/20 p-2 text-[11px] text-amber-800 dark:text-amber-300 flex gap-1.5">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
      <span>
        <b>Не заменяет судовой прибор загрузки.</b> Ознакомительный/плановый расчёт, не одобрен классификационным
        обществом для данного судна. Перед выходом в море используйте штатный одобренный прибор загрузки и
        информацию об остойчивости, утверждённую классом.
      </span>
    </div>
  )
}

export function StabilityPanel({ result, deckWidth, deckLength, vessel, shipFrame, deckForwardIsPositiveY }: StabilityPanelProps) {
  if (!vessel) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Ship className="h-4 w-4 text-primary" />
            Остойчивость судна
          </CardTitle>
          <CardDescription>Заполните данные судна в разделе «Остойчивость судна» слева</CardDescription>
        </CardHeader>
        <CardContent>
          <Disclaimer />
        </CardContent>
      </Card>
    )
  }

  const frame: DeckShipFrame = shipFrame ?? { originOffsetFromCenterlineM: 0, originOffsetFromMidshipsM: 0, heightAboveBaselineM: 0 }
  const loading = buildLoadingConditionFromPlacements(vessel, frame, { width: deckWidth, length: deckLength }, deckForwardIsPositiveY ?? true, result.placed)
  const stability = computeStabilityResult(vessel, loading)
  const gz = stability ? computeGZCurve(vessel, loading) : null
  const criteria = gz && stability ? checkIMOCriteria(gz, stability) : null

  if (!stability) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Ship className="h-4 w-4 text-primary" />
            Остойчивость судна
          </CardTitle>
          <CardDescription>Добавьте хотя бы одну точку гидростатики (KM), чтобы включить расчёт</CardDescription>
        </CardHeader>
        <CardContent>
          <Disclaimer />
        </CardContent>
      </Card>
    )
  }

  const gmOk = stability.GM_solid >= G_METACENTRIC_MIN_SAFE
  const listSideLabel = stability.listSide === 'starboard' ? 'на правый борт' : stability.listSide === 'port' ? 'на левый борт' : ''

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Ship className="h-4 w-4 text-primary" />
          Остойчивость судна
        </CardTitle>
        <CardDescription>
          {vessel.particulars.name || 'Судно без названия'} · водоизмещение {fmtNumber(stability.displacementKg / 1000)} т
          {stability.extrapolated && ' · за пределами таблицы гидростатики (экстраполяция)'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Disclaimer />

        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-lg border bg-card p-3">
            <div className="text-xs font-medium text-muted-foreground">GM (метацентрическая высота)</div>
            <div className={'text-xl font-bold tabular-nums mt-1 ' + (gmOk ? 'text-emerald-600' : 'text-red-600')}>
              {fmtNumber(stability.GM_solid)} м
            </div>
            <div className="text-[10px] text-muted-foreground">
              KM {fmtNumber(stability.KM)} м − KG {fmtNumber(stability.KG)} м · мин. ориентир {G_METACENTRIC_MIN_SAFE} м
            </div>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <div className="text-xs font-medium text-muted-foreground">Крен</div>
            <div className={'text-xl font-bold tabular-nums mt-1 ' + (stability.listReliable ? 'text-foreground' : 'text-amber-600')}>
              {fmtNumber(stability.listDeg)}° {listSideLabel}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {stability.listReliable
                ? 'малоугловая формула'
                : 'угол > 10° — малоугловая формула недостоверна, нужна кривая GZ'}
            </div>
          </div>
          <div className="rounded-lg border bg-card p-3 col-span-2">
            <div className="text-xs font-medium text-muted-foreground">Дифферент</div>
            <div className="text-xl font-bold tabular-nums mt-1">
              {stability.trimM !== null ? `${fmtNumber(Math.abs(stability.trimM))} м` : '—'}
              {stability.trimDirection === 'by-head' && ' на нос'}
              {stability.trimDirection === 'by-stern' && ' на корму'}
              {stability.trimDirection === 'even' && ' (ровно)'}
            </div>
            {stability.trimM === null && (
              <div className="text-[10px] text-muted-foreground">Добавьте LCB и MTC в точку гидростатики, чтобы включить расчёт</div>
            )}
          </div>
        </div>

        {gz && criteria ? (
          <div className="space-y-1.5">
            <div className="text-sm font-medium">Критерии IMO IS Code 2008, Часть A</div>
            <p className="text-[10px] text-muted-foreground">
              Ветровой критерий (§2.3) для офшорных судов индивидуален и здесь не считается — см. формуляр остойчивости судна.
            </p>
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-[11px]">
                <tbody>
                  {criteria.map((c) => (
                    <tr key={c.id} className="border-t first:border-t-0">
                      <td className="px-2 py-1.5">
                        {c.pass ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 inline mr-1" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 text-red-600 inline mr-1" />
                        )}
                        {c.description}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                        {fmtNumber(c.actualValue)} {c.unit} (треб. {fmtNumber(c.requiredValue)})
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-[10px] text-muted-foreground">
              Макс. GZ {fmtNumber(gz.maxGZ)} м при {fmtNumber(gz.angleOfMaxGZ)}°
              {gz.angleOfVanishingStability !== null && ` · угол заката остойчивости ${fmtNumber(gz.angleOfVanishingStability)}°`}
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Доступна только начальная GM/крен. Добавьте кросс-кривые KN из информации об остойчивости судна для полной
            кривой GZ и проверки критериев IMO IS Code Part A.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
