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
  Ship,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
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
import { useCalculator, UNIT_LABEL, roundForDisplay, type Unit } from '@/store/calculator'
import {
  LASHING_DEVICES,
  type SortStrategy,
  type LashingDeviceType,
  type PinnedPlacement,
  type ClearanceMargin,
  type ZoneLoadCheck,
} from '@/lib/packing'
import { DEFAULT_VESSEL_PARTICULARS, type VesselParticulars } from '@/lib/stability'
import { DEFAULT_CATEGORIES } from '@/components/calculator/ItemList'
import { cn, fmtNumber } from '@/lib/utils'
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
  // Every load zone's live density (t/m²), whether or not it currently
  // exceeds its limit — see LoadZonesSection for why this matters.
  zoneLoads?: ZoneLoadCheck[]
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
  zoneLoads,
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
  const showCargoContents = useCalculator((s) => s.showCargoContents)
  const toggleGlobalRotation = useCalculator((s) => s.toggleGlobalRotation)
  const toggleFreeSpace = useCalculator((s) => s.toggleFreeSpace)
  const toggleGrid = useCalculator((s) => s.toggleGrid)
  const toggleLabels = useCalculator((s) => s.toggleLabels)
  const toggleCargoContents = useCalculator((s) => s.toggleCargoContents)

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

      <div className="flex-1 flex flex-col min-h-0 px-3 py-3">
      <div className="thin-scrollbar min-h-[360px] overflow-y-auto space-y-4 pr-0.5">
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
                        {p.items.length} гр. · {fmtNumber(p.deck.width)}×{fmtNumber(p.deck.length)} {p.deck.unit}
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
        <LoadZonesSection zoneLoads={zoneLoads} />

        {/* Cargo category separation rules */}
        <SeparationRulesSection />

        {/* Lashing/securing points (visual markers) */}
        <LashingPointsSection />

        {/* Ship stability calculator (planning/indicative — see StabilityPanel's disclaimer) */}
        <VesselStabilitySection />
      </div>
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
                <Toggle label="Содержимое груза" checked={showCargoContents} onToggle={toggleCargoContents} />
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
              value={roundForDisplay(deck.width)}
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
              value={roundForDisplay(deck.length)}
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
              value={roundForDisplay(deck.gap)}
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
              value={roundForDisplay(deck.boardOffset)}
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
              value={roundForDisplay(deck.clearance)}
              onChange={(e) => { const v = Number(e.target.value); setDeck({ clearance: !isNaN(v) && v >= 0 ? v : 0 }) }}
              className="h-8 text-xs flex-1"
            />
            <span className="text-[10px] text-muted-foreground w-6">{UNIT_LABEL[deck.unit]}</span>
          </div>
          <p className="text-[10px] text-muted-foreground">
            0 = без своего лимита «Ярусов» — один ярус. &gt;0 = ограничивает
            и «Ярусов» груза, если оно больше физически влезающего по высоте
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

function LoadZonesSection({ zoneLoads }: { zoneLoads?: ZoneLoadCheck[] }) {
  const zones = useCalculator((s) => s.deck.loadZones ?? EMPTY_ZONES)
  const unit = useCalculator((s) => s.deck.unit)
  const addLoadZone = useCalculator((s) => s.addLoadZone)
  const updateLoadZone = useCalculator((s) => s.updateLoadZone)
  const removeLoadZone = useCalculator((s) => s.removeLoadZone)

  return (
    <Section icon={<Scale className="h-4 w-4" />} title="Зоны нагрузки" badge={zones.length} defaultOpen={false}>
      <div className="space-y-2">
        <p className="text-[10px] text-muted-foreground">
          Лимит — это ПЛОТНОСТЬ (тонны на каждый квадратный метр площади зоны), не общий вес зоны целиком. Лимит «2» на зоне 5×4 м (20 м²) значит зона держит до 2×20 = 40 т в сумме, не 2 т. Превышение — мягкое предупреждение, груз не блокируется.
        </p>
        {zones.map((z) => {
          const load = zoneLoads?.find((zl) => zl.zoneId === z.id)
          // Bare-rectangle capacity preview, shown even before anything is
          // placed — directly answers "how many tonnes actually fit here"
          // at the current limit, without the reader doing limit×area math
          // themselves (the exact miscalculation this readout exists to
          // prevent). Uses the real outline-clipped area once cargo is on
          // the deck (load.areaM2), the bare rectangle before that.
          const areaM2 = load?.areaM2 ?? z.width * z.length
          const capacityT = z.maxLoadPerArea * areaM2
          return (
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
              <p className="text-[10px] text-muted-foreground">
                Держит до {fmtNumber(capacityT)} т суммарно ({fmtNumber(z.maxLoadPerArea)} т/м² × {fmtNumber(areaM2)} м²)
              </p>
              {load && (
                <p
                  className={cn(
                    'text-[10px] tabular-nums',
                    load.exceeded ? 'font-medium text-destructive' : 'text-muted-foreground'
                  )}
                >
                  Сейчас в зоне: {fmtNumber(load.totalWeightKg / 1000)} т ({fmtNumber(load.densityTPerM2)} т/м²)
                  {load.exceeded ? ' — превышен лимит!' : ` из ${fmtNumber(capacityT)} т`}
                </p>
              )}
            </div>
          )
        })}
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
  const unit = useCalculator((s) => s.deck.unit)
  const mode = useCalculator((s) => s.mode)
  const selectedManualIds = useCalculator((s) => s.selectedManualIds)
  const selectedPinIds = useCalculator((s) => s.selectedPinIds)
  const manualPlacements = useCalculator((s) => s.manualPlacements)
  const pinnedPlacementsByTrip = useCalculator((s) => s.pinnedPlacementsByTrip)
  const updateManualPlacement = useCalculator((s) => s.updateManualPlacement)
  const updatePinned = useCalculator((s) => s.updatePinned)
  const clearLashingPointsFor = useCalculator((s) => s.clearLashingPointsFor)

  const attachedCount = points.filter((p) => p.placementId).length

  // Clearance zones and lashing points are mutually exclusive per placement
  // (see clearanceMargin in packing.ts) — the mode toggle below acts on
  // whichever placement is currently selected in the deck view, regardless
  // of which trip it's pinned on (searched across all trips by id, since
  // this section doesn't otherwise track the active trip index).
  const selectedManual = mode === 'manual' ? manualPlacements.find((m) => m.id === selectedManualIds[0]) : undefined
  let selectedPin: PinnedPlacement | undefined
  let selectedPinTrip: number | undefined
  if (mode === 'auto' && selectedPinIds[0]) {
    for (const [tripKey, list] of Object.entries(pinnedPlacementsByTrip)) {
      const found = list.find((p) => p.id === selectedPinIds[0])
      if (found) {
        selectedPin = found
        selectedPinTrip = Number(tripKey)
        break
      }
    }
  }
  const selectedPlacement = selectedManual ?? selectedPin
  // Whether "zone" mode is active must NOT depend on the current value being
  // nonzero — while typing a value like "0,4", the field passes through an
  // intermediate 0, and if that briefly counted as "back to points mode" the
  // whole toggle (and the input itself) would flicker away mid-edit. Mode is
  // tracked by whether a margin is set AT ALL, not by its size.
  const selectedHasClearance = selectedPlacement?.clearanceMargin !== undefined
  const updateSelectedPlacement = (patch: { clearanceMargin?: ClearanceMargin }) => {
    if (selectedManual) updateManualPlacement(selectedManual.id, patch)
    else if (selectedPin && selectedPinTrip !== undefined) updatePinned(selectedPinTrip, selectedPin.id, patch)
  }
  const updateClearanceSide = (side: keyof ClearanceMargin, v: number) => {
    const current = selectedPlacement?.clearanceMargin ?? { top: 0, right: 0, bottom: 0, left: 0 }
    updateSelectedPlacement({ clearanceMargin: { ...current, [side]: Math.max(0, v) } })
  }
  const selectedPointsCount = selectedPlacement
    ? points.filter((p) => p.placementId === selectedPlacement.id).length
    : 0

  return (
    <Section icon={<MapPin className="h-4 w-4" />} title="Крепление груза" badge={points.length} defaultOpen={false}>
      <div className="space-y-3">
        <p className="text-[10px] text-muted-foreground">
          Клик по грузу, затем по палубе — привязывает линию крепления с расчётом усилия по IMO CSS Code
          (упрощённый метод). Мягкая проверка — груз не блокируется. Точка без привязки — просто метка на схеме.
        </p>

        {/* Mode toggle for the currently selected placement — lashing points
            and a clearance zone are mutually exclusive per placement, so
            switching one off clears the other. */}
        {selectedPlacement && (
          <div className="rounded-md border p-2 space-y-1.5">
            <div className="text-[10px] font-medium text-muted-foreground truncate">
              Режим для «{selectedPlacement.name}»
            </div>
            <div className="grid grid-cols-2 gap-1">
              <Button
                size="sm"
                variant={!selectedHasClearance ? 'default' : 'outline'}
                className="h-6 text-[10px] px-1"
                onClick={() => updateSelectedPlacement({ clearanceMargin: undefined })}
              >
                Точки крепления
              </Button>
              <Button
                size="sm"
                variant={selectedHasClearance ? 'default' : 'outline'}
                className="h-6 text-[10px] px-1"
                onClick={() => {
                  clearLashingPointsFor(selectedPlacement.id)
                  updateSelectedPlacement({
                    clearanceMargin: selectedPlacement.clearanceMargin ?? { top: 1, right: 1, bottom: 1, left: 1 },
                  })
                  // The "Добавить крепление" placing tool is global, not
                  // scoped to a selected placement — if it was armed before
                  // (e.g. clicked with nothing selected yet, or left on from
                  // a previous placement), switching THIS placement to zone
                  // mode left it silently still armed: the toggle button
                  // itself disappears once selectedHasClearance flips true
                  // (so there's no visible way to tell), but the deck stayed
                  // in corner-then-anchor placing mode and a click on this
                  // same cargo would attach a brand new point to it anyway —
                  // defeating the "mutually exclusive" point of switching to
                  // a zone at all.
                  if (placingLashingPoint) setPlacingLashingPoint(false)
                }}
              >
                Зона отступа
              </Button>
            </div>
            {selectedHasClearance && (
              <div className="grid grid-cols-2 gap-1">
                <MiniNumField
                  label="Верх"
                  value={selectedPlacement.clearanceMargin?.top ?? 0}
                  unit={UNIT_LABEL[unit]}
                  onChange={(v) => updateClearanceSide('top', v)}
                />
                <MiniNumField
                  label="Право"
                  value={selectedPlacement.clearanceMargin?.right ?? 0}
                  unit={UNIT_LABEL[unit]}
                  onChange={(v) => updateClearanceSide('right', v)}
                />
                <MiniNumField
                  label="Низ"
                  value={selectedPlacement.clearanceMargin?.bottom ?? 0}
                  unit={UNIT_LABEL[unit]}
                  onChange={(v) => updateClearanceSide('bottom', v)}
                />
                <MiniNumField
                  label="Лево"
                  value={selectedPlacement.clearanceMargin?.left ?? 0}
                  unit={UNIT_LABEL[unit]}
                  onChange={(v) => updateClearanceSide('left', v)}
                />
              </div>
            )}
            {!selectedHasClearance && selectedPointsCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[10px] w-full text-destructive hover:text-destructive"
                onClick={() => clearLashingPointsFor(selectedPlacement.id)}
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Снять все точки ({selectedPointsCount}) с этого груза
              </Button>
            )}
          </div>
        )}

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
        {!selectedHasClearance && (
          <Button
            size="sm"
            variant={placingLashingPoint ? 'default' : 'outline'}
            className="h-7 text-xs w-full"
            onClick={() => setPlacingLashingPoint(!placingLashingPoint)}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            {placingLashingPoint ? 'Клик по грузу → по палубе… (Готово)' : 'Добавить крепление'}
          </Button>
        )}
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

function VesselStabilitySection() {
  const vessel = useCalculator((s) => s.deck.vessel)
  const shipFrame = useCalculator((s) => s.deck.shipFrame)
  const forwardIsPositiveY = useCalculator((s) => s.deck.deckForwardIsPositiveY ?? true)
  const setVesselParticulars = useCalculator((s) => s.setVesselParticulars)
  const addHydrostaticPoint = useCalculator((s) => s.addHydrostaticPoint)
  const updateHydrostaticPoint = useCalculator((s) => s.updateHydrostaticPoint)
  const removeHydrostaticPoint = useCalculator((s) => s.removeHydrostaticPoint)
  const setKNCrossCurves = useCalculator((s) => s.setKNCrossCurves)
  const setShipFrame = useCalculator((s) => s.setShipFrame)
  const setDeckForwardIsPositiveY = useCalculator((s) => s.setDeckForwardIsPositiveY)

  const [knText, setKnText] = useState('')
  const [knError, setKnError] = useState<string | null>(null)

  const particulars = vessel?.particulars ?? DEFAULT_VESSEL_PARTICULARS
  const points = vessel?.hydrostatics.points ?? []
  const knCurves = vessel?.knCurves

  const statusLabel = !vessel
    ? 'не заданы'
    : !knCurves
      ? 'только начальная GM (нет кривых KN)'
      : 'полная кривая GZ'

  const parseKnText = () => {
    const lines = knText.split('\n').map((l) => l.trim()).filter(Boolean)
    if (lines.length < 2) {
      setKnError('Нужна хотя бы строка углов и одна строка водоизмещения')
      return
    }
    // Values are comma-separated, so a comma can't also serve as this
    // locale's decimal separator here (each part is already comma-free
    // after the split) — periods are the only valid decimal point.
    const headingAngles = lines[0].split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n))
    if (headingAngles.length === 0) {
      setKnError('Первая строка — углы крена через запятую, напр.: 0,10,20,30,40')
      return
    }
    const rows: { displacementKg: number; KNByAngle: number[] }[] = []
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',').map((s) => Number(s.trim()))
      if (parts.length !== headingAngles.length + 1 || parts.some((n) => !Number.isFinite(n))) {
        setKnError(`Строка ${i + 1}: ожидается водоизмещение + ${headingAngles.length} значений KN через запятую`)
        return
      }
      rows.push({ displacementKg: parts[0], KNByAngle: parts.slice(1) })
    }
    setKNCrossCurves({ headingAngles, points: rows })
    setKnError(null)
    setKnText('')
  }

  return (
    <Section icon={<Ship className="h-4 w-4" />} title="Остойчивость судна" defaultOpen={false}>
      <div className="space-y-2">
        <p className="text-[10px] text-muted-foreground">
          Ознакомительный/плановый расчёт — не заменяет одобренный классом судовой прибор загрузки. Данные: <b>{statusLabel}</b>.
        </p>

        <div className="space-y-1.5">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Судно</p>
          <Input
            placeholder="Название судна"
            value={particulars.name ?? ''}
            onChange={(e) => setVesselParticulars({ name: e.target.value || undefined })}
            className="h-7 text-xs"
          />
          <div className="grid grid-cols-2 gap-1">
            <MiniNumField label="Длина LBP" value={particulars.lengthBpp} unit="м" onChange={(v) => setVesselParticulars({ lengthBpp: v })} />
            <MiniNumField label="Ширина" value={particulars.breadth} unit="м" onChange={(v) => setVesselParticulars({ breadth: v })} />
          </div>
          <div className="grid grid-cols-3 gap-1">
            <MiniNumField label="Лёгкий вес" value={particulars.lightshipWeightKg} unit="кг" onChange={(v) => setVesselParticulars({ lightshipWeightKg: v })} />
            <MiniNumField label="Лёгкий KG" value={particulars.lightshipKG} unit="м" onChange={(v) => setVesselParticulars({ lightshipKG: v })} />
            <MiniNumField label="Лёгкий LCG" value={particulars.lightshipLCG} unit="м" onChange={(v) => setVesselParticulars({ lightshipLCG: v })} />
          </div>
          <div className="space-y-0.5">
            <label className="text-[9px] text-muted-foreground leading-none block">Точка отсчёта LCG/LCF/LCB</label>
            <Select
              value={particulars.longitudinalOrigin}
              onValueChange={(v) => setVesselParticulars({ longitudinalOrigin: v as VesselParticulars['longitudinalOrigin'] })}
            >
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="midships">От миделя</SelectItem>
                <SelectItem value="aft-perpendicular">От кормового перпендикуляра</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Система координат палубы</p>
          <div className="grid grid-cols-3 gap-1">
            <MiniNumField
              label="Смещ. от ДП"
              value={shipFrame?.originOffsetFromCenterlineM ?? 0}
              unit="м"
              onChange={(v) => setShipFrame({ originOffsetFromCenterlineM: v })}
            />
            <MiniNumField
              label="Смещ. от миделя"
              value={shipFrame?.originOffsetFromMidshipsM ?? 0}
              unit="м"
              onChange={(v) => setShipFrame({ originOffsetFromMidshipsM: v })}
            />
            <MiniNumField
              label="Высота над килем"
              value={shipFrame?.heightAboveBaselineM ?? 0}
              unit="м"
              onChange={(v) => setShipFrame({ heightAboveBaselineM: v })}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">Нос палубы: {forwardIsPositiveY ? '+Y' : '−Y'}</span>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px] px-2"
              onClick={() => setDeckForwardIsPositiveY(!forwardIsPositiveY)}
            >
              Сменить
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Гидростатика (по водоизмещению)</p>
          {points.map((pt, i) => (
            <div key={i} className="rounded-md border p-1.5 space-y-1">
              <div className="grid grid-cols-3 gap-1">
                <MiniNumField label="Водоизм." value={pt.displacementKg} unit="кг" onChange={(v) => updateHydrostaticPoint(i, { displacementKg: v })} />
                <MiniNumField label="Осадка" value={pt.draftM} unit="м" onChange={(v) => updateHydrostaticPoint(i, { draftM: v })} />
                <MiniNumField label="KM" value={pt.KM} unit="м" onChange={(v) => updateHydrostaticPoint(i, { KM: v })} />
              </div>
              <div className="flex items-center gap-1">
                <div className="grid grid-cols-3 gap-1 flex-1">
                  <MiniNumField label="LCB" value={pt.LCB ?? 0} unit="м" onChange={(v) => updateHydrostaticPoint(i, { LCB: v })} />
                  <MiniNumField label="LCF" value={pt.LCF ?? 0} unit="м" onChange={(v) => updateHydrostaticPoint(i, { LCF: v })} />
                  <MiniNumField label="MTC" value={pt.MTC ?? 0} unit="т·м/см" onChange={(v) => updateHydrostaticPoint(i, { MTC: v })} />
                </div>
                <button
                  onClick={() => removeHydrostaticPoint(i)}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-destructive"
                  title="Удалить точку"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
          <Button size="sm" variant="outline" className="h-7 text-xs w-full" onClick={() => addHydrostaticPoint()}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Добавить точку гидростатики
          </Button>
          <p className="text-[10px] text-muted-foreground">
            LCB/MTC опциональны — без них расчёт дифферента недоступен (только GM и крен).
          </p>
        </div>

        <div className="space-y-1.5">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Кросс-кривые KN (для полной кривой GZ)</p>
          {knCurves ? (
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{knCurves.headingAngles.length} углов × {knCurves.points.length} точек водоизмещения</span>
              <button
                onClick={() => setKNCrossCurves(undefined)}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-destructive"
                title="Удалить кривые KN"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <>
              <p className="text-[10px] text-muted-foreground">
                Вставьте из формуляра остойчивости: первая строка — углы крена через запятую, далее по строке на
                каждое водоизмещение (водоизмещение, KN...). Пример:
                <br />0,10,20,30,40
                <br />2000000,0,1.2,2.3,3.1,3.6
              </p>
              <textarea
                value={knText}
                onChange={(e) => setKnText(e.target.value)}
                rows={3}
                className="w-full rounded-md border p-1.5 text-[10px] font-mono"
                placeholder={'0,10,20,30,40\n2000000,0,1.2,2.3,3.1,3.6'}
              />
              {knError && <p className="text-[10px] text-destructive">{knError}</p>}
              <Button size="sm" variant="outline" className="h-7 text-xs w-full" onClick={parseKnText}>
                Применить кривые KN
              </Button>
            </>
          )}
        </div>
      </div>
    </Section>
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
  // type="number" silently rejects a comma decimal separator as you type it
  // (Russian convention, e.g. "0,4") — this field accepts both "," and "."
  // so a value like 0.4 doesn't get mangled into 04. Needs its own text
  // buffer (not just formatting `value` on the fly) so an in-progress
  // entry like "0," or "0." isn't immediately snapped back to "0" by the
  // controlled value before the user finishes typing the decimal part.
  const [text, setText] = useState(String(roundForDisplay(value)))
  // Resync the text buffer when `value` changes from outside (not from this
  // field's own onChange) — the React-recommended "adjust state during
  // render" pattern instead of an effect, since setState-in-effect here
  // would cause an extra render pass for no benefit.
  const [prevValue, setPrevValue] = useState(value)
  if (value !== prevValue) {
    setPrevValue(value)
    setText(String(roundForDisplay(value)))
  }

  return (
    <div className="space-y-0.5">
      <label className="text-[9px] text-muted-foreground leading-none block">
        {label}{unit ? ` (${unit})` : ''}
      </label>
      <Input
        type="text"
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          const raw = e.target.value
          setText(raw)
          const v = Number(raw.replace(',', '.'))
          if (!isNaN(v) && raw.trim() !== '') onChange(v)
        }}
        onBlur={() => setText(String(value))}
        className="h-6 text-[11px] px-1"
      />
    </div>
  )
}

