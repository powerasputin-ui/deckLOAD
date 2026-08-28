'use client'

import { TrendingUp, LayoutGrid, Square, Weight, CheckCircle2, AlertTriangle, Package, Layers } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { checkZoneLoads, computeFootprintPressures, type PackingResult, type LoadZone } from '@/lib/packing'
import { fmtNumber } from '@/lib/utils'
import { UNIT_LABEL, type Unit } from '@/store/calculator'

interface StatsPanelProps {
  result: PackingResult
  unit: Unit
  loadZones?: LoadZone[]
  deckOutline?: { x: number; y: number }[]
  // The vessel's own approved total deck-cargo capacity (t) — see
  // DeckConfig.maxDeckCargoT's doc comment. Undefined = not shown, not
  // "unlimited"; this used to exist only as text in the vessel picker and
  // was never actually checked against anything.
  maxDeckCargoT?: number
  // See DeckConfig.tenFootContainerCapacity's doc comment — purely
  // informational, never enforced.
  tenFootContainerCapacity?: number
}

export function StatsPanel({ result, unit, loadZones, deckOutline, maxDeckCargoT, tenFootContainerCapacity }: StatsPanelProps) {
  const {
    totalArea,
    usedArea,
    freeArea,
    utilization,
    placed,
    totalWeight,
    requestedCount,
    placedCount,
    breakdown,
    maxStackHeight,
  } = result

  const utilPct = Math.round(utilization * 100)
  const unitSym = UNIT_LABEL[unit]
  const unplacedCount = Math.max(0, requestedCount - placedCount)
  const overLoadedZoneCount =
    loadZones && loadZones.length > 0
      ? checkZoneLoads(
          placed.map((p) => ({
            x: p.x,
            y: p.y,
            width: p.width,
            length: p.length,
            totalWeightKg: (p.weight ?? 0) * p.stackedCount,
          })),
          loadZones,
          deckOutline,
          unit
        ).length
      : 0
  // Zone-average density (above) can absorb a heavy stack on a small
  // footprint without ever tripping — this is the complementary check
  // against each placement's OWN footprint pressure (see
  // computeFootprintPressures's doc comment; matches ДВТК п. 2.1.7's real
  // methodology). Shown separately, not merged with the zone count above,
  // since they're genuinely different numbers.
  const overPressureFootprintCount =
    loadZones && loadZones.length > 0
      ? computeFootprintPressures(
          placed.map((p) => ({
            x: p.x,
            y: p.y,
            width: p.width,
            length: p.length,
            totalWeightKg: (p.weight ?? 0) * p.stackedCount,
          })),
          loadZones,
          unit
        ).filter((c) => c.exceeded).length
      : 0
  // No dedicated "10-foot unit" field on CargoItem — the only real signal
  // across every 10' preset in PRESETS.containers (calculator.ts) is the
  // `10'` substring in its name (Контейнер 10' (2661)/(2591), Корзина
  // 10'). Same convention a live counter has to key off of, since the
  // catalog itself never tagged these any other way.
  const tenFootPlacedCount = placed.filter((p) => p.name.includes("10'")).reduce((s, p) => s + p.stackedCount, 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-4 w-4 text-primary" />
          Статистика загрузки
        </CardTitle>
        <CardDescription>
          Расчёт занятого и свободного пространства палубы
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Utilization */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium">Коэффициент загрузки</span>
            <span
              className={
                'text-2xl font-bold tabular-nums ' +
                (utilPct >= 85
                  ? 'text-emerald-600'
                  : utilPct >= 60
                    ? 'text-amber-600'
                    : 'text-muted-foreground')
              }
            >
              {utilPct}%
            </span>
          </div>
          <Progress value={utilPct} className="h-2.5" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>0%</span>
            <span>50%</span>
            <span>100%</span>
          </div>
        </div>

        {/* Area grid */}
        <div className="grid grid-cols-2 gap-2.5">
          <StatTile
            icon={<Square className="h-4 w-4" />}
            label="Занято"
            value={`${fmt(usedArea)} ${unitSym}²`}
            tone="primary"
          />
          <StatTile
            icon={<LayoutGrid className="h-4 w-4" />}
            label="Площадь палубы"
            value={`${fmt(totalArea)} ${unitSym}²`}
            tone="muted"
          />
          <StatTile
            icon={<Square className="h-4 w-4" />}
            label="Свободно"
            value={`${fmt(freeArea)} ${unitSym}²`}
            tone="emerald"
          />
          <StatTile
            icon={<Weight className="h-4 w-4" />}
            label="Общий вес"
            value={totalWeight > 0 ? `${fmt(totalWeight)} кг` : '—'}
            tone="amber"
          />
        </div>

        {/* Counts */}
        <div className="grid grid-cols-3 gap-2.5">
          <div className="rounded-lg border bg-emerald-50/50 dark:bg-emerald-950/20 p-3">
            <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              <span className="text-xs font-medium">Размещено</span>
            </div>
            <div className="text-xl font-bold tabular-nums mt-1">
              {placedCount}
            </div>
            <div className="text-[10px] text-muted-foreground">ед. груза</div>
          </div>
          <div className="rounded-lg border bg-blue-50/50 dark:bg-blue-950/20 p-3">
            <div className="flex items-center gap-1.5 text-blue-700 dark:text-blue-400">
              <LayoutGrid className="h-4 w-4" />
              <span className="text-xs font-medium">Типов груза</span>
            </div>
            <div className="text-xl font-bold tabular-nums mt-1">
              {breakdown.length}
            </div>
            <div className="text-[10px] text-muted-foreground">на палубе</div>
          </div>
          <div className="rounded-lg border bg-red-50/50 dark:bg-red-950/20 p-3">
            <div className="flex items-center gap-1.5 text-red-700 dark:text-red-400">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-xs font-medium">Не влезло</span>
            </div>
            <div className="text-xl font-bold tabular-nums mt-1">
              {unplacedCount}
            </div>
            <div className="text-[10px] text-muted-foreground">ед. груза</div>
          </div>
        </div>

        {/* Load capacity warnings */}
        {overLoadedZoneCount > 0 && (
          <div className="rounded-lg border border-red-300 bg-red-50/50 dark:bg-red-950/20 p-2.5 text-xs flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-red-700 dark:text-red-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              Превышена нагрузка на зону
            </span>
            <span className="font-bold tabular-nums">{overLoadedZoneCount} зон(ы)</span>
          </div>
        )}

        {overPressureFootprintCount > 0 && (
          <div className="rounded-lg border border-red-300 bg-red-50/50 dark:bg-red-950/20 p-2.5 text-xs flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-red-700 dark:text-red-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              Давление под грузом выше лимита зоны
            </span>
            <span className="font-bold tabular-nums">{overPressureFootprintCount} груз(ов)</span>
          </div>
        )}

        {/* result is one trip's cargo (see StatsPanel's totalWeight above,
            same caveat) — maxDeckCargoT is the vessel's own per-trip deck
            capacity, so comparing them directly is correct. */}
        {maxDeckCargoT !== undefined && (
          <div
            className={`rounded-lg border p-2.5 text-xs flex items-center justify-between ${
              totalWeight / 1000 > maxDeckCargoT
                ? 'border-red-300 bg-red-50/50 dark:bg-red-950/20'
                : 'bg-muted/30'
            }`}
          >
            <span
              className={`flex items-center gap-1.5 ${
                totalWeight / 1000 > maxDeckCargoT ? 'text-red-700 dark:text-red-400' : 'text-muted-foreground'
              }`}
            >
              {totalWeight / 1000 > maxDeckCargoT && <AlertTriangle className="h-3.5 w-3.5" />}
              Груз на палубе / лимит судна
            </span>
            <span className="font-bold tabular-nums">
              {fmtNumber(totalWeight / 1000)} / {fmtNumber(maxDeckCargoT)} т
            </span>
          </div>
        )}

        {/* Purely informational — see DeckConfig.tenFootContainerCapacity's
            doc comment for why this is never enforced (the registry figure
            itself is conditional, "when fully loaded with pipe"). */}
        {tenFootContainerCapacity !== undefined && (
          <div className="rounded-lg border bg-muted/30 p-2.5 text-xs flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              10-футовых контейнеров / лимит судна
            </span>
            <span className="font-bold tabular-nums">
              {tenFootPlacedCount} / {fmtNumber(tenFootContainerCapacity)}
            </span>
          </div>
        )}

        {/* Stack height indicator */}
        {maxStackHeight > 0 && (
          <div className="rounded-lg border bg-violet-50/50 dark:bg-violet-950/20 p-2.5 text-xs flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-violet-700 dark:text-violet-400">
              <Layers className="h-3.5 w-3.5" />
              Макс. высота штабеля
            </span>
            <span className="font-bold tabular-nums">
              {fmt(maxStackHeight)} {unitSym}
            </span>
          </div>
        )}

        {/* Per-item breakdown */}
        {breakdown.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <Package className="h-4 w-4 text-primary" />
              Учёт по грузам
            </div>
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr className="text-left">
                    <th className="px-2 py-1.5 font-medium">Груз</th>
                    <th
                      className="px-1.5 py-1.5 font-medium text-right"
                      title="Лимит «Ярусов», заданный в карточке груза. Если лимит не задан — высота самой высокой РЕАЛЬНО размещённой стопки этого груза"
                    >
                      Ярусы
                    </th>
                    <th className="px-1.5 py-1.5 font-medium text-right">Размещено</th>
                    <th className="px-1.5 py-1.5 font-medium text-right">Всего ед.</th>
                    <th className="px-1.5 py-1.5 font-medium text-right">Площадь</th>
                    <th className="px-2 py-1.5 font-medium text-right">Вес</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.map((b) => {
                    const partial = b.placed < b.requested
                    return (
                      <tr key={b.itemId} className="border-t">
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="h-2.5 w-2.5 rounded-sm shrink-0 border border-black/10"
                              style={{ backgroundColor: b.color }}
                            />
                            <span className="break-words">{b.name}</span>
                          </div>
                        </td>
                        <td className="px-1.5 py-1.5 text-right tabular-nums">
                          {b.layers > 1 ? `×${b.layers}` : '1'}
                        </td>
                        <td className="px-1.5 py-1.5 text-right tabular-nums text-muted-foreground">
                          {b.footprints}
                        </td>
                        <td className={'px-1.5 py-1.5 text-right tabular-nums font-medium ' + (partial ? 'text-amber-600' : '')}>
                          {b.placed}/{b.requested}
                        </td>
                        <td className="px-1.5 py-1.5 text-right tabular-nums text-muted-foreground">
                          {fmt(b.area)}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {b.weight > 0 ? fmt(b.weight) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function StatTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: string
  tone: 'muted' | 'primary' | 'emerald' | 'amber'
}) {
  const toneClass = {
    muted: 'text-muted-foreground',
    primary: 'text-primary',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    amber: 'text-amber-600 dark:text-amber-400',
  }[tone]
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className={`flex items-center gap-1.5 ${toneClass}`}>
        {icon}
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="text-base font-bold tabular-nums mt-1">{value}</div>
    </div>
  )
}

function fmt(v: number): string {
  return fmtNumber(v)
}
