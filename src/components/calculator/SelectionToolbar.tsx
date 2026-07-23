'use client'

import { Pin, RotateCw, Trash2, X, Layers, Unlock, Move } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { useCalculator } from '@/store/calculator'
import type { PinnedPlacement } from '@/lib/packing'
import { toast } from 'sonner'

interface SelectionToolbarProps {
  pinnedPlacements: PinnedPlacement[]
  selectedPinIds: string[]
}

export function SelectionToolbar({
  pinnedPlacements,
  selectedPinIds,
}: SelectionToolbarProps) {
  const updatePinned = useCalculator((s) => s.updatePinned)
  const removePinned = useCalculator((s) => s.removePinned)
  const clearPinned = useCalculator((s) => s.clearPinned)
  const clearSelection = useCalculator((s) => s.clearSelection)

  const selected = pinnedPlacements.filter((p) => selectedPinIds.includes(p.id))
  const hasPinned = pinnedPlacements.length > 0
  const hasSelection = selected.length > 0

  if (!hasPinned && !hasSelection) return null

  const handleRotate = () => {
    for (const pin of selected) {
      updatePinned(pin.id, {
        width: pin.length,
        length: pin.width,
        rotated: !pin.rotated,
      })
    }
    toast.info(`Повернуто: ${selected.length} груз(ов)`)
  }

  const handleDelete = () => {
    for (const pin of selected) {
      removePinned(pin.id)
    }
    toast.info(`Удалено: ${selected.length} груз(ов)`)
  }

  const handleUnpinAll = () => {
    clearPinned()
    toast.info('Все закрепления сняты — авто-распределение восстановлено')
  }

  return (
    <Card className="border-violet-200 dark:border-violet-900">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Pin className="h-4 w-4 text-violet-600" />
              Интерактивное редактирование
              {hasSelection && (
                <Badge variant="default" className="text-[10px]">
                  {selected.length}
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="mt-0.5">
              Перетащите грузы на схеме — остальные переупакуются автоматически
            </CardDescription>
          </div>
          {hasPinned && (
            <Button variant="ghost" size="sm" onClick={handleUnpinAll} className="h-7 text-xs">
              <Unlock className="h-3.5 w-3.5 mr-1" />
              Снять все
            </Button>
          )}
        </div>
      </CardHeader>
      {hasSelection && (
        <CardContent className="pt-0 space-y-3">
          <div className="rounded-lg border bg-violet-50/50 dark:bg-violet-950/20 p-2.5 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-violet-700 dark:text-violet-400">
              <Move className="h-3.5 w-3.5" />
              Выбрано {selected.length} {selected.length === 1 ? 'груз' : 'грузов'}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {selected.slice(0, 6).map((p) => (
                <span
                  key={p.id}
                  className="inline-flex items-center gap-1 rounded-md border bg-card px-1.5 py-0.5 text-[11px]"
                >
                  <span
                    className="h-2 w-2 rounded-sm"
                    style={{ backgroundColor: p.color }}
                  />
                  {p.name}
                  {p.layers > 1 && (
                    <span className="text-muted-foreground">×{p.layers}</span>
                  )}
                </span>
              ))}
              {selected.length > 6 && (
                <span className="text-[11px] text-muted-foreground">
                  +{selected.length - 6}
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" variant="outline" onClick={handleRotate}>
              <RotateCw className="h-3.5 w-3.5 mr-1.5" />
              Повернуть
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleDelete}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Открепить
            </Button>
          </div>

          <Button
            size="sm"
            variant="ghost"
            onClick={clearSelection}
            className="w-full h-7 text-xs"
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Снять выделение
          </Button>

          <div className="rounded-md bg-muted/50 p-2 text-[11px] text-muted-foreground space-y-0.5">
            <div className="flex items-center gap-1">
              <Layers className="h-3 w-3" /> Shift/Ctrl+клик — выбрать несколько
            </div>
            <div>• Перетаскивание — переместить груз</div>
            <div>• ✕ — открепить (груз вернётся в авто-распределение)</div>
          </div>
        </CardContent>
      )}
    </Card>
  )
}
