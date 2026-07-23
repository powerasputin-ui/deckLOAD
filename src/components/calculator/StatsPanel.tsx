'use client'

import { TrendingUp, LayoutGrid, Square, PackageX, Weight, CheckCircle2, AlertTriangle } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { PackingResult } from '@/lib/packing'
import { UNIT_LABEL, type Unit } from '@/store/calculator'

interface StatsPanelProps {
  result: PackingResult
  unit: Unit
}

export function StatsPanel({ result, unit }: StatsPanelProps) {
  const {
    totalArea,
    usedArea,
    freeArea,
    utilization,
    placed,
    unplaced,
    totalWeight,
  } = result

  const utilPct = Math.round(utilization * 100)
  const unitSym = UNIT_LABEL[unit]

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
            icon={<LayoutGrid className="h-4 w-4" />}
            label="Площадь палубы"
            value={`${fmt(totalArea)} ${unitSym}²`}
            tone="muted"
          />
          <StatTile
            icon={<Square className="h-4 w-4" />}
            label="Занято"
            value={`${fmt(usedArea)} ${unitSym}²`}
            tone="primary"
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
        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-lg border bg-emerald-50/50 dark:bg-emerald-950/20 p-3">
            <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              <span className="text-xs font-medium">Размещено</span>
            </div>
            <div className="text-2xl font-bold tabular-nums mt-1">
              {placed.length}
            </div>
          </div>
          <div className="rounded-lg border bg-red-50/50 dark:bg-red-950/20 p-3">
            <div className="flex items-center gap-1.5 text-red-700 dark:text-red-400">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-xs font-medium">Не помещается</span>
            </div>
            <div className="text-2xl font-bold tabular-nums mt-1">
              {unplaced.length}
            </div>
          </div>
        </div>

        {/* Unplaced list */}
        {unplaced.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <PackageX className="h-4 w-4 text-destructive" />
              Не размещённые грузы
            </div>
            <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
              {unplaced.map((u, i) => (
                <div
                  key={`${u.itemId}-${i}`}
                  className="flex items-center justify-between gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-2.5 py-1.5 text-xs"
                >
                  <span className="truncate font-medium">{u.name}</span>
                  <Badge variant="destructive" className="shrink-0 text-[10px]">
                    {u.reason}
                  </Badge>
                </div>
              ))}
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
  const r = Math.round(v * 100) / 100
  return Number.isInteger(r) ? `${r}` : r.toFixed(2)
}
