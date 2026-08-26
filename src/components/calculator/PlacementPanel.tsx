'use client'

import {
  Pin,
  RotateCw,
  Unlock,
  Wand2,
  MousePointerClick,
  Package,
  Layers,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useCalculator } from '@/store/calculator'
import type { CargoItem, PackVariant, PackingResult } from '@/lib/packing'
import { cn, fmtNumber } from '@/lib/utils'
import { toast } from 'sonner'

interface PlacementPanelProps {
  mode: 'auto' | 'manual'
  tripIndex: number
  result: PackingResult
  onAutoRedistribute: () => void
  variants?: PackVariant[]
  onSelectVariant?: (v: PackVariant) => void
}

export function PlacementPanel({
  mode,
  tripIndex,
  result,
  onAutoRedistribute,
  variants,
  onSelectVariant,
}: PlacementPanelProps) {
  const items = useCalculator((s) => s.items)
  const pinnedPlacementsByTrip = useCalculator((s) => s.pinnedPlacementsByTrip)
  const pinnedPlacements = pinnedPlacementsByTrip[tripIndex] ?? []
  const manualPlacements = useCalculator((s) => s.manualPlacements)
  const clearPinned = useCalculator((s) => s.clearPinned)
  const clearManualPlacements = useCalculator((s) => s.clearManualPlacements)
  const activeStampId = useCalculator((s) => s.activeStampId)
  const setActiveStamp = useCalculator((s) => s.setActiveStamp)
  const pendingPresetStamp = useCalculator((s) => s.pendingPresetStamp)
  const setPendingPresetStamp = useCalculator((s) => s.setPendingPresetStamp)
  const stampRotated = useCalculator((s) => s.stampRotated)
  const toggleStampRotation = useCalculator((s) => s.toggleStampRotation)

  const isAuto = mode === 'auto'
  const placements = isAuto ? pinnedPlacements : manualPlacements
  const hasPlacements = placements.length > 0

  const totalRequested = items.reduce((s, it) => s + it.quantity, 0)
  // What's actually shown on the deck — result.placed includes both
  // deliberately pinned/manual placements AND whatever the auto-packer
  // filled in on its own for unpinned quantity. Counting only
  // pinnedPlacements/manualPlacements here used to undercount: increasing
  // an item's quantity in auto mode auto-places the extra units without
  // pinning them, so "Не распределено" kept showing units as missing even
  // though they were already visible on the deck.
  const totalPlaced = result.placedCount

  // Per-item placed count (same result.placed source, grouped by itemId —
  // mirrors ItemList's own placedCount computation) for the "всего / не
  // распределено" line on each StampRow.
  const placedByItemId = new Map<string, number>()
  for (const p of result.placed) {
    const count = Number.isFinite(p.stackedCount) && p.stackedCount > 0 ? p.stackedCount : 1
    placedByItemId.set(p.itemId, (placedByItemId.get(p.itemId) ?? 0) + count)
  }

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
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              {isAuto ? <Pin className="h-4 w-4 text-violet-600" /> : <MousePointerClick className="h-4 w-4 text-primary" />}
              {isAuto ? 'Интерактивное редактирование' : 'Ручная расстановка'}
            </CardTitle>
            <CardDescription className="mt-0.5">
              {isAuto
                ? 'Перетащите грузы — остальные переупакуются'
                : 'Кликайте по палубе для размещения грузов'}
            </CardDescription>
          </div>
          <Badge variant={totalPlaced >= totalRequested ? 'default' : 'secondary'}>
            {totalPlaced}/{totalRequested}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Auto redistribute button — available in both modes */}
        <Button
          variant="default"
          size="sm"
          onClick={onAutoRedistribute}
          className="w-full"
          title="Сгенерировать несколько вариантов раскладки"
        >
          <Wand2 className="h-3.5 w-3.5 mr-1.5" />
          Автораспределение (варианты)
        </Button>

        {/* Variants selector — shown after redistribute */}
        {variants && variants.length > 0 && onSelectVariant && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Layers className="h-3.5 w-3.5" />
              Варианты раскладки ({variants.length})
            </div>
            <div className="space-y-1">
              {variants.map((v, i) => (
                <button
                  key={i}
                  onClick={() => onSelectVariant(v)}
                  className="w-full flex items-center justify-between gap-2 rounded-md border border-border hover:bg-accent px-2.5 py-1.5 text-left transition-colors"
                >
                  <span className="text-xs font-medium truncate">{v.label}</span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="secondary" className="text-[10px]">{v.utilizationPct}%</Badge>
                    <span className="text-[10px] text-muted-foreground">{v.placedCount} ед.</span>
                  </span>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Клик по варианту — применить. Кнопка «Автораспределение» — новый набор.
            </p>
          </div>
        )}

        {/* Stamp selector — click-to-place works in both modes now. The
            preset catalog itself lives in the left sidebar's "Пресеты"
            section; picking a row there arms pendingPresetStamp exactly
            like picking a row here does, so this list doesn't need to
            switch views for it. */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Package className="h-3.5 w-3.5" />
            Выбор груза для размещения
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              toggleStampRotation()
            }}
            className="w-full"
            title="Влияет только на груз, который вы поставите следующим кликом. Уже размещённые грузы поворачиваются иконкой ↻ прямо на палубе."
          >
            <RotateCw className="h-3.5 w-3.5 mr-1.5" />
            Ориентация нового груза: {stampRotated ? '90°' : '0°'}
          </Button>
          <p className="text-[10px] text-muted-foreground leading-tight">
            Влияет на следующий клик. Размещённые грузы поворачиваются иконкой ↻ на палубе.
          </p>
          {pendingPresetStamp && (
            <p className="text-[10px] text-muted-foreground leading-tight">
              «{pendingPresetStamp.name}» из пресетов готов — кликните по палубе, чтобы разместить.
            </p>
          )}

          {items.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-2">
              Сначала добавьте грузы
            </p>
          ) : (
            <ScrollArea className="h-[340px] pr-1">
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
                      active={active}
                      rotated={active && stampRotated}
                      total={it.quantity}
                      remaining={Math.max(0, it.quantity - (placedByItemId.get(it.id) ?? 0))}
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
        </div>

        {/* Clear all */}
        {hasPlacements && (
          <Button variant="ghost" size="sm" onClick={handleClearAll} className="w-full h-8 text-xs">
            <Unlock className="h-3.5 w-3.5 mr-1.5" />
            {isAuto ? 'Снять все закрепления' : 'Очистить расстановку'}
          </Button>
        )}

        {/* Tips */}
        <div className="rounded-md bg-muted/50 p-2 text-[11px] text-muted-foreground space-y-0.5">
          {isAuto ? (
            <>
              <div>• Выберите груз слева и кликните по палубе — закрепит его в этой точке</div>
              <div>• Клик по уже размещённому грузу — выделить и перетащить</div>
              <div>• ПКМ на грузе — «Закрепить»/«Открепить» (блокирует перетаскивание)</div>
              <div>• Shift+клик — выбрать несколько · ↻ на грузе — повернуть</div>
            </>
          ) : (
            <>
              <div>• Выберите груз и кликните по палубе</div>
              <div>• Перетаскивание — переместить</div>
              <div>• ↻ на грузе — повернуть</div>
              <div>• ✕ на грузе — удалить</div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function StampRow({
  item,
  active,
  rotated,
  total,
  remaining,
  onSelect,
}: {
  item: CargoItem
  active: boolean
  rotated?: boolean
  total: number
  remaining: number
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
      <span
        className="h-7 w-7 shrink-0 rounded-md border border-black/10"
        style={{ backgroundColor: item.color }}
      />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate">{item.name}</div>
        <div className="text-[10px] text-muted-foreground">
          {rotated
            ? `${fmtNumber(item.length)}×${fmtNumber(item.width)} ↻`
            : `${fmtNumber(item.width)}×${fmtNumber(item.length)}`}
        </div>
        <div className={cn('text-[10px]', remaining === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>
          Всего: {total} · Не распределено: {remaining}
        </div>
      </div>
      {active && <Badge variant="default" className="shrink-0 text-[10px]">активен</Badge>}
    </button>
  )
}
