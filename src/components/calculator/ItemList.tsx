'use client'

import { useState } from 'react'
import {
  Plus,
  Copy,
  Trash2,
  RotateCw,
  Lock,
  Package,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  useCalculator,
  UNIT_LABEL,
  type Unit,
} from '@/store/calculator'
import type { CargoItem, PackingResult } from '@/lib/packing'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface ItemListProps {
  result: PackingResult
  unit: Unit
  hoveredItemId: string | null
  onHover: (id: string | null) => void
}

export function ItemList({ result, unit, hoveredItemId, onHover }: ItemListProps) {
  const items = useCalculator((s) => s.items)
  const addItem = useCalculator((s) => s.addItem)
  const updateItem = useCalculator((s) => s.updateItem)
  const removeItem = useCalculator((s) => s.removeItem)
  const duplicateItem = useCalculator((s) => s.duplicateItem)
  const globalRotation = useCalculator((s) => s.globalRotation)

  // count placed per item id
  const placedCount = new Map<string, number>()
  for (const p of result.placed) {
    placedCount.set(p.itemId, (placedCount.get(p.itemId) ?? 0) + 1)
  }

  return (
    <Card className="flex flex-col h-full">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="h-4 w-4 text-primary" />
              Грузы
              <Badge variant="secondary">{items.length}</Badge>
            </CardTitle>
            <CardDescription className="mt-1">
              Размеры в {UNIT_LABEL[unit]}. Настройте вращение каждого груза.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => { addItem(); toast.success('Груз добавлен') }}>
            <Plus className="h-4 w-4 mr-1" />
            Добавить
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 p-3">
        {items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground py-10 gap-3">
            <Package className="h-10 w-10 opacity-40" />
            <div>
              <p className="font-medium">Список грузов пуст</p>
              <p className="text-sm">Добавьте груз или выберите пресет</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => addItem()}>
              <Plus className="h-4 w-4 mr-1" />
              Добавить груз
            </Button>
          </div>
        ) : (
          <ScrollArea className="h-full max-h-[460px] pr-3">
            <div className="space-y-2.5">
              {items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  unit={unit}
                  placed={placedCount.get(item.id) ?? 0}
                  globalRotation={globalRotation}
                  hovered={hoveredItemId === item.id}
                  onHover={onHover}
                  onUpdate={(patch) => updateItem(item.id, patch)}
                  onRemove={() => { removeItem(item.id); toast.info('Груз удалён') }}
                  onDuplicate={() => { duplicateItem(item.id); toast.success('Груз дублирован') }}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}

interface ItemRowProps {
  item: CargoItem
  unit: Unit
  placed: number
  globalRotation: boolean
  hovered: boolean
  onHover: (id: string | null) => void
  onUpdate: (patch: Partial<CargoItem>) => void
  onRemove: () => void
  onDuplicate: () => void
}

function ItemRow({
  item,
  unit,
  placed,
  globalRotation,
  hovered,
  onHover,
  onUpdate,
  onRemove,
  onDuplicate,
}: ItemRowProps) {
  const [editName, setEditName] = useState(false)
  const area = item.width * item.length * item.quantity
  const allPlaced = placed >= item.quantity
  const nonePlaced = placed === 0
  const rotationEnabled = globalRotation && item.allowRotation

  return (
    <div
      className={cn(
        'rounded-lg border bg-card p-3 transition-all',
        hovered ? 'border-primary ring-2 ring-primary/20 shadow-sm' : 'border-border'
      )}
      onMouseEnter={() => onHover(item.id)}
      onMouseLeave={() => onHover(null)}
    >
      <div className="flex items-start gap-2.5">
        <span
          className="mt-0.5 h-8 w-8 shrink-0 rounded-md border border-black/10"
          style={{ backgroundColor: item.color }}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {editName ? (
              <Input
                autoFocus
                value={item.name}
                onChange={(e) => onUpdate({ name: e.target.value })}
                onBlur={() => setEditName(false)}
                onKeyDown={(e) => e.key === 'Enter' && setEditName(false)}
                className="h-7 text-sm"
              />
            ) : (
              <button
                className="text-sm font-semibold truncate text-left hover:underline"
                onClick={() => setEditName(true)}
                title={item.name}
              >
                {item.name}
              </button>
            )}
            <Badge
              variant={allPlaced ? 'default' : nonePlaced ? 'destructive' : 'secondary'}
              className="ml-auto shrink-0 text-[10px]"
            >
              {placed}/{item.quantity} разм.
            </Badge>
          </div>

          <div className="grid grid-cols-5 gap-1.5 mt-2">
            <NumField
              label="Шир."
              value={item.width}
              onChange={(v) => onUpdate({ width: v })}
              unit={unit}
            />
            <NumField
              label="Длин."
              value={item.length}
              onChange={(v) => onUpdate({ length: v })}
              unit={unit}
            />
            <NumField
              label="Выс."
              value={item.height ?? 0}
              onChange={(v) => onUpdate({ height: v })}
              unit={unit}
            />
            <NumField
              label="Кол-во"
              value={item.quantity}
              onChange={(v) => onUpdate({ quantity: Math.max(1, Math.round(v)) })}
              unit=""
              integer
            />
            <NumField
              label="Вес, кг"
              value={item.weight ?? 0}
              onChange={(v) => onUpdate({ weight: v || undefined })}
              unit=""
            />
          </div>

          <div className="flex items-center justify-between mt-2 gap-2 flex-wrap">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>
                S = {formatNum(area)} {UNIT_LABEL[unit]}²
              </span>
              {item.weight ? (
                <span>
                  Σ вес = {formatNum((item.weight ?? 0) * item.quantity)} кг
                </span>
              ) : null}
            </div>

            <div className="flex items-center gap-1">
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => onUpdate({ allowRotation: !item.allowRotation })}
                      disabled={!globalRotation}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors',
                        rotationEnabled
                          ? 'border-primary/40 bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground',
                        !globalRotation && 'opacity-50 cursor-not-allowed'
                      )}
                    >
                      {item.allowRotation ? (
                        <RotateCw className="h-3.5 w-3.5" />
                      ) : (
                        <Lock className="h-3.5 w-3.5" />
                      )}
                      {rotationEnabled ? 'Поворот' : 'Фикс.'}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {globalRotation
                      ? item.allowRotation
                        ? 'Вращение разрешено — нажмите для фиксации'
                        : 'Вращение запрещено — нажмите для разрешения'
                      : 'Включите глобальное вращение в настройках'}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <IconBtn onClick={onDuplicate} title="Дублировать">
                <Copy className="h-3.5 w-3.5" />
              </IconBtn>
              <IconBtn onClick={onRemove} title="Удалить" destructive>
                <Trash2 className="h-3.5 w-3.5" />
              </IconBtn>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function NumField({
  label,
  value,
  onChange,
  unit,
  integer,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  unit: Unit | ''
  integer?: boolean
}) {
  return (
    <div className="space-y-0.5">
      <Label className="text-[10px] text-muted-foreground leading-none">
        {label}
        {unit ? ` (${unit})` : ''}
      </Label>
      <Input
        type="number"
        min={0}
        step={integer ? 1 : 0.1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="h-7 text-xs px-1.5"
      />
    </div>
  )
}

function IconBtn({
  children,
  onClick,
  title,
  destructive,
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
  destructive?: boolean
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'inline-flex h-6 w-6 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent',
        destructive && 'hover:text-destructive hover:border-destructive/40'
      )}
    >
      {children}
    </button>
  )
}

function formatNum(v: number): string {
  const r = Math.round(v * 100) / 100
  return Number.isInteger(r) ? `${r}` : r.toFixed(2)
}
