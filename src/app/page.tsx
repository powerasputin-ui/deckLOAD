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
  packDeckVariants,
  packingResultFromManual,
  clampToDeck,
  collidesWith,
  maxLayersFor,
  type ManualPlacement,
  type PackVariant,
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
  const showFreeSpace = useCalculator((s) => s.showFreeSpace)
  const showGrid = useCalculator((s) => s.showGrid)
  const showLabels = useCalculator((s) => s.showLabels)
  const mode = useCalculator((s) => s.mode)
  const manualPlacements = useCalculator((s) => s.manualPlacements)
  const updateManualPlacement = useCalculator((s) => s.updateManualPlacement)
  const removeManualPlacement = useCalculator((s) => s.removeManualPlacement)
  const activeStampId = useCalculator((s) => s.activeStampId)
  const stampRotated = useCalculator((s) => s.stampRotated)
  const pinnedPlacements = useCalculator((s) => s.pinnedPlacements)
  const selectedPinIds = useCalculator((s) => s.selectedPinIds)
  const selectedManualIds = useCalculator((s) => s.selectedManualIds)
  const pinFromPlaced = useCalculator((s) => s.pinFromPlaced)
  const updatePinned = useCalculator((s) => s.updatePinned)
  const removePinned = useCalculator((s) => s.removePinned)
  const togglePinSelection = useCalculator((s) => s.togglePinSelection)
  const clearSelection = useCalculator((s) => s.clearSelection)
  const toggleManualSelection = useCalculator((s) => s.toggleManualSelection)
  const clearManualSelection = useCalculator((s) => s.clearManualSelection)

  const projects = useProjects((s) => s.projects)
  const activeId = useProjects((s) => s.activeId)
  const hydrated = useProjects((s) => s.hydrated)
  const hydrate = useProjects((s) => s.hydrate)
  const activeProject = projects.find((p) => p.id === activeId)
  const saveSnapshot = useProjects((s) => s.saveSnapshot)

  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [variants, setVariants] = useState<PackVariant[]>([])
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

  // Re-apply layout when deck geometry or spacing changes. Covers gap, boardOffset,
  // width, length and clearance — any of these can invalidate existing placements.
  const prevDeck = useRef({
    gap: deck.gap,
    boardOffset: deck.boardOffset,
    width: deck.width,
    length: deck.length,
    clearance: deck.clearance,
  })
  useEffect(() => {
    const prev = prevDeck.current
    const same =
      prev.gap === deck.gap &&
      prev.boardOffset === deck.boardOffset &&
      prev.width === deck.width &&
      prev.length === deck.length &&
      prev.clearance === deck.clearance
    if (same) return
    prevDeck.current = {
      gap: deck.gap,
      boardOffset: deck.boardOffset,
      width: deck.width,
      length: deck.length,
      clearance: deck.clearance,
    }

    const s = useCalculator.getState()
    const hasManual = s.manualPlacements.length > 0
    const hasPinned = s.pinnedPlacements.length > 0
    if (!hasManual && !hasPinned) return

    const effectiveItems = s.globalRotation
      ? s.items
      : s.items.map((it) => ({ ...it, allowRotation: false }))
    const packed = packDeck(deck.width, deck.length, effectiveItems, {
      sortStrategy: s.sortStrategy,
      gap: deck.gap,
      boardOffset: deck.boardOffset,
      clearance: deck.clearance,
    })

    if (s.mode === 'manual') {
      const newManual: ManualPlacement[] = packed.placed.map((p) => ({
        id: crypto.randomUUID(),
        itemId: p.itemId,
        name: p.name,
        x: p.x,
        y: p.y,
        width: p.width,
        length: p.length,
        layers: Math.max(1, p.stackedCount),
        rotated: p.rotated,
        color: p.color,
        weight: p.weight,
      }))
      useCalculator.setState({ manualPlacements: newManual, pinnedPlacements: [], selectedPinIds: [] })
    } else {
      useCalculator.setState({ pinnedPlacements: [], selectedPinIds: [] })
    }
    // Clear stale variants when deck params change (deferred to avoid setState-in-effect)
    queueMicrotask(() => setVariants([]))
    if (packed.unplaced.length > 0) {
      toast.warning(`Параметры изменены: ${packed.unplaced.length} груз(ов) не вместилось`)
    }
  }, [deck.gap, deck.boardOffset, deck.width, deck.length, deck.clearance])

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

  // Rotate a placement around its center, then validate: clamp inside the deck
  // (with boardOffset) and reject if it collides with other pinned/manual items.
  const tryRotatePlacement = (
    current: { x: number; y: number; width: number; length: number },
    others: { x: number; y: number; width: number; length: number }[]
  ): { x: number; y: number; width: number; length: number } | null => {
    // Keep the center fixed so the rotation visually stays in place
    const cx = current.x + current.width / 2
    const cy = current.y + current.length / 2
    const newW = current.length
    const newL = current.width
    let nx = cx - newW / 2
    let ny = cy - newL / 2
    // Clamp inside the usable area (boardOffset)
    const off = deck.boardOffset
    nx = Math.max(off, Math.min(deck.width - off - newW, nx))
    ny = Math.max(off, Math.min(deck.length - off - newL, ny))
    const clamped = clampToDeck(
      { x: nx, y: ny, width: newW, length: newL },
      deck.width,
      deck.length,
      off
    )
    if (collidesWith({ ...clamped, width: newW, length: newL }, others, deck.gap)) {
      return null
    }
    return { x: clamped.x, y: clamped.y, width: newW, length: newL }
  }

  const handleRotatePinned = (id: string) => {
    const pin = pinnedPlacements.find((p) => p.id === id)
    if (!pin) return
    const others = pinnedPlacements
      .filter((p) => p.id !== id)
      .map((p) => ({ x: p.x, y: p.y, width: p.width, length: p.length }))
    const rotated = tryRotatePlacement(pin, others)
    if (!rotated) {
      toast.warning('Невозможно повернуть: нет места')
      return
    }
    updatePinned(id, {
      x: rotated.x,
      y: rotated.y,
      width: rotated.width,
      length: rotated.length,
      rotated: !pin.rotated,
    })
  }

  const handleRotateManual = (id: string) => {
    const mp = manualPlacements.find((m) => m.id === id)
    if (!mp) return
    const others = manualPlacements
      .filter((m) => m.id !== id)
      .map((m) => ({ x: m.x, y: m.y, width: m.width, length: m.length }))
    const rotated = tryRotatePlacement(mp, others)
    if (!rotated) {
      toast.warning('Невозможно повернуть: нет места')
      return
    }
    updateManualPlacement(id, {
      x: rotated.x,
      y: rotated.y,
      width: rotated.width,
      length: rotated.length,
      rotated: !mp.rotated,
    })
  }

  // Check whether a layer change is allowed for a placement.
  // - maxPhys: physical ceiling from clearance / item.height
  // - totalPlacedForItem: current sum of layers across all placements of this item
  // - item.quantity: total units requested
  // Returns { ok: boolean, reason?: string }
  const checkLayerChange = (
    itemId: string,
    currentLayers: number,
    delta: number,
    excludeId?: string
  ): { ok: boolean; reason?: string; maxPhys: number } => {
    const item = items.find((it) => it.id === itemId)
    if (!item) return { ok: false, reason: 'Груз не найден', maxPhys: 1 }
    const maxPhys = maxLayersFor(item, deck.clearance)
    const newLayers = currentLayers + delta
    if (newLayers < 1) return { ok: false, reason: 'Минимум 1 ярус', maxPhys }
    if (newLayers > maxPhys) {
      return {
        ok: false,
        reason: `Превышена высота под палубой — увеличьте зазор (clearance) в настройках, чтобы добавить ярус`,
        maxPhys,
      }
    }
    // Sum of layers across all placements of this item (excluding the one being changed)
    const sumPlaced =
      pinnedPlacements
        .filter((p) => p.itemId === itemId && p.id !== excludeId)
        .reduce((s, p) => s + p.layers, 0) +
      manualPlacements
        .filter((m) => m.itemId === itemId && m.id !== excludeId)
        .reduce((s, m) => s + Math.max(1, m.layers), 0)
    if (sumPlaced + newLayers > item.quantity) {
      return {
        ok: false,
        reason: `Все ${item.quantity} ед. этого груза уже размещены — увеличьте количество в списке грузов`,
        maxPhys,
      }
    }
    return { ok: true, maxPhys }
  }

  const handleLayerChangePinned = (id: string, delta: number) => {
    const pin = pinnedPlacements.find((p) => p.id === id)
    if (!pin) return
    const check = checkLayerChange(pin.itemId, pin.layers, delta, id)
    if (!check.ok) {
      toast.warning(check.reason ?? 'Невозможно изменить ярусы')
      return
    }
    updatePinned(id, { layers: pin.layers + delta })
  }

  const handleLayerChangeManual = (id: string, delta: number) => {
    const mp = manualPlacements.find((m) => m.id === id)
    if (!mp) return
    const current = Math.max(1, mp.layers)
    const check = checkLayerChange(mp.itemId, current, delta, id)
    if (!check.ok) {
      toast.warning(check.reason ?? 'Невозможно изменить ярусы')
      return
    }
    updateManualPlacement(id, { layers: current + delta })
  }

  // Group layer change for multiple selected pins
  const handleGroupLayerChange = (delta: number) => {
    const selected = pinnedPlacements.filter((p) => selectedPinIds.includes(p.id))
    let applied = 0
    let blocked = 0
    for (const pin of selected) {
      const check = checkLayerChange(pin.itemId, pin.layers, delta, pin.id)
      if (check.ok) {
        updatePinned(pin.id, { layers: pin.layers + delta })
        applied++
      } else {
        blocked++
      }
    }
    if (applied > 0 && blocked === 0) {
      toast.success(`Ярусов изменено: ${applied} стоп(ок)`)
    } else if (blocked > 0 && applied === 0) {
      toast.warning(`Невозможно изменить: потолок достигнут (${blocked} стоп.)`)
    } else if (blocked > 0) {
      toast.info(`Изменено ${applied}, блокировано ${blocked} (потолок)`)
    }
  }

  // Group layer change for multiple selected manual placements
  const handleGroupLayerChangeManual = (delta: number) => {
    const selected = manualPlacements.filter((m) => selectedManualIds.includes(m.id))
    let applied = 0
    let blocked = 0
    for (const mp of selected) {
      const current = Math.max(1, mp.layers)
      const check = checkLayerChange(mp.itemId, current, delta, mp.id)
      if (check.ok) {
        updateManualPlacement(mp.id, { layers: current + delta })
        applied++
      } else {
        blocked++
      }
    }
    if (applied > 0 && blocked === 0) {
      toast.success(`Ярусов изменено: ${applied} стоп(ок)`)
    } else if (blocked > 0 && applied === 0) {
      toast.warning(`Невозможно изменить: потолок достигнут (${blocked} стоп.)`)
    } else if (blocked > 0) {
      toast.info(`Изменено ${applied}, блокировано ${blocked} (потолок)`)
    }
  }

  // Switch mode while preserving placements:
  //  - auto -> manual: all placed items (pinned + auto-packed) become manual placements
  //  - manual -> auto: all manual placements become pinned, auto-packer keeps their positions
  const handleModeChange = (newMode: 'auto' | 'manual') => {
    if (newMode === mode) return
    if (newMode === 'manual') {
      // Convert current auto-mode result (pinned + auto-packed) into manual placements,
      // preserving the number of stacked tiers per footprint.
      const newManual: ManualPlacement[] = result.placed.map((p) => ({
        id: crypto.randomUUID(),
        itemId: p.itemId,
        name: p.name,
        x: p.x,
        y: p.y,
        width: p.width,
        length: p.length,
        layers: Math.max(1, p.stackedCount),
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
      // Convert manual placements into pinned placements, preserving layers.
      const newPinned = manualPlacements.map((m) => ({
        id: crypto.randomUUID(),
        itemId: m.itemId,
        name: m.name,
        x: m.x,
        y: m.y,
        width: m.width,
        length: m.length,
        layers: Math.max(1, m.layers),
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

  // Generate several packing variants so the user can choose the best one.
  // Each click produces a fresh set (new seed) — repeated clicks give different options.
  const handleAutoRedistribute = () => {
    const effectiveItems = globalRotation
      ? items
      : items.map((it) => ({ ...it, allowRotation: false }))
    const newVariants = packDeckVariants(
      deck.width,
      deck.length,
      effectiveItems,
      {
        sortStrategy,
        gap: deck.gap,
        boardOffset: deck.boardOffset,
        clearance: deck.clearance,
      },
      3
    )
    setVariants(newVariants)
    // Apply the best variant immediately
    if (newVariants.length > 0) {
      applyVariant(newVariants[0])
    }
    toast.success(`Сгенерировано вариантов: ${newVariants.length}`)
  }

  // Apply a chosen variant: in manual mode store as manual placements,
  // in auto mode clear pins so the packer result shows through.
  const applyVariant = (variant: PackVariant) => {
    const s = useCalculator.getState()
    if (s.mode === 'manual') {
      const newManual: ManualPlacement[] = variant.result.placed.map((p) => ({
        id: crypto.randomUUID(),
        itemId: p.itemId,
        name: p.name,
        x: p.x,
        y: p.y,
        width: p.width,
        length: p.length,
        layers: Math.max(1, p.stackedCount),
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
  }

  const handleSelectVariant = (variant: PackVariant) => {
    applyVariant(variant)
    toast.info(`Применён: ${variant.label} (${variant.utilizationPct}%)`)
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
                      const placedUnits = manualPlacements.reduce(
                        (s, m) => s + Math.max(1, m.layers),
                        0
                      )
                      if (placedUnits >= totalRequested) {
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
                    onLayerChangePinned={handleLayerChangePinned}
                    onLayerChangeManual={handleLayerChangeManual}
                    getLayerInfo={(itemId, currentLayers, excludeId) => {
                      const item = items.find((it) => it.id === itemId)
                      const maxPhys = item ? maxLayersFor(item, deck.clearance) : 1
                      const incCheck = checkLayerChange(itemId, currentLayers, 1, excludeId)
                      return {
                        maxPhys,
                        canIncrease: incCheck.ok,
                        canDecrease: currentLayers > 1,
                        blockReason: incCheck.ok ? undefined : incCheck.reason,
                      }
                    }}
                    selectedManualIds={selectedManualIds}
                    onToggleManualSelection={toggleManualSelection}
                    onClearManualSelection={clearManualSelection}
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
              <PlacementPanel
                mode={mode}
                onAutoRedistribute={handleAutoRedistribute}
                variants={variants}
                onSelectVariant={handleSelectVariant}
                onGroupLayerChange={handleGroupLayerChange}
                onGroupLayerChangeManual={handleGroupLayerChangeManual}
              />
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
