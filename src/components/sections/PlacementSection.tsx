'use client'

import { useId } from 'react'
import { Check, Unlock, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { NumberField } from '@/components/calculator/NumberField'
import { PanelBlock } from '@/components/shell/SectionPanel'
import { undoCalculator, useCalculator, UNIT_LABEL } from '@/store/calculator'
import { keptByVariants } from '@/lib/variantKeep'
import type { PackVariant, PackingResult, SortStrategy } from '@/lib/packing'
import { cn, fmtNumber, fmtTonnes, pluralRu } from '@/lib/utils'
import { toast } from 'sonner'

// The six packing orders, each with the line that says what it does
// (spec 8.2). Width runs across the ship, length along it.
const STRATEGIES: { id: SortStrategy; label: string; hint: string }[] = [
  { id: 'area-desc', label: 'По площади: крупные сначала', hint: 'Мелкие грузы заполняют промежутки между крупными — обычно плотнее всего' },
  { id: 'area-asc', label: 'По площади: мелкие сначала', hint: 'Крупным грузам может не хватить места — они уйдут в следующий рейс' },
  { id: 'width-desc', label: 'По ширине: широкие сначала', hint: 'Ширина — поперёк судна, от борта до борта' },
  { id: 'length-desc', label: 'По длине: длинные сначала', hint: 'Длина — вдоль судна, от носа до кормы' },
  { id: 'quantity-desc', label: 'По количеству: многочисленные сначала', hint: 'Сначала грузы, которых больше всего единиц' },
  { id: 'none', label: 'В порядке списка', hint: 'Грузы ставятся в том порядке, в каком идут в списке' },
]

// «Размещение» (spec 8.2): how the cargo is placed and what came of it on
// the open trip. What the status line's «81%» and «2 рейса» lead to comes
// first; the rules, set once, last.
export function PlacementSection({
  mode,
  tripIndex,
  result,
  trips,
  onSelectTrip,
  carriedToNextTrip,
  hasCargo,
  onPickVariants,
  variants,
  appliedVariant,
  onSelectVariant,
}: {
  mode: 'auto' | 'manual'
  tripIndex: number
  // The open trip.
  result: PackingResult
  trips: readonly { placedCount: number; utilization: number }[]
  onSelectTrip: (index: number) => void
  // Units going on from the open trip to the next ones.
  carriedToNextTrip: number
  hasCargo: boolean
  onPickVariants: () => void
  variants: readonly PackVariant[]
  // The variant the deck shows as it was applied, if any.
  appliedVariant?: number
  onSelectVariant: (v: PackVariant) => void
}) {
  const isAuto = mode === 'auto'
  return (
    <>
      <PanelBlock title="Режим">
        <p className="text-sm">
          {isAuto ? 'Авто: грузы расставляются сами, перетаскивание закрепляет' : 'Ручной: каждый груз ставите вы'}
        </p>
        <p className="text-xs text-ink-2">Переключатель «Авто | Ручной» — в верхней полосе</p>
      </PanelBlock>
      <TripSummary result={result} tripIndex={tripIndex} tripCount={trips.length} />
      {trips.length > 1 && (
        <PanelBlock title="Рейсы">
          <ul className="space-y-1" aria-label="Рейсы">
            {trips.map((t, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => onSelectTrip(i)}
                  aria-current={i === tripIndex ? 'true' : undefined}
                  className={cn(
                    'w-full rounded-md px-2 py-1 text-left text-sm tabular-nums transition-colors hover:bg-accent',
                    i === tripIndex ? 'bg-accent font-medium' : 'text-ink-2'
                  )}
                >
                  Рейс {i + 1} · {t.placedCount} ед. · {Math.round(t.utilization * 100)}%
                </button>
              </li>
            ))}
          </ul>
          {carriedToNextTrip > 0 && (
            <p className="text-xs text-ink-2" data-testid="placement-carry">
              {carriedToNextTrip} ед. {pluralRu(carriedToNextTrip, 'уходит', 'уходят', 'уходят')} в рейс {tripIndex + 2}
            </p>
          )}
        </PanelBlock>
      )}
      <LayoutBlock
        mode={mode}
        tripIndex={tripIndex}
        tripCount={trips.length}
        result={result}
        hasCargo={hasCargo}
        onPickVariants={onPickVariants}
        variants={variants}
        appliedVariant={appliedVariant}
        onSelectVariant={onSelectVariant}
      />
      <PlacementRules isAuto={isAuto} />
    </>
  )
}

// The open trip's numbers, once the load statistics' tiles (A.11).
function TripSummary({ result, tripIndex, tripCount }: { result: PackingResult; tripIndex: number; tripCount: number }) {
  const unit = useCalculator((s) => s.deck.unit)
  const clearance = useCalculator((s) => s.deck.clearance)
  const maxDeckCargoT = useCalculator((s) => s.deck.maxDeckCargoT)
  const u = UNIT_LABEL[unit]
  const overWeight = maxDeckCargoT !== undefined && result.totalWeight / 1000 > maxDeckCargoT
  const rows: [string, string, string?][] = [
    ['Загрузка площади', `${Math.round(result.utilization * 100)}%`],
    ['Занято', `${fmtNumber(result.usedArea)} ${u}²`],
    ['Свободно', `${fmtNumber(result.freeArea)} из ${fmtNumber(result.totalArea)} ${u}²`],
    [
      'Вес груза',
      maxDeckCargoT !== undefined ? `${fmtTonnes(result.totalWeight)} из ${fmtNumber(maxDeckCargoT)} т` : `${fmtTonnes(result.totalWeight)} т`,
      overWeight ? 'text-danger' : undefined,
    ],
    [
      'Наибольшая высота штабеля',
      result.maxStackHeight > 0
        ? clearance > 0
          ? `${fmtNumber(result.maxStackHeight)} из ${fmtNumber(clearance)} ${u}`
          : `${fmtNumber(result.maxStackHeight)} ${u}`
        : '—',
    ],
  ]
  return (
    <PanelBlock title={tripCount > 1 ? `Итог рейса ${tripIndex + 1}` : 'Итог рейса'}>
      <dl className="space-y-1 text-sm" data-testid="trip-summary">
        {rows.map(([term, value, tone]) => (
          <div key={term} className="flex items-baseline justify-between gap-3">
            <dt className="text-ink-2">{term}</dt>
            <dd className={cn('text-right font-medium tabular-nums', tone)}>{value}</dd>
          </div>
        ))}
      </dl>
    </PanelBlock>
  )
}

// «Подобрать варианты» and starting the layout over (spec 8.2).
function LayoutBlock({
  mode,
  tripIndex,
  tripCount,
  result,
  hasCargo,
  onPickVariants,
  variants,
  appliedVariant,
  onSelectVariant,
}: {
  mode: 'auto' | 'manual'
  tripIndex: number
  tripCount: number
  result: PackingResult
  hasCargo: boolean
  onPickVariants: () => void
  variants: readonly PackVariant[]
  appliedVariant?: number
  onSelectVariant: (v: PackVariant) => void
}) {
  const isAuto = mode === 'auto'
  const pins = useCalculator((s) => s.pinnedPlacementsByTrip[tripIndex])
  const manualPlacements = useCalculator((s) => s.manualPlacements)
  const lashingPoints = useCalculator((s) => s.deck.lashingPoints)
  const clearPinned = useCalculator((s) => s.clearPinned)
  const clearManualPlacements = useCalculator((s) => s.clearManualPlacements)
  const placements = isAuto ? (pins ?? []) : manualPlacements
  const kept = keptByVariants(placements, lashingPoints).length
  // A quarantined record isn't on the deck, so there's nothing of it to
  // clear (it waits in «Проверки» instead).
  const quarantinedIds = new Set(result.quarantined.map((q) => q.id))
  const hasManualPlacements = manualPlacements.some((p) => !quarantinedIds.has(p.id))

  const undoAction = { label: 'Отменить', onClick: () => undoCalculator() }
  const unpinAll = () => {
    clearPinned(tripIndex)
    toast.info(tripCount > 1 ? `Закрепления рейса ${tripIndex + 1} сняты` : 'Все закрепления сняты', { action: undoAction })
  }
  const clearLayout = () => {
    clearManualPlacements()
    toast.info('Расстановка очищена', { action: undoAction })
  }

  return (
    <PanelBlock title="Раскладка">
      <Button
        variant="outline"
        size="sm"
        onClick={onPickVariants}
        disabled={!hasCargo}
        title={hasCargo ? 'Три раскладки этого рейса; лучшая применяется сразу' : 'Сначала добавьте груз'}
        className="w-full"
      >
        <Wand2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
        Подобрать варианты
      </Button>
      {variants.length > 0 && (
        <div className="space-y-1">
          <ul className="space-y-1" aria-label="Варианты раскладки">
            {variants.map((v, i) => {
              const applied = i === appliedVariant
              return (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => onSelectVariant(v)}
                    aria-pressed={applied}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm tabular-nums transition-colors hover:bg-accent',
                      applied ? 'border-line-strong bg-accent' : 'border-line'
                    )}
                  >
                    <span className="min-w-0">
                      {v.label} · {v.utilizationPct}% · {v.placedCount} ед.
                    </span>
                    {applied && (
                      <span className="flex shrink-0 items-center gap-0.5 text-xs text-ink-2">
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        на палубе
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="text-xs text-ink-2">Клик по варианту — применить</p>
        </div>
      )}
      {kept > 0 && (
        <p className="text-xs text-ink-2" data-testid="variants-kept">
          {isAuto
            ? `Закреплённые штабели (${kept}) остаются на местах`
            : `Штабели с зоной отступа или креплением (${kept}) остаются на местах`}
          {isAuto && (
            <>
              {' · '}
              <button type="button" onClick={unpinAll} className="underline underline-offset-2 hover:text-ink">
                Снять все закрепления
              </button>
            </>
          )}
        </p>
      )}
      {!isAuto && hasManualPlacements && (
        <Button variant="ghost" size="sm" onClick={clearLayout} className="h-8 w-full text-xs">
          <Unlock className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Очистить расстановку
        </Button>
      )}
    </PanelBlock>
  )
}

// Strategy, gap and rotation: the placement settings (spec 8.7).
function PlacementRules({ isAuto }: { isAuto: boolean }) {
  const sortStrategy = useCalculator((s) => s.sortStrategy)
  const setSortStrategy = useCalculator((s) => s.setSortStrategy)
  const gap = useCalculator((s) => s.deck.gap)
  const unit = useCalculator((s) => s.deck.unit)
  const setDeck = useCalculator((s) => s.setDeck)
  const globalRotation = useCalculator((s) => s.globalRotation)
  const toggleGlobalRotation = useCalculator((s) => s.toggleGlobalRotation)
  const dropPackerLayout = useCalculator((s) => s.dropPackerLayout)
  const uid = useId()
  const strategy = STRATEGIES.find((s) => s.id === sortStrategy) ?? STRATEGIES[0]

  // An applied variant is held on the deck by the packer's own pins, so a
  // new rule used to change nothing there: in auto mode the layout is
  // started afresh under it. The rule itself isn't in the undo history, so
  // «Отменить» puts it back along with the layout.
  const changeRule = (apply: () => void, revert: () => void) => {
    const dropped = isAuto ? dropPackerLayout() : 0
    apply()
    if (dropped > 0) {
      toast.info('Груз расставлен заново по новому правилу', {
        action: {
          label: 'Отменить',
          onClick: () => {
            undoCalculator()
            revert()
          },
        },
      })
    }
  }

  return (
    <PanelBlock title="Правила расстановки">
      <div className="space-y-1">
        <label htmlFor={`${uid}-strategy`} className="text-xs text-ink-2">
          Стратегия упаковки
        </label>
        <Select
          value={sortStrategy}
          onValueChange={(v) =>
            changeRule(
              () => setSortStrategy(v as SortStrategy),
              () => setSortStrategy(sortStrategy)
            )
          }
        >
          <SelectTrigger id={`${uid}-strategy`} aria-describedby={`${uid}-strategy-hint`} className="h-8 w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STRATEGIES.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p id={`${uid}-strategy-hint`} className="text-xs text-ink-2">
          {strategy.hint}
          {/* The manual layout is the user's; the strategy orders only the
              auto mode's own packing. */}
          {!isAuto && '. Действует в авто-режиме'}
        </p>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${uid}-gap`} className="text-xs text-ink-2">
          Отступ между грузами
        </label>
        <div className="flex items-center gap-1.5">
          <NumberField
            id={`${uid}-gap`}
            aria-describedby={`${uid}-gap-hint`}
            min={0}
            step={0.05}
            value={gap}
            onCommit={(v) => setDeck({ gap: v })}
            className="h-8 flex-1 text-xs"
          />
          <span className="w-6 text-xs text-ink-2">{UNIT_LABEL[unit]}</span>
        </div>
        <p id={`${uid}-gap-hint`} className="text-xs text-ink-2">
          Свободный промежуток между соседними штабелями — и при авторасстановке, и при постановке кликом
        </p>
      </div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <label htmlFor={`${uid}-rotation`} className="text-sm">
            Разрешить поворот на 90°
          </label>
          <p id={`${uid}-rotation-hint`} className="text-xs text-ink-2">
            Авторасстановка может поворачивать грузы. Запретить для отдельного груза — столбец «Поворот» в таблице. Поворот
            при постановке кликом — клавиша R
          </p>
        </div>
        <Switch
          id={`${uid}-rotation`}
          aria-describedby={`${uid}-rotation-hint`}
          checked={globalRotation}
          onCheckedChange={() => changeRule(toggleGlobalRotation, () => useCalculator.setState({ globalRotation }))}
        />
      </div>
    </PanelBlock>
  )
}
