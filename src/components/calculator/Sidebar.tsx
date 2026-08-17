'use client'

import { useState } from 'react'
// Stable empty-array references for zustand selectors — `s.deck.x ?? []`
// would allocate a new array every call, which useSyncExternalStore treats
// as "the snapshot changed" and re-renders forever.
const EMPTY_ZONES: never[] = []
const EMPTY_POINTS: never[] = []
import {
  FolderOpen,
  Plus,
  RotateCcw,
  Settings2,
  Layers,
  Eye,
  ChevronDown,
  ChevronRight,
  Pencil,
  Check,
  Copy,
  Trash2,
  PanelLeftClose,
  PanelLeft,
  Anchor,
  Scale,
  ShieldAlert,
  MapPin,
  Box,
  Undo2,
  Redo2,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { useProjects } from '@/store/projects'
import { useCalculator, UNIT_LABEL, type Unit, PRESETS, PALETTE } from '@/store/calculator'
import {
  LASHING_DEVICES,
  VESSEL_MOTION_PRESETS,
  DEFAULT_VESSEL_MOTION,
  type SortStrategy,
  type LashingDeviceType,
  type VesselMotionPreset,
} from '@/lib/packing'
import { DEFAULT_CATEGORIES } from '@/components/calculator/ItemList'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui/toggle-group'

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
  onNewCalculation: () => void
  onResetCurrent: () => void
  viewMode: '2d' | '3d'
  onViewModeChange: (mode: '2d' | '3d') => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
}

export function Sidebar({
  collapsed,
  onToggle,
  onNewCalculation,
  onResetCurrent,
  viewMode,
  onViewModeChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: SidebarProps) {
  const projects = useProjects((s) => s.projects)
  const activeId = useProjects((s) => s.activeId)
  const switchTo = useProjects((s) => s.switchTo)
  const createProject = useProjects((s) => s.createProject)
  const deleteProject = useProjects((s) => s.deleteProject)
  const duplicateProject = useProjects((s) => s.duplicateProject)
  const renameProject = useProjects((s) => s.renameProject)

  const globalRotation = useCalculator((s) => s.globalRotation)
  const showFreeSpace = useCalculator((s) => s.showFreeSpace)
  const showGrid = useCalculator((s) => s.showGrid)
  const showLabels = useCalculator((s) => s.showLabels)
  const toggleGlobalRotation = useCalculator((s) => s.toggleGlobalRotation)
  const toggleFreeSpace = useCalculator((s) => s.toggleFreeSpace)
  const toggleGrid = useCalculator((s) => s.toggleGrid)
  const toggleLabels = useCalculator((s) => s.toggleLabels)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const handleCreate = () => {
    createProject()
    toast.success('Создан новый расчёт')
  }

  const startEdit = (id: string, name: string) => {
    setEditingId(id)
    setEditName(name)
  }
  const commitEdit = () => {
    if (editingId && editName.trim()) renameProject(editingId, editName.trim())
    setEditingId(null)
  }

  if (collapsed) {
    return (
      <aside className="w-14 shrink-0 border-r bg-card flex flex-col items-center py-3 gap-2">
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={onToggle} className="h-9 w-9">
                <PanelLeft className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Развернуть меню</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <Separator className="my-1" />
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={handleCreate} className="h-9 w-9">
                <Plus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Новый расчёт</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={onNewCalculation} className="h-9 w-9">
                <RotateCcw className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Очистить текущий</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <div className="mt-auto flex flex-col items-center gap-1">
          <Separator className="my-1" />
        </div>
      </aside>
    )
  }

  return (
    <aside className="w-72 shrink-0 border-r bg-card flex flex-col h-full overflow-hidden">
      {/* Collapse button + undo/redo + 2D/3D view toggle — all one line */}
      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          title="Отменить (Ctrl+Z)"
          disabled={!canUndo}
          onClick={onUndo}
        >
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          title="Повторить (Ctrl+Y)"
          disabled={!canRedo}
          onClick={onRedo}
        >
          <Redo2 className="h-4 w-4" />
        </Button>
        <ToggleGroup
          type="single"
          value={viewMode}
          onValueChange={(v) => { if (v) onViewModeChange(v as '2d' | '3d') }}
          className="flex-1 grid grid-cols-2 gap-2"
        >
          <ToggleGroupItem
            value="2d"
            className="h-8 rounded-md border data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=off]:bg-background"
          >
            <span className="text-xs font-medium">2D</span>
          </ToggleGroupItem>
          <ToggleGroupItem
            value="3d"
            className="h-8 rounded-md border data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=off]:bg-background"
          >
            <Box className="h-3.5 w-3.5 mr-1" />
            <span className="text-xs font-medium">3D</span>
          </ToggleGroupItem>
        </ToggleGroup>
        <Button variant="ghost" size="icon" onClick={onToggle} className="h-8 w-8 shrink-0">
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {/* Quick actions */}
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" onClick={handleCreate} className="h-8">
            <Plus className="h-3.5 w-3.5 mr-1" />
            Новый
          </Button>
          <Button size="sm" variant="outline" onClick={onNewCalculation} className="h-8">
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            Очистить
          </Button>
        </div>
        {/* Projects list */}
        <Section icon={<FolderOpen className="h-4 w-4" />} title="Расчёты" badge={projects.length}>
          <div className="space-y-1">
            {projects.length === 0 && (
              <p className="text-xs text-muted-foreground px-2 py-1">
                Нет сохранённых расчётов
              </p>
            )}
            {projects.map((p) => {
              const active = p.id === activeId
              return (
                <div
                  key={p.id}
                  className={cn(
                    'group flex items-center gap-1.5 rounded-md border px-2 py-1.5 transition-all',
                    active
                      ? 'border-slate-400 bg-slate-100 dark:bg-slate-800/40 dark:border-slate-600'
                      : 'border-transparent hover:bg-accent'
                  )}
                >
                  {editingId === p.id ? (
                    <Input
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitEdit()
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      onBlur={commitEdit}
                      className="h-6 text-xs px-1.5 flex-1"
                    />
                  ) : (
                    <button
                      onClick={() => switchTo(p.id)}
                      className="flex-1 min-w-0 text-left"
                    >
                      <div className="text-xs font-medium truncate">{p.name}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {p.items.length} гр. · {p.deck.width}×{p.deck.length} {p.deck.unit}
                      </div>
                    </button>
                  )}
                  <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    {editingId === p.id ? (
                      <MiniBtn onClick={commitEdit} title="ОК">
                        <Check className="h-3 w-3" />
                      </MiniBtn>
                    ) : (
                      <MiniBtn onClick={() => startEdit(p.id, p.name)} title="Переименовать">
                        <Pencil className="h-3 w-3" />
                      </MiniBtn>
                    )}
                    <MiniBtn
                      onClick={() => {
                        duplicateProject(p.id)
                        toast.success('Дублировано')
                      }}
                      title="Дублировать"
                    >
                      <Copy className="h-3 w-3" />
                    </MiniBtn>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button title="Удалить" className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Удалить «{p.name}»?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Расчёт будет удалён безвозвратно.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Отмена</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => {
                              deleteProject(p.id)
                              toast.info('Удалено')
                            }}
                          >
                            Удалить
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              )
            })}
          </div>
        </Section>

        {/* Deck settings */}
        <DeckSettings />

        {/* Load zones (per-area capacity) */}
        <LoadZonesSection />

        {/* Cargo category separation rules */}
        <SeparationRulesSection />

        {/* Lashing/securing points (visual markers) */}
        <LashingPointsSection />

        {/* Presets — pick a category, the deck panel on the right shows
            that category's catalog for click-to-place */}
        <PresetsSection />
      </div>

      {/* Footer settings (display toggles + reset-to-demo) */}
      <div className="border-t p-3">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full h-8 text-xs">
              <Settings2 className="h-3.5 w-3.5 mr-1.5" />
              Настройки
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="w-64 p-3 space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Eye className="h-3.5 w-3.5" />
                Отображение
              </div>
              <div className="space-y-2 pl-1">
                <Toggle label="Разрешить вращение" checked={globalRotation} onToggle={toggleGlobalRotation} />
                <Toggle label="Свободное пространство" checked={showFreeSpace} onToggle={toggleFreeSpace} />
                <Toggle label="Сетка" checked={showGrid} onToggle={toggleGrid} />
                <Toggle label="Метки грузов" checked={showLabels} onToggle={toggleLabels} />
              </div>
            </div>
            <Separator />
            <Button variant="ghost" size="sm" onClick={onResetCurrent} className="w-full h-8 text-xs">
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              Сбросить к примеру
            </Button>
          </PopoverContent>
        </Popover>
      </div>
    </aside>
  )
}

function Section({
  icon,
  title,
  badge,
  children,
  defaultOpen = true,
}: {
  icon: React.ReactNode
  title: string
  badge?: number
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 w-full text-left mb-1.5 group"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <span className="text-muted-foreground group-hover:text-foreground transition-colors">
          {icon}
        </span>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        {badge !== undefined && (
          <Badge variant="secondary" className="ml-auto text-[10px] h-4 px-1.5">
            {badge}
          </Badge>
        )}
      </button>
      {open && <div className="pl-1">{children}</div>}
    </div>
  )
}

function MiniBtn({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {children}
    </button>
  )
}

function DeckSettings() {
  const deck = useCalculator((s) => s.deck)
  const setDeck = useCalculator((s) => s.setDeck)
  const setUnit = useCalculator((s) => s.setUnit)
  const sortStrategy = useCalculator((s) => s.sortStrategy)
  const setSortStrategy = useCalculator((s) => s.setSortStrategy)

  return (
    <Section icon={<Settings2 className="h-4 w-4" />} title="Палуба">
      <div className="space-y-2.5">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">Ширина</label>
            <Input
              type="number"
              min={0.1}
              step={0.1}
              value={deck.width}
              onChange={(e) => { const v = Number(e.target.value); setDeck({ width: !isNaN(v) && v > 0 ? v : 0.1 }) }}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">Длина</label>
            <Input
              type="number"
              min={0.1}
              step={0.1}
              value={deck.length}
              onChange={(e) => { const v = Number(e.target.value); setDeck({ length: !isNaN(v) && v > 0 ? v : 0.1 }) }}
              className="h-8 text-xs"
            />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Layers className="h-3 w-3" /> Отступ между грузами
          </label>
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              min={0}
              step={0.05}
              value={deck.gap}
              onChange={(e) => { const v = Number(e.target.value); setDeck({ gap: !isNaN(v) && v >= 0 ? v : 0 }) }}
              className="h-8 text-xs flex-1"
            />
            <span className="text-[10px] text-muted-foreground w-6">{UNIT_LABEL[deck.unit]}</span>
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Anchor className="h-3 w-3" /> Отступ от борта
          </label>
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              min={0}
              step={0.05}
              value={deck.boardOffset}
              onChange={(e) => { const v = Number(e.target.value); setDeck({ boardOffset: !isNaN(v) && v >= 0 ? v : 0 }) }}
              className="h-8 text-xs flex-1"
            />
            <span className="text-[10px] text-muted-foreground w-6">{UNIT_LABEL[deck.unit]}</span>
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Layers className="h-3 w-3" /> Высота над палубой (зазор)
          </label>
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              min={0}
              step={0.1}
              value={deck.clearance}
              onChange={(e) => { const v = Number(e.target.value); setDeck({ clearance: !isNaN(v) && v >= 0 ? v : 0 }) }}
              className="h-8 text-xs flex-1"
            />
            <span className="text-[10px] text-muted-foreground w-6">{UNIT_LABEL[deck.unit]}</span>
          </div>
          <p className="text-[10px] text-muted-foreground">
            0 = один ярус. &gt;0 = расчёт ярусов по высоте груза
          </p>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">Единицы</label>
          <ToggleGroup
            type="single"
            value={deck.unit}
            onValueChange={(v) => v && setUnit(v as Unit)}
            className="justify-start"
          >
            <ToggleGroupItem value="m" className="h-7 text-xs px-2">м</ToggleGroupItem>
            <ToggleGroupItem value="cm" className="h-7 text-xs px-2">см</ToggleGroupItem>
            <ToggleGroupItem value="ft" className="h-7 text-xs px-2">фт</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">Стратегия упаковки</label>
          <Select value={sortStrategy} onValueChange={(v) => setSortStrategy(v as SortStrategy)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="area-desc">По площади (крупные сначала)</SelectItem>
              <SelectItem value="area-asc">По площади (мелкие сначала)</SelectItem>
              <SelectItem value="width-desc">По ширине (убыв.)</SelectItem>
              <SelectItem value="length-desc">По длине (убыв.)</SelectItem>
              <SelectItem value="quantity-desc">По количеству (убыв.)</SelectItem>
              <SelectItem value="none">В порядке ввода</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </Section>
  )
}

function Toggle({
  label,
  checked,
  onToggle,
}: {
  label: string
  checked: boolean
  onToggle: () => void
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs">{label}</span>
      <Switch checked={checked} onCheckedChange={onToggle} />
    </div>
  )
}

function LoadZonesSection() {
  const zones = useCalculator((s) => s.deck.loadZones ?? EMPTY_ZONES)
  const unit = useCalculator((s) => s.deck.unit)
  const addLoadZone = useCalculator((s) => s.addLoadZone)
  const updateLoadZone = useCalculator((s) => s.updateLoadZone)
  const removeLoadZone = useCalculator((s) => s.removeLoadZone)

  return (
    <Section icon={<Scale className="h-4 w-4" />} title="Зоны нагрузки" badge={zones.length} defaultOpen={false}>
      <div className="space-y-2">
        <p className="text-[10px] text-muted-foreground">
          Допустимая нагрузка (т/м²) по прямоугольным зонам палубы. Превышение — мягкое предупреждение, груз не блокируется.
        </p>
        {zones.map((z) => (
          <div key={z.id} className="rounded-md border p-2 space-y-1.5">
            <div className="grid grid-cols-4 gap-1">
              <MiniNumField label="X" value={z.x} unit={unit} onChange={(v) => updateLoadZone(z.id, { x: v })} />
              <MiniNumField label="Y" value={z.y} unit={unit} onChange={(v) => updateLoadZone(z.id, { y: v })} />
              <MiniNumField label="Шир." value={z.width} unit={unit} onChange={(v) => updateLoadZone(z.id, { width: v })} />
              <MiniNumField label="Длин." value={z.length} unit={unit} onChange={(v) => updateLoadZone(z.id, { length: v })} />
            </div>
            <div className="flex items-center gap-1.5">
              <MiniNumField label="Лимит, т/м²" value={z.maxLoadPerArea} unit="" onChange={(v) => updateLoadZone(z.id, { maxLoadPerArea: v })} />
              <button
                onClick={() => removeLoadZone(z.id)}
                className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-destructive"
                title="Удалить зону"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
        <Button size="sm" variant="outline" className="h-7 text-xs w-full" onClick={() => addLoadZone()}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Добавить зону
        </Button>
      </div>
    </Section>
  )
}

function SeparationRulesSection() {
  const rules = useCalculator((s) => s.separationRules)
  const addSeparationRule = useCalculator((s) => s.addSeparationRule)
  const removeSeparationRule = useCalculator((s) => s.removeSeparationRule)
  const items = useCalculator((s) => s.items)
  const [categoryA, setCategoryA] = useState('')
  const [categoryB, setCategoryB] = useState('')
  const [minDistance, setMinDistance] = useState(3)

  const categoryOptions = Array.from(
    new Set([...DEFAULT_CATEGORIES, ...items.map((it) => it.category).filter((c): c is string => !!c)])
  )

  return (
    <Section icon={<ShieldAlert className="h-4 w-4" />} title="Сепарация груза" badge={rules.length} defaultOpen={false}>
      <div className="space-y-2">
        <p className="text-[10px] text-muted-foreground">
          Минимальное расстояние (в метрах) между грузами двух категорий. Нарушение блокирует размещение.
        </p>
        {rules.map((r) => (
          <div key={r.id} className="flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs">
            <span className="truncate flex-1">
              «{r.categoryA}» ↔ «{r.categoryB}»: ≥{r.minDistance} м
            </span>
            <button
              onClick={() => removeSeparationRule(r.id)}
              className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-destructive shrink-0"
              title="Удалить правило"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
        <div className="rounded-md border p-2 space-y-1.5">
          <Select value={categoryA} onValueChange={setCategoryA}>
            <SelectTrigger className="h-7 w-full text-xs">
              <SelectValue placeholder="Категория A" />
            </SelectTrigger>
            <SelectContent>
              {categoryOptions.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={categoryB} onValueChange={setCategoryB}>
            <SelectTrigger className="h-7 w-full text-xs">
              <SelectValue placeholder="Категория B" />
            </SelectTrigger>
            <SelectContent>
              {categoryOptions.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              min={0}
              step={0.5}
              value={minDistance}
              onChange={(e) => { const v = Number(e.target.value); setMinDistance(!isNaN(v) && v >= 0 ? v : 0) }}
              className="h-7 text-xs flex-1"
            />
            <span className="text-[10px] text-muted-foreground">м</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs w-full"
            disabled={!categoryA || !categoryB}
            onClick={() => {
              addSeparationRule({ categoryA, categoryB, minDistance })
              setCategoryA('')
              setCategoryB('')
              toast.success('Правило добавлено')
            }}
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> Добавить правило
          </Button>
        </div>
      </div>
    </Section>
  )
}

function LashingPointsSection() {
  const points = useCalculator((s) => s.deck.lashingPoints ?? EMPTY_POINTS)
  const items = useCalculator((s) => s.items)
  const removeLashingPoint = useCalculator((s) => s.removeLashingPoint)
  const updateLashingPoint = useCalculator((s) => s.updateLashingPoint)
  const placingLashingPoint = useCalculator((s) => s.placingLashingPoint)
  const setPlacingLashingPoint = useCalculator((s) => s.setPlacingLashingPoint)
  const vesselMotion = useCalculator((s) => s.deck.vesselMotion ?? DEFAULT_VESSEL_MOTION)
  const setVesselMotion = useCalculator((s) => s.setVesselMotion)

  const attachedCount = points.filter((p) => p.placementId).length

  return (
    <Section icon={<MapPin className="h-4 w-4" />} title="Крепление груза" badge={points.length} defaultOpen={false}>
      <div className="space-y-3">
        <p className="text-[10px] text-muted-foreground">
          Клик по грузу, затем по палубе — привязывает линию крепления с расчётом усилия по IMO CSS Code
          (упрощённый метод). Мягкая проверка — груз не блокируется. Точка без привязки — просто метка на схеме.
        </p>

        {/* Vessel motion / friction */}
        <div className="rounded-md border p-2 space-y-1.5">
          <div className="text-[10px] font-medium text-muted-foreground">Условия качки</div>
          <Select
            value={vesselMotion.preset}
            onValueChange={(v) => {
              const preset = v as VesselMotionPreset
              if (preset === 'custom') {
                setVesselMotion({ preset })
              } else {
                setVesselMotion({ ...VESSEL_MOTION_PRESETS[preset], preset })
              }
            }}
          >
            <SelectTrigger className="h-6 w-full text-[11px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="open-sea">Открытое море</SelectItem>
              <SelectItem value="coastal">Прибрежное плавание</SelectItem>
              <SelectItem value="sheltered">Защищённые воды</SelectItem>
              <SelectItem value="custom">Свои значения</SelectItem>
            </SelectContent>
          </Select>
          {vesselMotion.preset === 'custom' && (
            <div className="grid grid-cols-4 gap-1">
              <MiniNumField label="ax" value={vesselMotion.ax} unit="g" onChange={(v) => setVesselMotion({ ax: v })} />
              <MiniNumField label="ay" value={vesselMotion.ay} unit="g" onChange={(v) => setVesselMotion({ ay: v })} />
              <MiniNumField label="az" value={vesselMotion.az} unit="g" onChange={(v) => setVesselMotion({ az: v })} />
              <MiniNumField label="μ" value={vesselMotion.friction} unit="" onChange={(v) => setVesselMotion({ friction: v })} />
            </div>
          )}
        </div>

        {points.map((p, i) => {
          const item = p.itemId ? items.find((it) => it.id === p.itemId) : undefined
          return (
            <div key={p.id} className="rounded-md border p-2 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <span className="truncate flex-1 text-xs">
                  {p.label || `Точка ${i + 1}`}
                  {item && <span className="text-muted-foreground"> · {item.name}</span>}
                </span>
                <button
                  onClick={() => removeLashingPoint(p.id)}
                  className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-destructive shrink-0"
                  title="Удалить точку"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
              {p.placementId && (
                <>
                  <Select
                    value={p.deviceType ?? 'custom'}
                    onValueChange={(v) => {
                      const deviceType = v as LashingDeviceType
                      updateLashingPoint(p.id, {
                        deviceType,
                        mslKg: LASHING_DEVICES[deviceType].mslKg || p.mslKg,
                      })
                    }}
                  >
                    <SelectTrigger className="h-6 w-full text-[11px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(LASHING_DEVICES).map(([key, d]) => (
                        <SelectItem key={key} value={key}>{d.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="grid grid-cols-2 gap-1">
                    <MiniNumField
                      label="MSL"
                      value={p.mslKg ?? 0}
                      unit="кг"
                      onChange={(v) => updateLashingPoint(p.id, { mslKg: v })}
                    />
                    <MiniNumField
                      label="Угол"
                      value={p.verticalAngleDeg ?? 45}
                      unit="°"
                      onChange={(v) => updateLashingPoint(p.id, { verticalAngleDeg: v })}
                    />
                  </div>
                </>
              )}
            </div>
          )
        })}
        <Button
          size="sm"
          variant={placingLashingPoint ? 'default' : 'outline'}
          className="h-7 text-xs w-full"
          onClick={() => setPlacingLashingPoint(!placingLashingPoint)}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          {placingLashingPoint ? 'Клик по грузу → по палубе… (Готово)' : 'Добавить крепление'}
        </Button>
        {points.length > 0 && (
          <p className="text-[10px] text-muted-foreground">
            Закреплено грузов: {new Set(points.filter((p) => p.placementId).map((p) => p.placementId)).size} ·
            {' '}точек с расчётом: {attachedCount}
          </p>
        )}
      </div>
    </Section>
  )
}

function PresetsSection() {
  const activePresetCategory = useCalculator((s) => s.activePresetCategory)
  const setActivePresetCategory = useCalculator((s) => s.setActivePresetCategory)
  const pendingPresetStamp = useCalculator((s) => s.pendingPresetStamp)
  const setPendingPresetStamp = useCalculator((s) => s.setPendingPresetStamp)

  return (
    <Section icon={<Sparkles className="h-4 w-4" />} title="Пресеты" defaultOpen={false}>
      <div className="space-y-1.5">
        <p className="text-[10px] text-muted-foreground leading-tight">
          Выберите категорию, затем тип груза — он вооружится для клика по палубе.
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {Object.entries(PRESETS).map(([key, cat]) => (
            <Button
              key={key}
              variant={activePresetCategory === key ? 'secondary' : 'outline'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setActivePresetCategory(activePresetCategory === key ? null : key)}
            >
              {cat.label}
            </Button>
          ))}
        </div>
        {activePresetCategory && (
          <ScrollArea className="h-[200px] pr-1">
            <div className="space-y-1">
              {PRESETS[activePresetCategory]?.items.map((tpl, i) => {
                // Fixed per template position — stable across renders (a
                // color tied to items.length changed every time you
                // reopened the category or added cargo, more confusing than
                // an occasional collision). The real item created on
                // placement gets its own collision-avoiding color from
                // nextColor regardless of this preview color — see
                // addOrIncrementCargoFromTemplate in calculator.ts.
                const color = PALETTE[i % PALETTE.length]
                const active = pendingPresetStamp?.name === tpl.name
                return (
                  <PresetTemplateRow
                    key={i}
                    template={tpl}
                    color={color}
                    active={active}
                    onSelect={() => setPendingPresetStamp(active ? null : { ...tpl, color })}
                  />
                )
              })}
            </div>
          </ScrollArea>
        )}
        {pendingPresetStamp && (
          <p className="text-[10px] text-muted-foreground leading-tight">
            «{pendingPresetStamp.name}» готов — кликните по палубе, чтобы разместить.
          </p>
        )}
      </div>
    </Section>
  )
}

function PresetTemplateRow({
  template,
  color,
  active,
  onSelect,
}: {
  template: { name?: string; width?: number; length?: number }
  color: string
  active: boolean
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
        style={{ backgroundColor: color }}
      />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate">{template.name}</div>
        <div className="text-[10px] text-muted-foreground">
          {template.width}×{template.length}
        </div>
      </div>
      {active && <Badge variant="default" className="shrink-0 text-[10px]">активен</Badge>}
    </button>
  )
}

function MiniNumField({
  label,
  value,
  unit,
  onChange,
}: {
  label: string
  value: number
  unit: string
  onChange: (v: number) => void
}) {
  return (
    <div className="space-y-0.5">
      <label className="text-[9px] text-muted-foreground leading-none block">
        {label}{unit ? ` (${unit})` : ''}
      </label>
      <Input
        type="number"
        step={0.1}
        value={value}
        onChange={(e) => { const v = Number(e.target.value); if (!isNaN(v)) onChange(v) }}
        className="h-6 text-[11px] px-1"
      />
    </div>
  )
}

