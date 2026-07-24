'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Ship,
  Wand2,
  MousePointerClick,
  Anchor,
  Github,
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
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui/toggle-group'
import { useCalculator, UNIT_LABEL } from '@/store/calculator'
import { useProjects } from '@/store/projects'
import {
  packDeck,
  packingResultFromManual,
  type ManualPlacement,
} from '@/lib/packing'
import { DeckVisualization } from '@/components/calculator/DeckVisualization'
import { ItemList } from '@/components/calculator/ItemList'
import { StatsPanel } from '@/components/calculator/StatsPanel'
import { PlacementPanel } from '@/components/calculator/PlacementPanel'
import { Sidebar } from '@/components/calculator/Sidebar'
import { toast } from 'sonner'

export default function Home() {
  const deck = useCalculator((s) => s.deck)
  const items = useCalculator((s) => s.items)
  const sortStrategy = useCalculator((s) => s.sortStrategy)
  const globalRotation = useCalculator((s) => s.globalRotation)
  const toggleGlobalRotation = useCalculator((s) => s.toggleGlobalRotation)
  const showFreeSpace = useCalculator((s) => s.showFreeSpace)
  const showGrid = useCalculator((s) => s.showGrid)
  const showLabels = useCalculator((s) => s.showLabels)
  const mode = useCalculator((s) => s.mode)
  const setMode = useCalculator((s) => s.setMode)
  const manualPlacements = useCalculator((s) => s.manualPlacements)
  const updateManualPlacement = useCalculator((s) => s.updateManualPlacement)
  const removeManualPlacement = useCalculator((s) => s.removeManualPlacement)
  const activeStampId = useCalculator((s) => s.activeStampId)
  const stampRotated = useCalculator((s) => s.stampRotated)
  const pinnedPlacements = useCalculator((s) => s.pinnedPlacements)
  const selectedPinIds = useCalculator((s) => s.selectedPinIds)
  const pinFromPlaced = useCalculator((s) => s.pinFromPlaced)
  const updatePinned = useCalculator((s) => s.updatePinned)
  const removePinned = useCalculator((s) => s.removePinned)
  const clearPinned = useCalculator((s) => s.clearPinned)
  const togglePinSelection = useCalculator((s) => s.togglePinSelection)
  const clearSelection = useCalculator((s) => s.clearSelection)

  const projects = useProjects((s) => s.projects)
  const activeId = useProjects((s) => s.activeId)
  const hydrated = useProjects((s) => s.hydrated)
  const hydrate = useProjects((s) => s.hydrate)
  const activeProject = projects.find((p) => p.id === activeId)
  const saveSnapshot = useProjects((s) => s.saveSnapshot)
  const createProject = useProjects((s) => s.createProject)
  const switchTo = useProjects((s) => s.switchTo)

  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const loadedProjectId = useRef<string | null>(null)

  // Hydrate projects from localStorage on mount (synchronous)
  useEffect(() => {
    hydrate()
  }, [hydrate])

  // Load project into calculator store when activeId changes (after hydration)
  useEffect(() => {
    if (!hydrated || !activeId) return
    if (loadedProjectId.current === activeId) return
    const proj = projects.find((p) => p.id === activeId)
    if (!proj) return
    useCalculator.setState({
      deck: { ...proj.deck },
      items: proj.items.map((it) => ({ ...it })),
      manualPlacements: proj.manualPlacements.map((m) => ({ ...m })),
      pinnedPlacements: (proj.pinnedPlacements ?? []).map((p) => ({ ...p })),
      selectedPinIds: [],
      mode: proj.mode,
      sortStrategy: proj.sortStrategy,
      globalRotation: proj.globalRotation,
      showFreeSpace: proj.showFreeSpace,
      showGrid: proj.showGrid,
      showLabels: proj.showLabels,
      activeStampId: proj.mode === 'manual' ? proj.items[0]?.id ?? null : null,
      stampRotated: false,
    })
    loadedProjectId.current = activeId
  }, [hydrated, activeId, projects])

  // Auto-save snapshot (debounced)
  useEffect(() => {
    if (!activeId || loadedProjectId.current !== activeId) return
    const t = setTimeout(() => {
      saveSnapshot({
        id: activeId,
        deck,
        items: items.map((it) => ({ ...it })),
        manualPlacements: manualPlacements.map((m) => ({ ...m })),
        pinnedPlacements: pinnedPlacements.map((p) => ({ ...p })),
        mode,
        sortStrategy,
        globalRotation,
        showFreeSpace,
        showGrid,
        showLabels,
      })
    }, 400)
    return () => clearTimeout(t)
  }, [activeId, deck, items, manualPlacements, pinnedPlacements, mode, sortStrategy, globalRotation, showFreeSpace, showGrid, showLabels, saveSnapshot])

  const result = useMemo(() => {
    if (mode === 'manual') {
      const totalRequested = items.reduce((s, it) => s + it.quantity, 0)
      return packingResultFromManual(deck.width, deck.length, manualPlacements, totalRequested)
    }
    const effectiveItems = globalRotation
      ? items
      : items.map((it) => ({ ...it, allowRotation: false }))
    return packDeck(deck.width, deck.length, effectiveItems, {
      sortStrategy,
      gap: deck.gap,
      boardOffset: deck.boardOffset,
      clearance: deck.clearance,
      pinned: pinnedPlacements,
    })
  }, [deck.width, deck.length, deck.gap, deck.boardOffset, deck.clearance, items, sortStrategy, globalRotation, mode, manualPlacements, pinnedPlacements])

  const activeStamp = useMemo(() => {
    if (mode !== 'manual' || !activeStampId) return null
    const it = items.find((x) => x.id === activeStampId)
    if (!it) return null
    return { id: it.id, width: it.width, length: it.length, color: it.color, name: it.name, weight: it.weight }
  }, [mode, activeStampId, items])

  // When boardOffset changes, only clamp existing placements into the new
  // usable area — we do NOT re-pack, so the user's manual arrangement is
  // preserved. The gap value affects future collision checks and auto-packing
  // but does not move already-placed items.
  const prevBoardOffset = useRef(deck.boardOffset)
  useEffect(() => {
    if (prevBoardOffset.current === deck.boardOffset) return
    prevBoardOffset.current = deck.boardOffset

    const s = useCalculator.getState()
    const off = deck.boardOffset
    const clampXY = (x: number, y: number, w: number, l: number) => ({
      x: Math.max(off, Math.min(deck.width - off - w, x)),
      y: Math.max(off, Math.min(deck.length - off - l, y)),
    })

    let changed = false
    if (s.manualPlacements.length > 0) {
      const next = s.manualPlacements.map((m) => {
        const c = clampXY(m.x, m.y, m.width, m.length)
        if (c.x !== m.x || c.y !== m.y) {
          changed = true
          return { ...m, x: c.x, y: c.y }
        }
        return m
      })
      if (changed) useCalculator.setState({ manualPlacements: next })
    }
    if (s.pinnedPlacements.length > 0) {
      const next = s.pinnedPlacements.map((p) => {
        const c = clampXY(p.x, p.y, p.width, p.length)
        if (c.x !== p.x || c.y !== p.y) {
          changed = true
          return { ...p, x: c.x, y: c.y }
        }
        return p
      })
      if (changed) useCalculator.setState({ pinnedPlacements: next })
    }
  }, [deck.boardOffset, deck.width, deck.length])

  const handleNewCalculation = () => {
    useCalculator.setState({
      deck: { width: 20, length: 8, unit: 'm', gap: 0.1, boardOffset: 0.2, clearance: 0 },
      items: [],
      manualPlacements: [],
      pinnedPlacements: [],
      selectedPinIds: [],
      mode: 'auto',
      activeStampId: null,
      stampRotated: false,
    })
    toast.success('Текущий расчёт очищен')
  }

  const handleResetCurrent = () => {
    useCalculator.setState({
      deck: { width: 20, length: 8, unit: 'm', gap: 0.1, boardOffset: 0.2, clearance: 5.2 },
      items: [
        { id: crypto.randomUUID(), name: 'Контейнер 20ft', width: 6.06, length: 2.44, height: 2.59, quantity: 4, color: '#0ea5e9', allowRotation: true, weight: 2200 },
        { id: crypto.randomUUID(), name: 'Паллета EUR', width: 1.2, length: 0.8, height: 1.6, quantity: 12, color: '#10b981', allowRotation: true, weight: 500 },
        { id: crypto.randomUUID(), name: 'Ящик', width: 1.5, length: 1.0, height: 1.0, quantity: 6, color: '#f59e0b', allowRotation: true, weight: 300 },
      ],
      manualPlacements: [],
      pinnedPlacements: [],
      selectedPinIds: [],
      mode: 'auto',
      activeStampId: null,
    })
    toast.info('Восстановлен демонстрационный пример')
  }

  const handleRotatePinned = (id: string) => {
    const pin = pinnedPlacements.find((p) => p.id === id)
    if (!pin) return
    updatePinned(id, {
      width: pin.length,
      length: pin.width,
      rotated: !pin.rotated,
    })
  }

  const handleRotateManual = (id: string) => {
    const mp = manualPlacements.find((m) => m.id === id)
    if (!mp) return
    updateManualPlacement(id, {
      width: mp.length,
      length: mp.width,
      rotated: !mp.rotated,
    })
  }

  // Switch mode while preserving placements:
  //  - auto -> manual: all placed items (pinned + auto-packed) become manual placements
  //  - manual -> auto: all manual placements become pinned, auto-packer keeps their positions
  const handleModeChange = (newMode: 'auto' | 'manual') => {
    if (newMode === mode) return
    if (newMode === 'manual') {
      // Convert current auto-mode result (pinned + auto-packed) into manual placements
      const newManual: ManualPlacement[] = result.placed.map((p) => ({
        id: crypto.randomUUID(),
        itemId: p.itemId,
        name: p.name,
        x: p.x,
        y: p.y,
        width: p.width,
        length: p.length,
        rotated: p.rotated,
        color: p.color,
        weight: p.weight,
      }))
      useCalculator.setState({
        mode: 'manual',
        manualPlacements: newManual,
        pinnedPlacements: [],
        selectedPinIds: [],
        activeStampId: items[0]?.id ?? null,
      })
      toast.info('Ручной режим — размещения сохранены')
    } else {
      // Convert manual placements into pinned placements; auto-packer will fill the rest
      const newPinned = manualPlacements.map((m) => ({
        id: crypto.randomUUID(),
        itemId: m.itemId,
        name: m.name,
        x: m.x,
        y: m.y,
        width: m.width,
        length: m.length,
        layers: 1,
        rotated: m.rotated,
        color: m.color,
        weight: m.weight,
      }))
      useCalculator.setState({
        mode: 'auto',
        pinnedPlacements: newPinned,
        manualPlacements: [],
        selectedPinIds: [],
        activeStampId: null,
      })
      toast.info('Авто-режим — размещения сохранены как закреплённые')
    }
  }

  // Force re-pack: clear all pins/manual placements so the auto-packer redistributes
  // everything from scratch using the current deck settings.
  // In manual mode, repack and store the result back as manual placements so the
  // user keeps working manually with the new gap/offset applied.
  const handleAutoRedistribute = () => {
    if (mode === 'manual') {
      const effectiveItems = globalRotation
        ? items
        : items.map((it) => ({ ...it, allowRotation: false }))
      const packed = packDeck(deck.width, deck.length, effectiveItems, {
        sortStrategy,
        gap: deck.gap,
        boardOffset: deck.boardOffset,
        clearance: deck.clearance,
      })
      const newManual: ManualPlacement[] = packed.placed.map((p) => ({
        id: crypto.randomUUID(),
        itemId: p.itemId,
        name: p.name,
        x: p.x,
        y: p.y,
        width: p.width,
        length: p.length,
        rotated: p.rotated,
        color: p.color,
        weight: p.weight,
      }))
      useCalculator.setState({
        manualPlacements: newManual,
        pinnedPlacements: [],
        selectedPinIds: [],
      })
    } else {
      useCalculator.setState({
        pinnedPlacements: [],
        manualPlacements: [],
        selectedPinIds: [],
      })
    }
    toast.success('Автораспределение выполнено')
  }

  return (
    <div className="h-screen flex flex-col bg-muted/30 overflow-hidden">
      {/* Top bar */}
      <header className="shrink-0 border-b bg-background/95 backdrop-blur z-30">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-sm font-semibold truncate">
              {activeProject?.name ?? 'DeckLoad'}
            </h1>
            {activeProject && (
              <span className="text-xs text-muted-foreground hidden md:inline">
                · {activeProject.deck.width}×{activeProject.deck.length} {activeProject.deck.unit}
              </span>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <Badge variant="outline" className="hidden lg:inline-flex">
              <Anchor className="h-3 w-3 mr-1" />
              {result.placed.length}/{result.requestedCount} ед. · {Math.round(result.utilization * 100)}%
            </Badge>

            {/* Mode toggle */}
            <ToggleGroup
              type="single"
              value={mode}
              onValueChange={(v) => {
                if (v) handleModeChange(v as 'auto' | 'manual')
              }}
              className="rounded-lg border bg-card"
            >
              <ToggleGroupItem value="auto" className="px-2.5 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                <Wand2 className="h-3.5 w-3.5 mr-1" />
                <span className="text-xs font-medium hidden sm:inline">Авто</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="manual" className="px-2.5 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                <MousePointerClick className="h-3.5 w-3.5 mr-1" />
                <span className="text-xs font-medium hidden sm:inline">Ручной</span>
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
      </header>

      {/* Workspace */}
      <div className="flex-1 flex min-h-0">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((v) => !v)}
          onNewCalculation={handleNewCalculation}
          onResetCurrent={handleResetCurrent}
        />

        {/* Main content */}
        <main className="flex-1 min-w-0 overflow-auto">
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 p-4">
            {/* Visualization */}
            <div className="xl:col-span-8">
              <Card className="h-full">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Ship className="h-4 w-4 text-primary" />
                        Схема палубы
                        {mode === 'manual' && (
                          <Badge variant="secondary" className="text-[10px]">ручной режим</Badge>
                        )}
                      </CardTitle>
                      <CardDescription className="mt-0.5">
                        Вид сверху · зелёная штриховка — свободное пространство
                        {deck.gap > 0 && ` · отступ ${deck.gap} ${UNIT_LABEL[deck.unit]}`}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2 text-xs flex-wrap">
                      <LegendDot color="#0ea5e9" label="Груз" />
                      <LegendDot hatch label="Свободно" />
                      <LegendDot icon="↻" label="Повернут" />
                      {mode === 'auto' && (
                        <LegendDot color="#7c3aed" label="Закреплён" />
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <DeckVisualization
                    result={result}
                    unit={deck.unit}
                    gap={deck.gap}
                    boardOffset={deck.boardOffset}
                    showFreeSpace={showFreeSpace}
                    showGrid={showGrid}
                    showLabels={showLabels}
                    hoveredItemId={hoveredItemId}
                    onHover={setHoveredItemId}
                    mode={mode}
                    activeStamp={activeStamp}
                    stampRotated={stampRotated}
                    onPlace={(p) => {
                      const totalRequested = items.reduce((s, it) => s + it.quantity, 0)
                      if (manualPlacements.length >= totalRequested) {
                        toast.warning('Все грузы уже размещены')
                        return
                      }
                      useCalculator.getState().addManualPlacement(p)
                    }}
                    onMoveManual={(id, x, y) => updateManualPlacement(id, { x, y })}
                    onRemoveManual={removeManualPlacement}
                    manualPlacements={manualPlacements}
                    pinnedPlacements={pinnedPlacements}
                    selectedPinIds={selectedPinIds}
                    onPinPlaced={(p) => pinFromPlaced(p)}
                    onUpdatePinned={(id, x, y) => updatePinned(id, { x, y })}
                    onRemovePinned={removePinned}
                    onRotatePinned={handleRotatePinned}
                    onTogglePinSelection={togglePinSelection}
                    onClearSelection={clearSelection}
                    onRotateManual={handleRotateManual}
                  />
                  <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      Размещено {result.placed.length} из {result.requestedCount} ед.
                    </span>
                    <span>
                      Загрузка:{' '}
                      <span className="font-semibold text-foreground">
                        {Math.round(result.utilization * 100)}%
                      </span>
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right panel: placement + stats + items */}
            <div className="xl:col-span-4 space-y-4">
              <PlacementPanel mode={mode} onAutoRedistribute={handleAutoRedistribute} />
              <StatsPanel result={result} unit={deck.unit} />
              <ItemList
                result={result}
                unit={deck.unit}
                hoveredItemId={hoveredItemId}
                onHover={setHoveredItemId}
              />
            </div>
          </div>
        </main>
      </div>

      {/* Footer */}
      <footer className="shrink-0 border-t bg-background py-2 px-4">
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span className="truncate">
            DeckLoad · Maximal Rectangles (BSSF) · вращение, отступы, мульти-проекты
          </span>
          <Button variant="ghost" size="sm" asChild className="h-6 hidden sm:inline-flex">
            <a href="https://github.com" target="_blank" rel="noreferrer" className="text-xs">
              <Github className="h-3 w-3 mr-1" />
              Исходники
            </a>
          </Button>
        </div>
      </footer>
    </div>
  )
}

function LegendDot({
  color,
  label,
  hatch,
  icon,
}: {
  color?: string
  label: string
  hatch?: boolean
  icon?: string
}) {
  return (
    <span className="inline-flex items-center gap-1">
      {hatch ? (
        <span
          className="h-3 w-3 rounded-sm border border-emerald-500/50"
          style={{
            backgroundImage:
              'repeating-linear-gradient(45deg, rgba(16,185,129,0.35) 0 2px, transparent 2px 5px)',
          }}
        />
      ) : icon ? (
        <span className="grid h-3 w-3 place-items-center text-[10px] font-bold text-primary">
          {icon}
        </span>
      ) : (
        <span
          className="h-3 w-3 rounded-sm border border-black/10"
          style={{ backgroundColor: color }}
        />
      )}
      {label}
    </span>
  )
}
