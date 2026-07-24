'use client'

import {
  Pin,
  RotateCw,
  Trash2,
  X,
  Unlock,
  Move,
  Wand2,
  MousePointerClick,
  Package,
  Layers,
  Plus,
  Minus,
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
import type { CargoItem, PackVariant } from '@/lib/packing'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface PlacementPanelProps {
  mode: 'auto' | 'manual'
  onAutoRedistribute: () => void
  variants?: PackVariant[]
  onSelectVariant?: (v: PackVariant) => void
  onGroupLayerChange?: (delta: number) => void
  onGroupLayerChangeManual?: (delta: number) => void
  onRemovePinned?: (id: string) => void
}

export function PlacementPanel({
  mode,
  onAutoRedistribute,
  variants,
  onSelectVariant,
  onGroupLayerChange,
  onGroupLayerChangeManual,
  onRemovePinned,
}: PlacementPanelProps) {
  const items = useCalculator((s) => s.items)
  const pinnedPlacements = useCalculator((s) => s.pinnedPlacements)
  const selectedPinIds = useCalculator((s) => s.selectedPinIds)
  const selectedManualIds = useCalculator((s) => s.selectedManualIds)
  const manualPlacements = useCalculator((s) => s.manualPlacements)
  const updatePinned = useCalculator((s) => s.updatePinned)
  const removePinned = useCalculator((s) => s.removePinned)
  const clearPinned = useCalculator((s) => s.clearPinned)
  const clearSelection = useCalculator((s) => s.clearSelection)
  const clearManualSelection = useCalculator((s) => s.clearManualSelection)
  const clearManualPlacements = useCalculator((s) => s.clearManualPlacements)
  const activeStampId = useCalculator((s) => s.activeStampId)
  const setActiveStamp = useCalculator((s) => s.setActiveStamp)
  const stampRotated = useCalculator((s) => s.stampRotated)
  const toggleStampRotation = useCalculator((s) => s.toggleStampRotation)

  // In manual mode: selected = manualPlacements count; in auto: selected pins
  const isAuto = mode === 'auto'
  const placements = isAuto ? pinnedPlacements : manualPlacements
  const selectedCount = isAuto ? selectedPinIds.length : selectedManualIds.length
  const hasPlacements = placements.length > 0
  const showGroupActions = selectedCount > 0

  const totalRequested = items.reduce((s, it) => s + it.quantity, 0)
  const totalPlaced = isAuto
    ? pinnedPlacements.reduce((s, p) => s + p.layers, 0)
    : manualPlacements.reduce((s, m) => s + Math.max(1, m.layers), 0)

  const handleRotateSelected = () => {
    if (isAuto) {
      for (const pin of pinnedPlacements.filter((p) => selectedPinIds.includes(p.id))) {
        updatePinned(pin.id, {
          width: pin.length,
          length: pin.width,
          rotated: !pin.rotated,
        })
      }
      toast.info(`Повернуто: ${selectedPinIds.length} груз(ов)`)
    }
  }

  const handleDeleteSelected = () => {
    if (isAuto) {
      for (const id of selectedPinIds) {
        if (onRemovePinned) {
          onRemovePinned(id)
        } else {
          removePinned(id)
        }
      }
      toast.info(`Удалено: ${selectedPinIds.length} груз(ов)`)
    }
  }

  const handleClearAll = () => {
    if (isAuto) {
      clearPinned()
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

        {/* Manual mode: stamp selector */}
        {!isAuto && (
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
            {items.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-2">
                Сначала добавьте грузы
              </p>
            ) : (
              <ScrollArea className="max-h-[200px] pr-1">
                <div className="space-y-1">
                  {items.map((it) => (
                    <StampRow
                      key={it.id}
                      item={it}
                      active={activeStampId === it.id}
                      onSelect={() => setActiveStamp(it.id)}
                    />
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        )}

        {/* Selected items (both modes) */}
        {showGroupActions && (
          <div className="rounded-lg border bg-violet-50/50 dark:bg-violet-950/20 p-2.5 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-violet-700 dark:text-violet-400">
              <Move className="h-3.5 w-3.5" />
              Выбрано {selectedCount} {selectedCount === 1 ? 'груз' : 'грузов'}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(isAuto
                ? pinnedPlacements.filter((p) => selectedPinIds.includes(p.id))
                : manualPlacements.filter((m) => selectedManualIds.includes(m.id))
              )
                .slice(0, 6)
                .map((p) => (
                  <span
                    key={p.id}
                    className="inline-flex items-center gap-1 rounded-md border bg-card px-1.5 py-0.5 text-[11px]"
                  >
                    <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: p.color }} />
                    {p.name}
                    {(p.layers ?? 1) > 1 && <span className="text-muted-foreground">×{p.layers}</span>}
                  </span>
                ))}
            </div>
            {/* Group layer change buttons — available in both modes */}
            {(isAuto ? onGroupLayerChange : onGroupLayerChangeManual) && (
              <div className="grid grid-cols-2 gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    isAuto ? onGroupLayerChange?.(1) : onGroupLayerChangeManual?.(1)
                  }
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  + Ярус всем
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    isAuto ? onGroupLayerChange?.(-1) : onGroupLayerChangeManual?.(-1)
                  }
                >
                  <Minus className="h-3.5 w-3.5 mr-1" />
                  − Ярус всем
                </Button>
              </div>
            )}
            {/* Rotate + delete (auto mode only for pinned) */}
            {isAuto && (
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="outline" onClick={handleRotateSelected}>
                  <RotateCw className="h-3.5 w-3.5 mr-1" />
                  Повернуть
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleDeleteSelected}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Открепить
                </Button>
              </div>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => (isAuto ? clearSelection() : clearManualSelection())}
              className="w-full h-7 text-xs"
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Снять выделение
            </Button>
          </div>
        )}

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
              <div>• Клик по грузу — закрепить</div>
              <div>• Перетаскивание — переместить</div>
              <div>• Shift+клик — выбрать несколько</div>
              <div>• ↻ на грузе — повернуть</div>
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
  onSelect,
}: {
  item: CargoItem
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'w-full flex items-center gap-2.5 rounded-lg border p-2 text-left transition-all',
        active
          ? 'border-primary bg-primary/10 ring-1 ring-primary/30'
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
          {item.width}×{item.length}
        </div>
      </div>
      {active && <Badge variant="default" className="shrink-0 text-[10px]">активен</Badge>}
    </button>
  )
}
