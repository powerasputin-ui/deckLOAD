'use client'

import { Ship, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import type { CargoItem, PackingResult } from '@/lib/packing'
import {
  buildLoadingConditionFromPlacements,
  computeStabilityResult,
  computeGZCurve,
  checkIMOCriteria,
  countMissingWeightPlacements,
  G_METACENTRIC_MIN_SAFE,
  type VesselStabilityData,
  type DeckShipFrame,
} from '@/lib/stability'
import type { Unit } from '@/lib/units'
import { cn, fmtNumber } from '@/lib/utils'

interface StabilityPanelProps {
  result: PackingResult
  deckWidth: number
  deckLength: number
  // The unit deckWidth/deckLength/result.placed are actually stored in
  // (deck.unit in the store) — required, not defaulted, so a caller can't
  // forget it and silently feed feet/centimetres into a metres-only solver.
  // See buildLoadingConditionFromPlacements's own doc comment.
  unit: Unit
  vessel?: VesselStabilityData
  shipFrame?: DeckShipFrame
  deckForwardIsPositiveY?: boolean
  // Catalog — needed ONLY to resolve a composed placement's per-segment
  // weight/height/stabilityOverride (see buildCargoWeightMoments's own doc
  // comment). Defaults to `[]`, same as the lib functions it's threaded
  // into, so no existing call site outside page.tsx breaks.
  items?: CargoItem[]
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

// A second, more specific warning — shown only when it actually applies —
// naming the ONE reason a green PASS from this tool could still be false:
// no free-surface data was entered, so GM_fluid == GM_solid (uncorrected).
function NoFreeSurfaceDataWarning() {
  return (
    <div className="rounded-md border border-red-300 bg-red-50/60 dark:bg-red-950/20 p-2 text-[11px] text-red-800 dark:text-red-300 flex gap-1.5">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
      <span>
        <b>Свободная поверхность в танках не введена.</b> Показанная GM может быть выше реальной. Добавьте
        танки/балласт/топливо с их моментом свободной поверхности в разделе «Остойчивость судна», чтобы это учесть.
      </span>
    </div>
  )
}

// Named the same way as NoFreeSurfaceDataWarning above — the ONE reason the
// numbers below could look like a normal green PASS while actually resting on
// a clamped-to-endpoint hydrostatic/KN value instead of the vessel's real
// current displacement. It leads the card, in larger type than the values
// it qualifies, and the values themselves turn grey with «оценка».
function OutOfRangeWarning({ hydrostatics, kn, displacementT }: { hydrostatics: boolean; kn: boolean; displacementT: number }) {
  const tables = hydrostatics && kn ? 'таблиц гидростатики и KN' : hydrostatics ? 'таблицы гидростатики' : 'таблицы KN'
  return (
    <div role="alert" className="rounded-md border border-red-300 bg-red-50/60 dark:bg-red-950/20 p-2.5 text-red-800 dark:text-red-300 space-y-1">
      <div className="flex items-center gap-1.5 text-lg font-semibold leading-tight">
        <AlertTriangle className="h-5 w-5 shrink-0" />
        {hydrostatics ? 'Числа ниже — только оценка' : 'Критерии ниже — только оценка'}
      </div>
      <p className="text-[11px]">
        Водоизмещение {fmtNumber(displacementT)} т вне {tables}. Взято ближайшее табличное значение, а не расчёт для
        этой загрузки, поэтому {hydrostatics ? 'GM, крен, дифферент и критерии' : 'кривая GZ и критерии'} не подтверждены.
      </p>
    </div>
  )
}

// Next to a number computed from a clamped table value (see OutOfRangeWarning).
function EstimateTag() {
  return <span className="rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground">оценка</span>
}

function MissingWeightWarning({ count }: { count: number }) {
  return (
    <div className="rounded-md border border-red-300 bg-red-50/60 dark:bg-red-950/20 p-2 text-[11px] text-red-800 dark:text-red-300 flex gap-1.5">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
      <span>
        <b>Груз без указанного веса не учтён в расчёте остойчивости (ед.: {count}).</b> Укажите вес в списке грузов,
        чтобы включить его.
      </span>
    </div>
  )
}

export function StabilityPanel({ result, deckWidth, deckLength, unit, vessel, shipFrame, deckForwardIsPositiveY, items }: StabilityPanelProps) {
  if (!vessel) {
    return (
      <Card data-tour="stability">
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
  const loading = buildLoadingConditionFromPlacements(vessel, frame, { width: deckWidth, length: deckLength }, deckForwardIsPositiveY ?? true, result.placed, unit, items ?? [])
  const stability = computeStabilityResult(vessel, loading)
  const gz = stability ? computeGZCurve(vessel, loading) : null
  const downfloodingAngleDeg = vessel.particulars.downfloodingAngleDeg
  const minGM = vessel.particulars.minGM
  const criteria = gz && stability ? checkIMOCriteria(gz, stability, downfloodingAngleDeg, minGM) : null
  const hasFreeSurfaceData = vessel.variableWeights.some((w) => (w.freeSurfaceMomentTm ?? 0) !== 0)
  const missingWeightCount = countMissingWeightPlacements(result.placed)

  if (!stability) {
    return (
      <Card data-tour="stability">
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

  // Judge against THIS vessel's own approved minimum whenever the loaded
  // vessel data carries one — the generic 0.15 m is a fallback, and for a
  // real offshore vessel it can be many times too lenient (see minGM).
  const gmLimit = minGM ?? G_METACENTRIC_MIN_SAFE
  const gmOk = stability.GM_fluid >= gmLimit
  // Hydrostatics feed GM, list, trim and the GM criterion; KN feeds the GZ
  // curve and the area/angle criteria.
  const hydroEstimated = stability.extrapolated
  const knEstimated = gz?.knOutOfRange ?? false
  const criteriaEstimated = hydroEstimated || knEstimated
  const listSideLabel = stability.listSide === 'starboard' ? 'на правый борт' : stability.listSide === 'port' ? 'на левый борт' : ''

  return (
    <Card data-tour="stability">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Ship className="h-4 w-4 text-primary" />
          Остойчивость судна
        </CardTitle>
        <CardDescription>
          {vessel.particulars.name || 'Судно без названия'} · водоизмещение {fmtNumber(stability.displacementKg / 1000)} т
          {criteriaEstimated && ' · вне таблиц, оценка'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {criteriaEstimated && (
          <OutOfRangeWarning hydrostatics={hydroEstimated} kn={knEstimated} displacementT={stability.displacementKg / 1000} />
        )}
        <Disclaimer />
        {!hasFreeSurfaceData && <NoFreeSurfaceDataWarning />}
        {missingWeightCount > 0 && <MissingWeightWarning count={missingWeightCount} />}

        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-lg border bg-card p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              GM (с поправкой на своб. поверхность)
              {hydroEstimated && <EstimateTag />}
            </div>
            <div
              className={cn(
                'font-bold tabular-nums mt-1',
                hydroEstimated ? 'text-base text-muted-foreground' : cn('text-xl', gmOk ? 'text-emerald-600' : 'text-red-600')
              )}
            >
              {fmtNumber(stability.GM_fluid)} м
            </div>
            <div className="text-[10px] text-muted-foreground">
              KM {fmtNumber(stability.KM)} м − KG {fmtNumber(stability.KG)} м − FSC {fmtNumber(stability.freeSurfaceCorrectionM)} м ·
              {minGM !== undefined
                ? ` допустимый минимум ${minGM} м (формуляр судна)`
                : ` мин. ориентир ${G_METACENTRIC_MIN_SAFE} м (общий)`}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              GM без поправки (GM_solid): {fmtNumber(stability.GM_solid)} м
            </div>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              Крен
              {hydroEstimated && <EstimateTag />}
            </div>
            <div
              className={cn(
                'font-bold tabular-nums mt-1',
                hydroEstimated
                  ? 'text-base text-muted-foreground'
                  : cn('text-xl', stability.listReliable ? 'text-foreground' : 'text-amber-600')
              )}
            >
              {fmtNumber(stability.listDeg)}° {listSideLabel}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {stability.listReliable
                ? 'малоугловая формула'
                : 'угол > 10° — малоугловая формула недостоверна, нужна кривая GZ'}
            </div>
          </div>
          <div className="rounded-lg border bg-card p-3 col-span-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              Дифферент
              {hydroEstimated && stability.trimM !== null && <EstimateTag />}
            </div>
            <div className={cn('font-bold tabular-nums mt-1', hydroEstimated ? 'text-base text-muted-foreground' : 'text-xl')}>
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
            <div className="flex items-center gap-1.5 text-sm font-medium">
              Критерии IMO IS Code 2008, Часть A
              {criteriaEstimated && <EstimateTag />}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Ветровой критерий (§2.3) для офшорных судов индивидуален и здесь не считается — см. формуляр остойчивости судна.
            </p>
            {downfloodingAngleDeg === undefined && (
              <p className="text-[10px] text-muted-foreground">
                Угол заливания не указан — площади считаются до стандартных 30°/40°, что может завышать результат для судов с
                меньшим реальным углом заливания.
              </p>
            )}
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-[11px]">
                <tbody>
                  {criteria.map((c) => (
                    <tr key={c.id} className="border-t first:border-t-0">
                      <td className="px-2 py-1.5">
                        {/* An estimate doesn't confirm a pass (or a fail): no green or red. */}
                        {c.pass ? (
                          <CheckCircle2
                            className={cn('h-3.5 w-3.5 inline mr-1', criteriaEstimated ? 'text-muted-foreground' : 'text-emerald-600')}
                          />
                        ) : (
                          <XCircle
                            className={cn('h-3.5 w-3.5 inline mr-1', criteriaEstimated ? 'text-muted-foreground' : 'text-red-600')}
                          />
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
            {gz.maxGZ <= 0 ? (
              <div className="text-[10px] font-medium text-red-600">
                Плечо остойчивости GZ не положительно ни на одном табличном угле крена — судно неостойчиво уже на
                нулевом крене (угол заката остойчивости 0°).
              </div>
            ) : (
              <div className="text-[10px] text-muted-foreground">
                Макс. GZ {fmtNumber(gz.maxGZ)} м при {fmtNumber(gz.angleOfMaxGZ)}°
                {gz.angleOfVanishingStability !== null && ` · угол заката остойчивости ${fmtNumber(gz.angleOfVanishingStability)}°`}
              </div>
            )}
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
