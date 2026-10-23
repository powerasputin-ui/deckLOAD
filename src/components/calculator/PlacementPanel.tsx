'use client'

import { useId } from 'react'
import { RotateCw, Unlock, Wand2, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CargoNumberTile } from '@/components/calculator/CargoNumberTile'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { PanelBlock } from '@/components/shell/SectionPanel'
import { useCalculator } from '@/store/calculator'
import type { CargoItem, PackVariant, PackingResult, PlacedItem } from '@/lib/packing'
import { segmentsOf } from '@/lib/placementComposition'
import { cn, fmtNumber } from '@/lib/utils'
import { toast } from 'sonner'

// «Размещение»: the variants, clearing the layout and how the mode works
// (spec 13, stage 2 — today's content; 8.2 rebuilds it in stage 4).
export function PlacementControls({
  mode,
  tripIndex,
  result,
  onAutoRedistribute,
  variants,
  onSelectVariant,
}: {
  mode: 'auto' | 'manual'
  tripIndex: number
  result: PackingResult
  onAutoRedistribute: () => void
  variants?: PackVariant[]
  onSelectVariant?: (v: PackVariant) => void
}) {
  const pinnedPlacementsByTrip = useCalculator((s) => s.pinnedPlacementsByTrip)
  const pinnedPlacements = pinnedPlacementsByTrip[tripIndex] ?? []
  const manualPlacements = useCalculator((s) => s.manualPlacements)
  const clearPinned = useCalculator((s) => s.clearPinned)
  const clearManualPlacements = useCalculator((s) => s.clearManualPlacements)
  const globalRotation = useCalculator((s) => s.globalRotation)
  const toggleGlobalRotation = useCalculator((s) => s.toggleGlobalRotation)
  const rotationId = useId()

  const isAuto = mode === 'auto'
  const placements = isAuto ? pinnedPlacements : manualPlacements
  // Round 29 corrective pass: excludes Tier-2 quarantined placements (see
  // PinnedPlacement.malformed) from "is there anything to clear" — they're
  // preserved in the raw arrays above but never rendered/participate in
  // packing, so counting them here would show the "Снять
  // закрепления"/"Очистить" button with nothing visibly on the deck to
  // clear. Reads the authoritative `result.quarantined` (already computed
  // once by packDeck/packingResultFromManual) rather than re-implementing
  // the `malformed && !composition` predicate a second time here.
  const quarantinedIds = new Set(result.quarantined.map((q) => q.id))
  const hasPlacements = placements.some((p) => !quarantinedIds.has(p.id))

  const handleClearAll = () => {
    if (isAuto) {
      clearPinned(tripIndex)
      toast.info('Все закрепления сняты')
    } else {
      clearManualPlacements()
      toast.info('Расстановка очищена')
    }
  }

  return (
    <>
      <PanelBlock title={isAuto ? 'Авто-режим' : 'Ручной режим'}>
        <p className="text-sm text-ink-2">
          {isAuto
            ? 'Грузы расставляются сами, перетаскивание закрепляет штабель на новом месте.'
            : 'Каждый груз ставите вы: выберите груз в разделе «Грузы» и кликните по палубе.'}
        </p>
        <div className="flex items-start justify-between gap-3">
          <div>
            <label htmlFor={rotationId} className="text-sm">
              Разрешить поворот на 90°
            </label>
            <p id={`${rotationId}-hint`} className="text-xs text-ink-2">
              Авторасстановка может поворачивать грузы.
            </p>
          </div>
          <Switch
            id={rotationId}
            aria-describedby={`${rotationId}-hint`}
            checked={globalRotation}
            onCheckedChange={toggleGlobalRotation}
          />
        </div>
      </PanelBlock>

      <PanelBlock title="Раскладка">
        <Button
          variant="outline"
          size="sm"
          onClick={onAutoRedistribute}
          className="w-full"
          title="Сгенерировать несколько вариантов раскладки"
          data-tour="auto-redistribute"
        >
          <Wand2 className="mr-1.5 h-4 w-4" />
          Автораспределение (варианты)
        </Button>
        {variants && variants.length > 0 && onSelectVariant && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-ink-2">
              <Layers className="h-3.5 w-3.5" />
              Варианты раскладки ({variants.length})
            </div>
            <div className="space-y-1">
              {variants.map((v, i) => (
                <button
                  key={i}
                  onClick={() => onSelectVariant(v)}
                  className="flex w-full items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5 text-left transition-colors hover:bg-accent"
                >
                  <span className="truncate text-xs font-medium">{v.label}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <Badge variant="secondary" className="text-xs">{v.utilizationPct}%</Badge>
                    <span className="text-xs text-ink-2">{v.placedCount} ед.</span>
                  </span>
                </button>
              ))}
            </div>
            <p className="text-xs text-ink-2">Клик по варианту — применить. Кнопка «Автораспределение» — новый набор.</p>
          </div>
        )}
        {hasPlacements && (
          <Button variant="ghost" size="sm" onClick={handleClearAll} className="h-8 w-full text-xs">
            <Unlock className="mr-1.5 h-3.5 w-3.5" />
            {isAuto ? 'Снять все закрепления' : 'Очистить расстановку'}
          </Button>
        )}
      </PanelBlock>

      <PanelBlock title="Как работать с палубой">
        <ul className="space-y-1 text-xs text-ink-2">
          {isAuto ? (
            <>
              <li>• Выберите груз в разделе «Грузы» и кликните по палубе — штабель закрепится в этой точке</li>
              <li>• Клик по грузу — выделить; перетащите — закрепится на новом месте</li>
              <li>• ПКМ на грузе — «Закрепить» / «Вернуть в авто»</li>
              <li>• Shift+клик — выбрать несколько · ↻ на грузе — повернуть</li>
            </>
          ) : (
            <>
              <li>• Выберите груз в разделе «Грузы» и кликните по палубе</li>
              <li>• Перетаскивание — переместить</li>
              <li>• ↻ на грузе — повернуть</li>
              <li>• ✕ на грузе — удалить</li>
            </>
          )}
        </ul>
      </PanelBlock>
    </>
  )
}

// «Грузы»: pick a cargo, then click the deck to place it (both modes).
export function StampPicker({
  result,
  placedAcrossTrips,
}: {
  result: PackingResult
  // Every trip's placements. `result` is only the open trip, so counting
  // from it alone showed units sitting on another trip as «Не распределено».
  placedAcrossTrips?: PlacedItem[]
}) {
  const items = useCalculator((s) => s.items)
  const activeStampId = useCalculator((s) => s.activeStampId)
  const setActiveStamp = useCalculator((s) => s.setActiveStamp)
  const pendingPresetStamp = useCalculator((s) => s.pendingPresetStamp)
  const setPendingPresetStamp = useCalculator((s) => s.setPendingPresetStamp)
  const stampRotated = useCalculator((s) => s.stampRotated)
  const toggleStampRotation = useCalculator((s) => s.toggleStampRotation)

  // What's actually shown on the deck — result.placed includes both
  // deliberately pinned/manual placements AND whatever the auto-packer
  // filled in on its own for unpinned quantity. Counting only
  // pinnedPlacements/manualPlacements here used to undercount: increasing
  // an item's quantity in auto mode auto-places the extra units without
  // pinning them, so "Не распределено" kept showing units as missing even
  // though they were already visible on the deck.
  const placedForCounts = placedAcrossTrips ?? result.placed

  // Per-item placed count (same result.placed source, grouped by
  // constituent itemId — mirrors ItemList's own placedCount computation)
  // for the "всего / не распределено" line on each StampRow. Round 23:
  // composition-aware — segmentsOf degenerates to the placement's own
  // single implicit segment for an uncomposed placement, so this is
  // unchanged there; a composed placement now attributes each constituent
  // segment's own layers to its own itemId instead of dumping the whole
  // stack onto the nominal itemId alone.
  const placedByItemId = new Map<string, number>()
  for (const p of placedForCounts) {
    for (const seg of segmentsOf(p)) {
      const count = Number.isFinite(seg.layers) && seg.layers > 0 ? seg.layers : 1
      placedByItemId.set(seg.itemId, (placedByItemId.get(seg.itemId) ?? 0) + count)
    }
  }

  return (
    <PanelBlock title="Выбор груза для размещения">
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          toggleStampRotation()
        }}
        className="w-full"
        title="Влияет только на груз, который вы поставите следующим кликом. Уже размещённые грузы поворачиваются иконкой ↻ прямо на палубе."
      >
        <RotateCw className="mr-1.5 h-3.5 w-3.5" />
        Ориентация нового груза: {stampRotated ? '90°' : '0°'}
      </Button>
      <p className="text-xs leading-tight text-ink-2">
        Влияет на следующий клик. Размещённые грузы поворачиваются иконкой ↻ на палубе.
      </p>
      {pendingPresetStamp && (
        <p className="text-xs leading-tight text-ink-2">
          «{pendingPresetStamp.name}» из пресетов готов — кликните по палубе, чтобы разместить.
        </p>
      )}

      {items.length === 0 ? (
        <p className="py-2 text-center text-xs text-ink-2">Сначала добавьте грузы</p>
      ) : (
        <ScrollArea className="h-[200px] pr-1">
          <div className="space-y-1">
            {items.map((it) => {
              // A preset stamp stays armed (uncapped placement) after its
              // first click rather than converting to a normal capped
              // activeStampId — see page.tsx's onPlace. That left this
              // row with no visual "активен" state even while the user
              // could keep clicking the deck to place more of it, and no
              // obvious way to stop other than pressing Escape. Matching
              // by name (armed presets always resolve to the one item
              // that shares their name — addOrIncrementCargoFromTemplate
              // never creates a second one) shows the row as active, and
              // clicking it disarms the preset stamp directly instead of
              // routing through setActiveStamp, which would silently cap
              // it back at whatever quantity it already reached.
              const isArmedPreset = pendingPresetStamp?.name === it.name
              const active = activeStampId === it.id || isArmedPreset
              return (
                <StampRow
                  key={it.id}
                  item={it}
                  number={items.indexOf(it) + 1}
                  active={active}
                  rotated={active && stampRotated}
                  total={it.quantity}
                  remaining={Math.max(0, it.quantity - (placedByItemId.get(it.id) ?? 0))}
                  overPlaced={Math.max(0, (placedByItemId.get(it.id) ?? 0) - it.quantity)}
                  onSelect={() => {
                    if (isArmedPreset) {
                      setPendingPresetStamp(null)
                    } else {
                      setActiveStamp(activeStampId === it.id ? null : it.id)
                    }
                  }}
                />
              )
            })}
          </div>
        </ScrollArea>
      )}
    </PanelBlock>
  )
}

function StampRow({
  item,
  number,
  active,
  rotated,
  total,
  remaining,
  overPlaced,
  onSelect,
}: {
  item: CargoItem
  // The cargo's number in the list (its tone follows from it).
  number: number
  active: boolean
  rotated?: boolean
  total: number
  remaining: number
  overPlaced: number
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'w-full flex items-center gap-2.5 rounded-lg border p-2 text-left transition-all',
        active
          ? 'border-slate-400 bg-slate-100 ring-1 ring-slate-300 dark:bg-slate-800/40 dark:ring-slate-600'
          : 'border-border hover:bg-accent'
      )}
    >
      <CargoNumberTile number={number} className="h-7 w-7 text-xs" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate">{item.name}</div>
        <div className="text-xs text-muted-foreground">
          {rotated
            ? `${fmtNumber(item.length)}×${fmtNumber(item.width)} ↻`
            : `${fmtNumber(item.width)}×${fmtNumber(item.length)}`}
        </div>
        <div className={cn('text-xs', overPlaced > 0 ? 'text-red-600 dark:text-red-400 font-medium' : remaining === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>
          Всего: {total} · Не распределено: {remaining}
          {overPlaced > 0 && <> · ⚠ Превышено: {overPlaced}</>}
        </div>
      </div>
      {active && <Badge variant="default" className="shrink-0 text-xs">активен</Badge>}
    </button>
  )
}
