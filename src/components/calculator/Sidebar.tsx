'use client'

import { useState } from 'react'
import {
  FolderOpen,
  Plus,
  RotateCcw,
  Settings2,
  Layers,
  Eye,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Pencil,
  Check,
  Copy,
  Trash2,
  PanelLeftClose,
  PanelLeft,
  Anchor,
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
import { useCalculator, UNIT_LABEL, type Unit } from '@/store/calculator'
import type { SortStrategy } from '@/lib/packing'
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
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui/toggle-group'

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
  onNewCalculation: () => void
  onResetCurrent: () => void
}

export function Sidebar({
  collapsed,
  onToggle,
  onNewCalculation,
  onResetCurrent,
}: SidebarProps) {
  const projects = useProjects((s) => s.projects)
  const activeId = useProjects((s) => s.activeId)
  const switchTo = useProjects((s) => s.switchTo)
  const createProject = useProjects((s) => s.createProject)
  const deleteProject = useProjects((s) => s.deleteProject)
  const duplicateProject = useProjects((s) => s.duplicateProject)
  const renameProject = useProjects((s) => s.renameProject)

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
      {/* Collapse button */}
      <div className="flex items-center justify-end px-3 py-2 border-b">
        <Button variant="ghost" size="icon" onClick={onToggle} className="h-7 w-7 shrink-0">
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
                      ? 'border-primary bg-primary/10'
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

        {/* Display settings */}
        <DisplaySettings />

        {/* Presets */}
        <PresetsSection />
      </div>

      {/* Footer reset */}
      <div className="border-t p-3">
        <Button variant="ghost" size="sm" onClick={onResetCurrent} className="w-full h-8 text-xs">
          <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
          Сбросить к примеру
        </Button>
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
              onChange={(e) => setDeck({ width: Number(e.target.value) || 0 })}
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
              onChange={(e) => setDeck({ length: Number(e.target.value) || 0 })}
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
              onChange={(e) => setDeck({ gap: Math.max(0, Number(e.target.value) || 0) })}
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
              onChange={(e) => setDeck({ boardOffset: Math.max(0, Number(e.target.value) || 0) })}
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
              onChange={(e) => setDeck({ clearance: Math.max(0, Number(e.target.value) || 0) })}
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

function DisplaySettings() {
  const showFreeSpace = useCalculator((s) => s.showFreeSpace)
  const showGrid = useCalculator((s) => s.showGrid)
  const showLabels = useCalculator((s) => s.showLabels)
  const globalRotation = useCalculator((s) => s.globalRotation)
  const toggleFreeSpace = useCalculator((s) => s.toggleFreeSpace)
  const toggleGrid = useCalculator((s) => s.toggleGrid)
  const toggleLabels = useCalculator((s) => s.toggleLabels)
  const toggleGlobalRotation = useCalculator((s) => s.toggleGlobalRotation)

  return (
    <Section icon={<Eye className="h-4 w-4" />} title="Отображение" defaultOpen={false}>
      <div className="space-y-2">
        <Toggle label="Разрешить вращение" checked={globalRotation} onToggle={toggleGlobalRotation} />
        <Toggle label="Свободное пространство" checked={showFreeSpace} onToggle={toggleFreeSpace} />
        <Toggle label="Сетка" checked={showGrid} onToggle={toggleGrid} />
        <Toggle label="Метки грузов" checked={showLabels} onToggle={toggleLabels} />
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

function PresetsSection() {
  const loadPreset = useCalculator((s) => s.loadPreset)
  const currentUnit = useCalculator((s) => s.deck.unit)
  const handleLoad = (name: 'containers' | 'pallets' | 'vehicles' | 'mixed', label: string) => {
    if (currentUnit !== 'm') {
      toast.info('Единицы измерения сброшены на метры')
    }
    loadPreset(name)
    toast.success(`${label} загружен`)
  }
  return (
    <Section icon={<Sparkles className="h-4 w-4" />} title="Пресеты" defaultOpen={false}>
      <div className="grid grid-cols-2 gap-1.5">
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleLoad('containers', 'Контейнеры')}>
          Контейнеры
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleLoad('pallets', 'Паллеты')}>
          Паллеты
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleLoad('vehicles', 'Авто')}>
          Авто
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleLoad('mixed', 'Смешанный')}>
          Смешанный
        </Button>
      </div>
    </Section>
  )
}
