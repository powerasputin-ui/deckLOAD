'use client'

import { MousePointerClick, RotateCw, Eraser, Package } from 'lucide-react'
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
import { cn } from '@/lib/utils'
import { useCalculator } from '@/store/calculator'
import type { CargoItem } from '@/lib/packing'
import { toast } from 'sonner'

interface ManualToolbarProps {
  placedCount: Map<string, number>
}

export function ManualToolbar({ placedCount }: ManualToolbarProps) {
  const items = useCalculator((s) => s.items)
  const activeStampId = useCalculator((s) => s.activeStampId)
  const setActiveStamp = useCalculator((s) => s.setActiveStamp)
  const stampRotated = useCalculator((s) => s.stampRotated)
  const toggleStampRotation = useCalculator((s) => s.toggleStampRotation)
  const clearManual = useCalculator((s) => s.clearManualPlacements)
  const manualPlacements = useCalculator((s) => s.manualPlacements)

  const totalRequested = items.reduce((s, it) => s + it.quantity, 0)
  const totalPlaced = manualPlacements.length

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <MousePointerClick className="h-4 w-4 text-primary" />
              Ручная расстановка
            </CardTitle>
            <CardDescription className="mt-1">
              Выберите груз и кликните по палубе. Перетаскивайте для перемещения.
            </CardDescription>
          </div>
          <Badge variant={totalPlaced >= totalRequested ? 'default' : 'secondary'}>
            {totalPlaced}/{totalRequested}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              toggleStampRotation()
              toast.info(stampRotated ? 'Обычная ориентация' : 'Поворот на 90°')
            }}
            className="flex-1"
          >
            <RotateCw className="h-4 w-4 mr-1.5" />
            {stampRotated ? 'Повернут ↻' : 'Без поворота'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => {
              clearManual()
              toast.info('Расстановка очищена')
            }}
            disabled={manualPlacements.length === 0}
          >
            <Eraser className="h-4 w-4 mr-1" />
            Очистить
          </Button>
        </div>

        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Сначала добавьте грузы
          </p>
        ) : (
          <ScrollArea className="max-h-[280px] pr-2">
            <div className="space-y-1.5">
              {items.map((it) => (
                <StampRow
                  key={it.id}
                  item={it}
                  active={activeStampId === it.id}
                  placed={placedCount.get(it.id) ?? 0}
                  onSelect={() => setActiveStamp(it.id)}
                />
              ))}
            </div>
          </ScrollArea>
        )}

        <div className="rounded-md bg-muted/50 p-2.5 text-[11px] text-muted-foreground space-y-1">
          <p>• Клик по палубе — поставить груз</p>
          <p>• Перетаскивание — переместить</p>
          <p>• ✕ на выбранном — удалить</p>
          <p>• Статистика пересчитывается автоматически</p>
        </div>
      </CardContent>
    </Card>
  )
}

function StampRow({
  item,
  active,
  placed,
  onSelect,
}: {
  item: CargoItem
  active: boolean
  placed: number
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
        className="h-8 w-8 shrink-0 rounded-md border border-black/10"
        style={{ backgroundColor: item.color }}
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{item.name}</div>
        <div className="text-[11px] text-muted-foreground">
          {item.width}×{item.length} · {placed}/{item.quantity} шт.
        </div>
      </div>
      {active && (
        <Badge variant="default" className="shrink-0 text-[10px]">
          активен
        </Badge>
      )}
    </button>
  )
}
