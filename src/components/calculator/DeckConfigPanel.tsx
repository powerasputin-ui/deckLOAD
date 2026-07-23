'use client'

import { RotateCw, Grid3x3, Eye, Tag, Layers, Trash2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui/toggle-group'
import { Separator } from '@/components/ui/separator'
import {
  useCalculator,
  UNIT_LABEL,
  type Unit,
} from '@/store/calculator'
import type { SortStrategy } from '@/lib/packing'
import { toast } from 'sonner'

export function DeckConfigPanel() {
  const deck = useCalculator((s) => s.deck)
  const setDeck = useCalculator((s) => s.setDeck)
  const setUnit = useCalculator((s) => s.setUnit)
  const globalRotation = useCalculator((s) => s.globalRotation)
  const toggleGlobalRotation = useCalculator((s) => s.toggleGlobalRotation)
  const showFreeSpace = useCalculator((s) => s.showFreeSpace)
  const showGrid = useCalculator((s) => s.showGrid)
  const showLabels = useCalculator((s) => s.showLabels)
  const toggleFreeSpace = useCalculator((s) => s.toggleFreeSpace)
  const toggleGrid = useCalculator((s) => s.toggleGrid)
  const toggleLabels = useCalculator((s) => s.toggleLabels)
  const sortStrategy = useCalculator((s) => s.sortStrategy)
  const setSortStrategy = useCalculator((s) => s.setSortStrategy)
  const loadPreset = useCalculator((s) => s.loadPreset)
  const clearItems = useCalculator((s) => s.clearItems)
  const items = useCalculator((s) => s.items)

  const handlePreset = (p: 'containers' | 'pallets' | 'vehicles' | 'mixed') => {
    loadPreset(p)
    toast.success('Пресет загружен')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="h-4 w-4 text-primary" />
          Параметры палубы
        </CardTitle>
        <CardDescription>
          Размеры и единицы измерения грузовой палубы
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="deck-w">Ширина</Label>
            <Input
              id="deck-w"
              type="number"
              min={0.1}
              step={0.1}
              value={deck.width}
              onChange={(e) =>
                setDeck({ width: Number(e.target.value) || 0 })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="deck-l">Длина</Label>
            <Input
              id="deck-l"
              type="number"
              min={0.1}
              step={0.1}
              value={deck.length}
              onChange={(e) =>
                setDeck({ length: Number(e.target.value) || 0 })
              }
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Единицы измерения</Label>
          <ToggleGroup
            type="single"
            value={deck.unit}
            onValueChange={(v) => v && setUnit(v as Unit)}
            className="justify-start"
          >
            <ToggleGroupItem value="m">Метры (м)</ToggleGroupItem>
            <ToggleGroupItem value="cm">Сантиметры (см)</ToggleGroupItem>
            <ToggleGroupItem value="ft">Футы (фт)</ToggleGroupItem>
          </ToggleGroup>
        </div>

        <Separator />

        <div className="space-y-1.5">
          <Label>Стратегия упаковки</Label>
          <Select
            value={sortStrategy}
            onValueChange={(v) => setSortStrategy(v as SortStrategy)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="area-desc">По площади (сначала крупные)</SelectItem>
              <SelectItem value="area-asc">По площади (сначала мелкие)</SelectItem>
              <SelectItem value="width-desc">По ширине (убыв.)</SelectItem>
              <SelectItem value="height-desc">По длине (убыв.)</SelectItem>
              <SelectItem value="none">В порядке ввода</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Separator />

        <div className="space-y-3">
          <h4 className="text-sm font-medium">Настройки вращения и отображения</h4>

          <SettingRow
            icon={<RotateCw className="h-4 w-4" />}
            title="Разрешить вращение"
            desc="Автоповорот на 90° для лучшей укладки"
            checked={globalRotation}
            onToggle={toggleGlobalRotation}
          />
          <SettingRow
            icon={<Eye className="h-4 w-4" />}
            title="Свободное пространство"
            desc="Подсветка незанятых зон"
            checked={showFreeSpace}
            onToggle={toggleFreeSpace}
          />
          <SettingRow
            icon={<Grid3x3 className="h-4 w-4" />}
            title="Сетка"
            desc="Координатная сетка палубы"
            checked={showGrid}
            onToggle={toggleGrid}
          />
          <SettingRow
            icon={<Tag className="h-4 w-4" />}
            title="Метки грузов"
            desc="Названия и размеры на схеме"
            checked={showLabels}
            onToggle={toggleLabels}
          />
        </div>

        <Separator />

        <div className="space-y-2">
          <h4 className="text-sm font-medium flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-amber-500" />
            Пресеты загрузки
          </h4>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePreset('containers')}
            >
              Контейнеры
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePreset('pallets')}
            >
              Паллеты
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePreset('vehicles')}
            >
              Автомобили
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePreset('mixed')}
            >
              Смешанный
            </Button>
          </div>
        </div>

        {items.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-destructive hover:text-destructive"
            onClick={() => {
              clearItems()
              toast.info('Список грузов очищен')
            }}
          >
            <Trash2 className="h-4 w-4 mr-1.5" />
            Очистить все грузы
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

function SettingRow({
  icon,
  title,
  desc,
  checked,
  onToggle,
}: {
  icon: React.ReactNode
  title: string
  desc: string
  checked: boolean
  onToggle: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-start gap-2.5 min-w-0">
        <span className="mt-0.5 text-muted-foreground shrink-0">{icon}</span>
        <div className="min-w-0">
          <div className="text-sm font-medium leading-tight">{title}</div>
          <div className="text-xs text-muted-foreground leading-tight">
            {desc}
          </div>
        </div>
      </div>
      <Switch checked={checked} onCheckedChange={onToggle} />
    </div>
  )
}
