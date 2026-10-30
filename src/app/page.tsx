'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { v4 as uuid } from 'uuid'
import {
  AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { fmtNumber, fmtTonnes, pluralRu } from '@/lib/utils'
import { cargoNumbers } from '@/lib/cargoPalette'
import { Badge } from '@/components/ui/badge'
import { useCalculator, UNIT_LABEL, convertLength, clearCalculatorHistory, undoCalculator, redoCalculator, PALETTE, autoPlacementKey } from '@/store/calculator'
import { useProjects, scheduleAutosave, downloadCorruptedStorage } from '@/store/projects'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  packDeckVariants,
  erodePolygon,
  checkZoneLoads,
  computeZoneLoads,
  LASHING_DEVICES,
  type ManualPlacement,
  type PinnedPlacement,
  type PackVariant,
  type CompositionSegment,
  separationViolations,
} from '@/lib/packing'
import { placementLayersOfItem, placementTotalLayers, placementTotalWeightKg, placementCategorySet, placementCategoryLabel } from '@/lib/placementComposition'
import { DeckVisualization } from '@/components/calculator/DeckVisualization'
const Deck3DView = dynamic(() => import('@/components/calculator/Deck3DView'), {
  ssr: false,
  loading: () => (
    <div className="w-full rounded-lg border flex items-center justify-center text-sm text-muted-foreground" style={{ height: 480 }}>
      Загрузка 3D...
    </div>
  ),
})
import { TopBar } from '@/components/shell/TopBar'
import { ProjectMenu } from '@/components/shell/ProjectMenu'
import { HelpMenu } from '@/components/shell/HelpMenu'
import { SectionPanel } from '@/components/shell/SectionPanel'
import { StatusLine } from '@/components/shell/StatusLine'
import { TripTabs } from '@/components/shell/TripTabs'
import { ViewMenu } from '@/components/shell/ViewMenu'
import { VesselSection } from '@/components/sections/VesselSection'
import { CargoSection } from '@/components/sections/CargoSection'
import { PlacementSection } from '@/components/sections/PlacementSection'
import { ChecksSection } from '@/components/sections/ChecksSection'
import { StabilityWorkspace } from '@/components/stability/StabilityWorkspace'
import { CargoDrawer } from '@/components/cargo/CargoDrawer'
import { CargoTable } from '@/components/cargo/CargoTable'
import { StampHint } from '@/components/cargo/StampHint'
import { ReportSection } from '@/components/sections/ReportSection'
import { sectionMarks, type SectionId } from '@/lib/workflow'
import type { StatusLineInput } from '@/lib/statusLine'
import { buildChecks, checkCounts, checkDetails, type CheckAction, type CheckId } from '@/lib/checks'
import { evaluateDeckTripStability, gatherPlanFacts, lashingVerdict, stackProblems } from '@/lib/planFacts'
import { Inspector, INSPECTOR_WIDTH_PX, type InspectedSelection, type InspectedStack, type StackActions } from '@/components/shell/Inspector'
import { StackLashing } from '@/components/shell/StackLashing'
import { MiniPanel, StackMenuItems } from '@/components/shell/MiniPanel'
import { VideoIntro } from '@/components/intro/VideoIntro'
import { useFirstRun } from '@/hooks/useFirstRun'
import { useUndoRedo } from '@/hooks/useUndoRedo'
import { useTrips } from '@/hooks/useTrips'
import { useModeSwitch } from '@/hooks/useModeSwitch'
import { useProjectActions } from '@/hooks/useProjectActions'
import { usePlacementActions } from '@/hooks/usePlacementActions'
import { useMergeActions } from '@/hooks/useMergeActions'
import { isQuarantined, matchLashingCarryover } from '@/store/placementCarryover'
import { ProductTour, type TourStep } from '@/components/onboarding/ProductTour'
import { exportPlanPdf } from '@/lib/exportPdf'
import { wouldExceedDeckCapacity } from '@/lib/cargoValidation'
import { keptByVariants } from '@/lib/variantKeep'
import { toast } from 'sonner'

// The left panel's open section and whether it's collapsed are kept in this
// browser, not in the calculation (spec 8.7) — same guarded storage as above.
const PANEL_SECTION_KEY = 'deckload-panel-section'
const PANEL_COLLAPSED_KEY = 'deckload-panel-collapsed'
const PANEL_SECTIONS: SectionId[] = ['vessel', 'cargo', 'placement', 'checks', 'report']
function readPanelSection(): SectionId {
  try {
    const v = window.localStorage.getItem(PANEL_SECTION_KEY)
    return PANEL_SECTIONS.includes(v as SectionId) ? (v as SectionId) : 'cargo'
  } catch {
    return 'cargo'
  }
}
function readPanelCollapsed(): boolean {
  try {
    return window.localStorage.getItem(PANEL_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}
function writePanelSetting(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // not remembered across visits
  }
}

// What a list of variants was built from (phase 0, L13; spec 8.2): the
// calculation, the open trip, the cargo, the deck and the rules of placement,
// and last the placements holding the trip's layout. Applying a variant
// re-keeps the list with the placements it wrote, so a stack locked, moved
// or placed since — or an undo — drops the list instead of letting a stale
// variant overwrite it (L20: variants never move what is fixed).
type VariantSource = Pick<
  ReturnType<typeof useCalculator.getState>,
  'deck' | 'items' | 'mode' | 'manualPlacements' | 'pinnedPlacementsByTrip' | 'separationRules' | 'globalRotation'
>
function variantInputsOf(s: VariantSource, projectId: string | null, tripIndex: number): unknown[] {
  return [
    projectId,
    tripIndex,
    s.mode,
    s.items,
    s.deck.width,
    s.deck.length,
    s.deck.unit,
    s.deck.gap,
    s.deck.boardOffset,
    s.deck.clearance,
    s.deck.outline,
    s.deck.restrictionZones,
    s.deck.loadZones,
    s.deck.maxDeckCargoT,
    s.deck.lashingPoints,
    s.separationRules,
    s.globalRotation,
    s.mode === 'manual' ? s.manualPlacements : s.pinnedPlacementsByTrip[tripIndex],
  ]
}

// The five-step tour (spec 10.2). Each `selector` targets a `data-tour`
// attribute on the real element in the frame — the tour never needs its own
// copy of what it points at.
const TOUR_STEPS: TourStep[] = [
  {
    id: 'vessel',
    selector: '[data-tour="section-vessel"]',
    title: 'Судно',
    body: 'Выберите судно из библиотеки или задайте свою палубу.',
  },
  {
    id: 'cargo',
    selector: '[data-tour="section-cargo"]',
    title: 'Грузы',
    body: 'Добавьте груз. Номер груза один и тот же на палубе, в списке и в PDF.',
  },
  {
    id: 'deck',
    selector: '[data-tour="deck-view"]',
    title: 'Палуба',
    body: 'Грузы расставляются сами. Перетащите штабель, чтобы закрепить его, или выделите и правьте справа.',
  },
  {
    id: 'status',
    selector: '[data-tour="status-line"]',
    title: 'Итог и проверки',
    body: 'Здесь вес, рейсы, остойчивость и всё, что требует внимания. Подробности — в разделе «Проверки».',
  },
  {
    id: 'pdf',
    selector: '[data-tour="export-pdf"]',
    title: 'Скачать PDF',
    body: 'План погрузки для передачи на судно.',
  },
]




export default function Home() {
  const { clientReady, entered, handleEnterIntro, handleReplayIntro, tourActive, handleCloseTour, handleShowTour } = useFirstRun()
  const { canUndo, canRedo } = useUndoRedo()
  const deck = useCalculator((s) => s.deck)
  const setDeck = useCalculator((s) => s.setDeck)
  const items = useCalculator((s) => s.items)
  const sortStrategy = useCalculator((s) => s.sortStrategy)
  const globalRotation = useCalculator((s) => s.globalRotation)
  const showFreeSpace = useCalculator((s) => s.showFreeSpace)
  const showGrid = useCalculator((s) => s.showGrid)
  const showLabels = useCalculator((s) => s.showLabels)
  const showCargoContents = useCalculator((s) => s.showCargoContents)
  const setDeckBackgroundImage = useCalculator((s) => s.setDeckBackgroundImage)
  const deckPhotoTool = useCalculator((s) => s.deckPhotoTool)
  const setDeckPhotoTool = useCalculator((s) => s.setDeckPhotoTool)
  const setDeckBackgroundImageRect = useCalculator((s) => s.setDeckBackgroundImageRect)
  const mode = useCalculator((s) => s.mode)
  const manualPlacements = useCalculator((s) => s.manualPlacements)
  const updateManualPlacement = useCalculator((s) => s.updateManualPlacement)
  const removeManualPlacement = useCalculator((s) => s.removeManualPlacement)
  const activeStampId = useCalculator((s) => s.activeStampId)
  const setActiveStamp = useCalculator((s) => s.setActiveStamp)
  const addOrIncrementCargoFromTemplate = useCalculator((s) => s.addOrIncrementCargoFromTemplate)
  const drawingCustomShape = useCalculator((s) => s.drawingCustomShape)
  const pendingCustomShape = useCalculator((s) => s.pendingCustomShape)
  const setPendingCustomShape = useCalculator((s) => s.setPendingCustomShape)
  const editingDeckOutline = useCalculator((s) => s.editingDeckOutline)
  const setEditingDeckOutline = useCalculator((s) => s.setEditingDeckOutline)
  const stampRotated = useCalculator((s) => s.stampRotated)
  const toggleStampRotation = useCalculator((s) => s.toggleStampRotation)
  const pinnedPlacementsByTrip = useCalculator((s) => s.pinnedPlacementsByTrip)
  const selectedPinIds = useCalculator((s) => s.selectedPinIds)
  const selectedManualIds = useCalculator((s) => s.selectedManualIds)
  const pinFromPlaced = useCalculator((s) => s.pinFromPlaced)
  const updatePinned = useCalculator((s) => s.updatePinned)
  const removePinned = useCalculator((s) => s.removePinned)
  const togglePinSelection = useCalculator((s) => s.togglePinSelection)
  const toggleAutoSelection = useCalculator((s) => s.toggleAutoSelection)
  const selectedAutoKeys = useCalculator((s) => s.selectedAutoKeys)
  const clearSelection = useCalculator((s) => s.clearSelection)
  const selectPins = useCalculator((s) => s.selectPins)
  const toggleManualSelection = useCalculator((s) => s.toggleManualSelection)
  const clearManualSelection = useCalculator((s) => s.clearManualSelection)
  const separationRules = useCalculator((s) => s.separationRules)
  // separationRules.minDistance is always stored in meters (unit-independent);
  // convert to the deck's active display unit before comparing against
  // geometry (item/deck coordinates), which are always in that active unit.
  const separationRulesInUnit = useMemo(
    () => separationRules.map((r) => ({ ...r, minDistance: convertLength(r.minDistance, 'm', deck.unit) })),
    [separationRules, deck.unit]
  )
  // Board offset along the real contour on a non-rectangular deck — see
  // erodePolygon in packing.ts. undefined for a plain rectangle deck, so
  // every `usableOutline &&` check below is dead code there (no behavior
  // change for existing projects without a custom outline).
  const usableOutline = useMemo(
    () => (deck.outline && deck.outline.length >= 3 ? erodePolygon(deck.outline, deck.boardOffset) : undefined),
    [deck.outline, deck.boardOffset]
  )
  const placingLashingPoint = useCalculator((s) => s.placingLashingPoint)
  const setPlacingLashingPoint = useCalculator((s) => s.setPlacingLashingPoint)
  const placingPowerSocket = useCalculator((s) => s.placingPowerSocket)
  const setPlacingPowerSocket = useCalculator((s) => s.setPlacingPowerSocket)
  const addPowerSocket = useCalculator((s) => s.addPowerSocket)
  const updatePowerSocket = useCalculator((s) => s.updatePowerSocket)
  const placingAnnotation = useCalculator((s) => s.placingAnnotation)
  const setPlacingAnnotation = useCalculator((s) => s.setPlacingAnnotation)
  const addAnnotation = useCalculator((s) => s.addAnnotation)
  const updateAnnotation = useCalculator((s) => s.updateAnnotation)
  const addLashingPoint = useCalculator((s) => s.addLashingPoint)
  const updateLashingPoint = useCalculator((s) => s.updateLashingPoint)
  const updateLoadZone = useCalculator((s) => s.updateLoadZone)
  const drawingRestrictionShape = useCalculator((s) => s.drawingRestrictionShape)
  const setDrawingRestrictionShape = useCalculator((s) => s.setDrawingRestrictionShape)
  const drawingRestrictionZoneFreeform = useCalculator((s) => s.drawingRestrictionZoneFreeform)
  const setDrawingRestrictionZoneFreeform = useCalculator((s) => s.setDrawingRestrictionZoneFreeform)
  const addRestrictionZone = useCalculator((s) => s.addRestrictionZone)
  const updateRestrictionZone = useCalculator((s) => s.updateRestrictionZone)
  const removeRestrictionZone = useCalculator((s) => s.removeRestrictionZone)

  const projects = useProjects((s) => s.projects)
  const activeId = useProjects((s) => s.activeId)
  const hydrated = useProjects((s) => s.hydrated)
  const hydrate = useProjects((s) => s.hydrate)
  const saveSnapshot = useProjects((s) => s.saveSnapshot)

  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null)
  // Hovering the cargo list scrolls rows under a stationary cursor, which
  // fires mouseenter/mouseleave (and thus setHoveredItemId) many times per
  // scroll gesture — each one re-renders the whole tree (deck SVG included),
  // which made the list scroll feel laggy. Coalescing to at most one state
  // update per animation frame keeps hover-highlight working but caps the
  // re-render rate to the screen's actual refresh cadence.
  const pendingHoverRef = useRef<string | null>(null)
  const hoverRafRef = useRef<number | null>(null)
  const handleHover = useCallback((id: string | null) => {
    pendingHoverRef.current = id
    if (hoverRafRef.current !== null) return
    hoverRafRef.current = requestAnimationFrame(() => {
      hoverRafRef.current = null
      setHoveredItemId(pendingHoverRef.current)
    })
  }, [])
  useEffect(() => {
    return () => {
      if (hoverRafRef.current !== null) cancelAnimationFrame(hoverRafRef.current)
    }
  }, [])
  // The row above the deck that holds the canvas tools (spec 6.10).
  const [canvasToolsEl, setCanvasToolsEl] = useState<HTMLDivElement | null>(null)
  const [activeSection, setActiveSection] = useState<SectionId>(() => (typeof window === 'undefined' ? 'cargo' : readPanelSection()))
  const [panelCollapsed, setPanelCollapsed] = useState(() => typeof window !== 'undefined' && readPanelCollapsed())
  // A section opens in the panel, which unfolds if it was collapsed (spec 5.4).
  const openSection = useCallback((id: SectionId) => {
    setActiveSection(id)
    setPanelCollapsed(false)
    writePanelSetting(PANEL_SECTION_KEY, id)
    writePanelSetting(PANEL_COLLAPSED_KEY, '0')
  }, [])
  const changePanelCollapsed = useCallback((collapsed: boolean) => {
    setPanelCollapsed(collapsed)
    writePanelSetting(PANEL_COLLAPSED_KEY, collapsed ? '1' : '0')
  }, [])
  // 3D is a read-only camera-orbit snapshot of the same layout — no
  // drag/pin/zone editing there, that stays exclusively in the 2D view.
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d')
  // What the middle of the screen shows: the deck, or the stability
  // workspace in its place (spec 2026-10-24, 6.1).
  const [workspace, setWorkspace] = useState<'deck' | 'stability'>('deck')
  // The cargo table across the bottom (spec 5.4), closed at first.
  const [cargoTableOpen, setCargoTableOpen] = useState(false)
  // The check open in «Проверки», one at a time (spec 8.4).
  const [openCheck, setOpenCheck] = useState<CheckId | null>(null)
  // Variants are a snapshot of one project's cargo on one trip. Applying one
  // after switching project or trip, or after editing the cargo or the deck,
  // used to write a stale layout over the current one — so they're kept
  // together with what they were built from and only shown while that still
  // matches (see `variants` below the trip clamp).
  // `applied` is the variant on the deck: the list is kept with the
  // placements it wrote (see variantInputsOf), so while it shows, the deck
  // holds that variant.
  const [variantsSnapshot, setVariantsSnapshot] = useState<{
    list: PackVariant[]
    builtFor: unknown[]
    applied?: number
  }>({
    list: [],
    builtFor: [],
  })
  // A stack is being dragged on the deck: the inspector steps aside until the
  // drop, so it doesn't cover where the stack may go.
  const [stackDragging, setStackDragging] = useState(false)
  const loadedProjectId = useRef<string | null>(null)
  // Baseline for the load-zone overload toast below — reset whenever the
  // project's cargo/deck gets wholesale-replaced (loaded, "new calculation",
  // "reset to example"), so opening a project that already has overloaded
  // cargo doesn't itself fire the toast; only a NEW overload caused by the
  // user's own next action does.
  const prevOverloadedZoneCountRef = useRef(0)
  const { importInputRef, handleExportJson, handleImportFile, handleNewCalculation, handleNewCalculationForVessel, handleApplyVesselToCurrent } = useProjectActions({
    prevOverloadedZoneCountRef,
  })

  // Escape cancels lashing-point placement mode and/or an active manual-mode
  // cargo stamp — otherwise the only way to dismiss the drag preview "shadow"
  // was switching to auto mode and back.
  useEffect(() => {
    if (!placingLashingPoint && !placingPowerSocket && !placingAnnotation && !activeStampId && !drawingCustomShape && !pendingCustomShape && !editingDeckOutline && !drawingRestrictionShape && !drawingRestrictionZoneFreeform && !deckPhotoTool) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (deckPhotoTool) setDeckPhotoTool(null)
      if (placingLashingPoint) setPlacingLashingPoint(false)
      if (placingPowerSocket) setPlacingPowerSocket(false)
      if (placingAnnotation) setPlacingAnnotation(null)
      if (activeStampId) setActiveStamp(null)
      if (drawingCustomShape) useCalculator.getState().setDrawingCustomShape(false)
      if (pendingCustomShape) useCalculator.getState().setPendingCustomShape(null)
      if (editingDeckOutline) setEditingDeckOutline(false)
      if (drawingRestrictionShape) setDrawingRestrictionShape(null)
      if (drawingRestrictionZoneFreeform) setDrawingRestrictionZoneFreeform(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [placingLashingPoint, setPlacingLashingPoint, placingPowerSocket, setPlacingPowerSocket, placingAnnotation, setPlacingAnnotation, activeStampId, setActiveStamp, drawingCustomShape, pendingCustomShape, editingDeckOutline, setEditingDeckOutline, drawingRestrictionShape, setDrawingRestrictionShape, drawingRestrictionZoneFreeform, setDrawingRestrictionZoneFreeform, deckPhotoTool, setDeckPhotoTool])

  // R turns the cargo armed for click placement, as ↻ in the line over the
  // deck does (spec 7.1). KeyR is the same key in the Russian layout («К»).
  useEffect(() => {
    if (!activeStampId || workspace !== 'deck' || viewMode !== '2d') return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'KeyR' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
      const target = e.target instanceof Element ? e.target : null
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="combobox"], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return
      e.preventDefault()
      toggleStampRotation()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeStampId, workspace, viewMode, toggleStampRotation])

  // Hydrate projects from localStorage on mount (synchronous)
  useEffect(() => {
    hydrate()
  }, [hydrate])

  // The saved record turned out unreadable: projects.ts refuses every write
  // until the user decides, so say so for exactly as long as that holds — the
  // warning can't be dismissed, and goes away by itself once the record is
  // given up. The explanation and the buttons sit in `description` because
  // sonner's own action/cancel buttons share one row with the text, which
  // squeezed this message to a two-letter column and pushed the buttons
  // off-screen.
  const storageLocked = useProjects((s) => s.storageLocked)
  const discardCorruptedStorage = useProjects((s) => s.discardCorruptedStorage)
  useEffect(() => {
    if (!storageLocked) return
    const id = toast.error('Сохранённые данные повреждены и не читаются', {
      duration: Infinity,
      dismissible: false,
      closeButton: false,
      description: (
        <div className="space-y-2">
          <p>
            Чтобы их не потерять, приложение ничего не сохраняет, пока вы не решите, что с ними делать: работа идёт с
            демо-проектом в памяти и пропадёт при перезагрузке.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={downloadCorruptedStorage}>
              Скачать копию
            </Button>
            <Button size="sm" variant="destructive" onClick={discardCorruptedStorage}>
              Удалить и начать заново
            </Button>
          </div>
        </div>
      ),
    })
    return () => {
      toast.dismiss(id)
    }
  }, [storageLocked, discardCorruptedStorage])

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
      pinnedPlacementsByTrip: Object.fromEntries(
        Object.entries(proj.pinnedPlacementsByTrip ?? {}).map(([trip, list]) => [trip, list.map((p) => ({ ...p }))])
      ),
      separationRules: (proj.separationRules ?? []).map((r) => ({ ...r })),
      selectedPinIds: [],
      selectedAutoKeys: [],
      selectedManualIds: [],
      mode: proj.mode,
      sortStrategy: proj.sortStrategy,
      globalRotation: proj.globalRotation,
      showFreeSpace: proj.showFreeSpace,
      showGrid: proj.showGrid,
      showLabels: proj.showLabels,
      showCargoContents: proj.showCargoContents ?? true,
      activeStampId: null,
      stampRotated: false,
    })
    // A different project's undo history shouldn't leak into this one — an
    // Ctrl+Z right after switching would otherwise silently jump back to the
    // previous project's data instead of doing nothing.
    clearCalculatorHistory()
    prevOverloadedZoneCountRef.current = 0
    loadedProjectId.current = activeId

    // R29 (malformed-placement contract, corrected): a placement quarantined
    // by normalizeProject (no valid `composition` to trust — see
    // PinnedPlacement.malformed's own doc comment) is preserved in the
    // project's data and reported per-placement via the dedicated
    // `result.quarantined` channel (packDeck/packingResultFromManual) — a
    // deliberately separate channel from `result.unplaced` (see
    // QuarantinedPlacement's own doc comment for why reusing `unplaced`
    // would have been wrong). There's no dedicated UI surface for
    // `quarantined` yet, so this toast is the one load-time signal that
    // something in the file needed attention, reusing the existing toast
    // mechanism rather than building a new UI surface for what is expected
    // to be a rare, untrusted-input-only occurrence. Counted directly from
    // the loaded project's own store data (not from `result`, which isn't
    // computed yet at this point in the load sequence) — same
    // `malformed && !composition` predicate `packDeck`/
    // `packingResultFromManual` use to populate `quarantined`.
    const malformedCount =
      proj.manualPlacements.filter((m) => m.malformed && !m.composition).length +
      Object.values(proj.pinnedPlacementsByTrip ?? {})
        .flat()
        .filter((p) => p.malformed && !p.composition).length
    if (malformedCount > 0) {
      toast.warning(
        `В проекте «${proj.name}» ${malformedCount} груз(ов) с повреждёнными данными — физический состав не удалось определить при загрузке. Они не участвуют в расчётах, но не удалены из проекта.`
      )
    }
  }, [hydrated, activeId, projects])

  // Auto-save snapshot (debounced). The debounce timer itself lives in
  // src/store/projects.ts (scheduleAutosave/flushPendingAutosave), not as a
  // local setTimeout here — switchTo/deleteProject/createProject need to be
  // able to synchronously flush a pending save before they change
  // `activeId`, which a plain effect-owned timer can't offer them (an effect
  // cleanup keyed on `activeId` runs too late: in the same commit as, and
  // after, the project-load effect has already overwritten this store with
  // the NEW project's data — see scheduleAutosave's own comment for the full
  // trace). This was a real, reproducible data-loss bug: editing a field and
  // switching projects within 400ms silently dropped that edit.
  useEffect(() => {
    if (!activeId || loadedProjectId.current !== activeId) return
    scheduleAutosave(
      {
        id: activeId,
        deck,
        items: items.map((it) => ({ ...it })),
        manualPlacements: manualPlacements.map((m) => ({ ...m })),
        pinnedPlacementsByTrip: Object.fromEntries(
          Object.entries(pinnedPlacementsByTrip).map(([trip, list]) => [trip, list.map((p) => ({ ...p }))])
        ),
        separationRules: separationRules.map((r) => ({ ...r })),
        mode,
        sortStrategy,
        globalRotation,
        showFreeSpace,
        showGrid,
        showLabels,
        showCargoContents,
      },
      saveSnapshot
    )
  }, [activeId, deck, items, manualPlacements, pinnedPlacementsByTrip, separationRules, mode, sortStrategy, globalRotation, showFreeSpace, showGrid, showLabels, showCargoContents, saveSnapshot])

  const { activeTripIndex, setActiveTripIndex, trips, lastTrip, hasEmptyTrailingTrip, shownTrips, clampedTripIndex, result } = useTrips({
    mode,
    deck,
    items,
    manualPlacements,
    pinnedPlacementsByTrip,
    sortStrategy,
    globalRotation,
    separationRulesInUnit,
  })
  // Stacks of the open trip closer than a separation rule allows — the
  // check «Проверки» counts — drawn as a dashed line with «1.2 м из 3 м».
  const separationPairs = useMemo(
    () =>
      separationViolations(
        result.placed.map((pl) => ({ x: pl.x, y: pl.y, width: pl.width, length: pl.length, categories: placementCategorySet(pl, items) })),
        separationRulesInUnit
      ),
    [result.placed, items, separationRulesInUnit]
  )
  // Each trip's `unplaced` mixes units carried on to the next trip — what
  // trips are for, not a problem — with positions the packer rejected on
  // THIS trip. The red strip used to show all of it as «Не поместилось», so
  // cargo that simply went to trip 2 looked like a failure. Only the last
  // trip's shortfall is cargo that fits in no trip at all.
  const unfitAnywhere = mode === 'auto' ? lastTrip.unplaced.filter((u) => u.kind === 'shortfall') : []
  const unfitUnits = mode === 'auto' ? Math.max(0, lastTrip.requestedCount - lastTrip.placedCount) : 0
  const manualToDo = mode === 'manual' ? result.unplaced.filter((u) => u.kind === 'manual') : []
  // A locked position the packer can't use and a manual stack where it may
  // not stand are «Требуют внимания» in «Проверки» (A.12), with what can be
  // done about them; the red strip is for the cargo itself.
  const redStripCount = unfitAnywhere.length
  // Units entering the next trip are the ones it (or a later trip) will
  // place plus the unfit ones, which pass through every trip.
  const nextTrip = mode === 'auto' ? trips[clampedTripIndex + 1] : undefined
  const carriedToNextTrip = nextTrip ? Math.max(0, nextTrip.requestedCount - unfitUnits) : 0
  const unfitIds = new Set(unfitAnywhere.map((u) => u.itemId))
  const carryReasons =
    carriedToNextTrip > 0
      ? result.unplaced.filter((u) => u.kind === 'shortfall' && !unfitIds.has(u.itemId))
      : []
  const placedAcrossTrips = shownTrips.flatMap((t) => t.placed)
  const variantInputs = variantInputsOf(
    { deck, items, mode, manualPlacements, pinnedPlacementsByTrip, separationRules, globalRotation },
    activeId,
    clampedTripIndex
  )
  const variants =
    variantsSnapshot.builtFor.length === variantInputs.length &&
    variantsSnapshot.builtFor.every((v, i) => Object.is(v, variantInputs[i]))
      ? variantsSnapshot.list
      : []
  const appliedVariant = variants.length > 0 ? variantsSnapshot.applied : undefined
  // Pins for the currently-open trip only — each trip is its own deck instance.
  const pinnedPlacements = pinnedPlacementsByTrip[clampedTripIndex] ?? []
  // Stacks whose lashing falls short — the amber chain on the deck (6.3).
  const lashingShortIds = useMemo(
    () =>
      new Set(
        (mode === 'manual' ? manualPlacements : (pinnedPlacementsByTrip[clampedTripIndex] ?? []))
          .filter((r) => lashingVerdict(r, deck, items) === 'short')
          .map((r) => r.id)
      ),
    [mode, manualPlacements, pinnedPlacementsByTrip, clampedTripIndex, deck, items]
  )
  // The one purely auto-placed stack selected on the deck (no pin yet), if
  // any. Keys and the sidebar's «Крепление груза» act on it like on a pin:
  // the first change pins it, locked, and applies there.
  const selectedAutoStack =
    mode === 'auto' && !selectedPinIds[0] && selectedAutoKeys.length === 1
      ? result.placed.find(
          (p) =>
            autoPlacementKey(p) === selectedAutoKeys[0] &&
            !pinnedPlacements.some((pin) => pin.itemId === p.itemId && Math.abs(pin.x - p.x) < 0.01 && Math.abs(pin.y - p.y) < 0.01)
        )
      : undefined

  // Resolve a lashing point's attached-placement id (pin id in auto mode,
  // manual placement id in manual mode) back to its cargo item type.
  const placementItemId = (placementId: string | undefined): string | undefined => {
    if (!placementId) return undefined
    return (
      pinnedPlacements.find((p) => p.id === placementId)?.itemId ??
      manualPlacements.find((m) => m.id === placementId)?.itemId
    )
  }

  // Warn (once) when moving/adding cargo or resizing a load zone pushes a
  // zone's AGGREGATE weight (every placement overlapping it, summed) over
  // its density limit. The overload is already shown on the deck itself
  // (red outline + "!" badge + hover tooltip on each affected box, see
  // DeckVisualization) — this toast is just a proactive nudge for the
  // moment it happens, so it isn't missed if the affected box is scrolled
  // out of view or the deck is busy. Only fires when the overloaded ZONE
  // count goes UP; fixing an overload (or just removing cargo) stays silent.
  useEffect(() => {
    const zones = deck.loadZones
    if (!zones || zones.length === 0) {
      prevOverloadedZoneCountRef.current = 0
      return
    }
    const placements = result.placed.map((p) => ({
      x: p.x,
      y: p.y,
      width: p.width,
      length: p.length,
      totalWeightKg: (p.weight ?? 0) * p.stackedCount,
    }))
    const overloadedZones = checkZoneLoads(placements, zones, deck.outline, deck.unit)
    if (overloadedZones.length > prevOverloadedZoneCountRef.current) {
      toast.warning(
        overloadedZones.length === 1
          ? 'Перегрузка: превышена нагрузка одной зоны'
          : `Перегрузка: превышена нагрузка ${overloadedZones.length} зон`
      )
    }
    prevOverloadedZoneCountRef.current = overloadedZones.length
  }, [result.placed, deck.loadZones, deck.outline, deck.unit])

  // Every load zone's LIVE density, exceeded or not — threaded into the
  // sidebar so a user setting up a zone limit can see the actual current
  // number (e.g. "0.11 из 1 т/м²") instead of only finding out something's
  // wrong via a red highlight on the deck. A zone with a big footprint can
  // easily absorb several tonnes without ever crossing a 1 т/м² limit —
  // correct density math, not a bug, but invisible without this readout.
  const zoneLoads = useMemo(() => {
    if (!deck.loadZones || deck.loadZones.length === 0) return []
    const placements = result.placed.map((p) => ({
      x: p.x,
      y: p.y,
      width: p.width,
      length: p.length,
      totalWeightKg: (p.weight ?? 0) * p.stackedCount,
    }))
    return computeZoneLoads(placements, deck.loadZones, deck.outline, deck.unit)
  }, [result.placed, deck.loadZones, deck.outline, deck.unit])

  const categoryByItemId = useMemo(
    () => new Map(items.map((it) => [it.id, it.category])),
    [items]
  )
  // Each cargo's number — its place in the list — on the deck, in 3D, in the
  // tables and in the PDF; its tone follows from it (spec 6.2, 9.2).
  const cargoNumberByItemId = useMemo(() => cargoNumbers(items), [items])

  // The cargo armed by «Поставить» or a choice in the catalogue (spec 7.1).
  const activeStamp = useMemo(() => {
    if (!activeStampId) return null
    const it = items.find((x) => x.id === activeStampId)
    if (!it) return null
    return { id: it.id, width: it.width, length: it.length, color: it.color, name: it.name, weight: it.weight, shape: it.shape, outline: it.outline }
  }, [activeStampId, items])

  // NOTE: deck-geometry changes (gap/boardOffset/width/length/clearance) no
  // longer trigger a repack here — that used to duplicate and silently
  // override the store's own reflow (useCalculator's `setDeck`), which
  // carefully keeps existing manual/pinned placements as close to their
  // user-chosen position as possible instead of discarding them. `setDeck`
  // is now the single source of truth for this; see calculator.ts.

  // The open trip by the booklet check, at departure and at arrival: the
  // stability workspace shows it, the status line (spec 8.3) and «Судно»
  // take its worse state, as «Проверки» judges it.
  const tripStability = useMemo(() => evaluateDeckTripStability(deck, result, items), [deck, result, items])
  const statusGm = useMemo(() => {
    if (!tripStability) return undefined
    const { worst } = tripStability
    return { valueM: worst.stability.GM_fluid, status: tripStability.verdict, estimated: worst.stability.extrapolated, state: worst.state }
  }, [tripStability])

  // «Отчёт» is ticked while the PDF downloaded in this tab still matches the
  // calculation (spec 5.3). The store replaces a slice whenever it changes, so
  // the references a download was made from tell whether anything changed since.
  const calculation = { items, deck, manualPlacements, pinnedPlacementsByTrip, separationRules, mode, sortStrategy, globalRotation }
  const [pdfMadeFrom, setPdfMadeFrom] = useState<typeof calculation | null>(null)
  const pdfUpToDate =
    pdfMadeFrom !== null && (Object.keys(calculation) as (keyof typeof calculation)[]).every((k) => pdfMadeFrom[k] === calculation[k])

  // Raw drawn points (deck-meter coords, click order) -> a normalized outline
  // whose bounding box starts at (0,0), which is what CargoItem.outline
  // expects. Handed to the store as `pendingCustomShape` so Sidebar can show
  // the name/weight finalize form; DeckVisualization stays "dumb" (it only
  // ever sees the armed boolean + this callback).
  const handleFinishDrawing = (points: { x: number; y: number }[]) => {
    useCalculator.getState().setDrawingCustomShape(false)
    if (points.length < 3) return
    const minX = Math.min(...points.map((p) => p.x))
    const minY = Math.min(...points.map((p) => p.y))
    const maxX = Math.max(...points.map((p) => p.x))
    const maxY = Math.max(...points.map((p) => p.y))
    setPendingCustomShape({
      outline: points.map((p) => ({ x: p.x - minX, y: p.y - minY })),
      width: maxX - minX,
      length: maxY - minY,
      x: minX,
      y: minY,
    })
    // Its name form is in «Грузы» → «Каталог» → «Фигуры».
    openSection('cargo')
  }

  // maxDeckCargoT is a hard limit in both AUTO and MANUAL (contract A). AUTO's
  // own pack-time check (packing.ts's runningTotalWeightKg) only bounds the
  // auto-packer's OWN placement loop — it starts its running total FROM
  // whatever's already pinned and never re-validates pins themselves, and it
  // plays no part at all in the interactive click/stamp/preset placement
  // paths below, which call pinFromPlaced directly. This used to be checked
  // only when mode === 'manual' at every call site, which is exactly why
  // clicking a stamp, arming a preset, or "+"-ing a pinned stack's layers in
  // AUTO could all silently blow past the limit — packDeck was never in the
  // loop for any of them. maxDeckCargoT is the vessel's own PER-TRIP capacity
  // (see DeckConfig.maxDeckCargoT), so AUTO checks only the
  // CURRENT trip's pins, matching how the weight-edit guard in updateItem
  // already treats separate trips independently.
  const wouldExceedMaxDeckCargo = (addedWeightKg: number): boolean =>
    wouldExceedDeckCapacity(
      mode === 'manual' ? manualPlacements : (pinnedPlacementsByTrip[clampedTripIndex] ?? []),
      addedWeightKg,
      deck.maxDeckCargoT,
      items
    )

  // Why a click can't put one more unit of this cargo on the deck at all —
  // wherever it lands: all of it is placed, or the deck's cargo limit is
  // reached. The click is refused with it, and the shadow under the cursor
  // turns red with it (spec 7.1).
  const stampRefusal = (itemId: string): { text: string; level: 'warning' | 'error' } | null => {
    // Scoped to THIS item, not a global sum across every
    // cargo type — an aggregate check let a fully-placed
    // item keep being over-placed by clicking its own
    // stamp, as long as some OTHER item's quantity still
    // had "room" in the total (e.g. item A qty 1 already
    // placed, item B qty 1 still unplaced: clicking A's
    // stamp again passed 1 >= 2 = false and placed a
    // second A anyway).
    const item = items.find((it) => it.id === itemId)
    const itemRequested = item?.quantity ?? 0
    // Round 23: composition-aware — placementLayersOfItem
    // (already the canonical primitive checkLayerChange
    // uses, see its own layersOfIdIn helper above) counts
    // only THIS itemId's own layers within each
    // placement, not the placement's flat total. A plain
    // `pin.itemId === itemId` filter-and-sum-whole-
    // layers (the pre-fix code) both MISSES a non-nominal
    // constituent (e.g. B inside a composed [A2,B3]
    // reports 0 here, letting the user silently
    // over-place B past its declared quantity) and
    // OVER-counts the nominal one (A would report the
    // full 5, wrongly blocking a legitimate further A
    // placement). For an uncomposed placement this keeps
    // the exact same `Math.max(1, layers)` defensive
    // floor the pre-fix code had (segmentsOf itself
    // applies no floor) — same branching idiom as
    // checkLayerChange's own layersOfIdIn, so the
    // uncomposed result is byte-identical to before.
    //
    // Round 29 corrective pass: same Tier-2 exclusion as
    // checkLayerChange's own layersOfIdIn — a malformed
    // placement's raw layers must never phantom-count
    // toward this gate either.
    const layersOfIdIn = (pl: { itemId: string; layers: number; composition?: CompositionSegment[]; malformed?: PinnedPlacement['malformed'] }) =>
      pl.malformed && !pl.composition ? 0 : pl.composition ? placementLayersOfItem(pl, itemId) : pl.itemId === itemId ? Math.max(1, pl.layers) : 0
    const itemPlaced =
      mode === 'manual'
        ? manualPlacements.reduce((s, m) => s + layersOfIdIn(m), 0)
        : Object.values(pinnedPlacementsByTrip)
            .flat()
            .reduce((s, pin) => s + layersOfIdIn(pin), 0)
    if (itemPlaced >= itemRequested) {
      return { text: `Все ${itemRequested} ед. груза «${item?.name ?? ''}» уже размещены — увеличьте «всего» в списке`, level: 'warning' }
    }
    if (wouldExceedMaxDeckCargo(item?.weight ?? 0)) {
      return { text: `Превышен лимит груза на палубе (${deck.maxDeckCargoT} т)`, level: 'error' }
    }
    return null
  }

  // Finalizes a drawn shape into a real CargoItem (reusing
  // addOrIncrementCargoFromTemplate, same as any other preset) and places one
  // instance right where it was drawn — mode-aware, mirroring onPlace's own
  // manual/auto branching below.
  const handlePlaceCustomShape = (name: string, weight?: number) => {
    if (!pendingCustomShape) return
    if (wouldExceedMaxDeckCargo(weight ?? 0)) {
      toast.error(`Превышен лимит груза на палубе (${deck.maxDeckCargoT} т)`)
      return
    }
    const itemId = addOrIncrementCargoFromTemplate({
      name,
      weight,
      shape: 'custom',
      outline: pendingCustomShape.outline,
      width: pendingCustomShape.width,
      length: pendingCustomShape.length,
    })
    const color = useCalculator.getState().items.find((it) => it.id === itemId)?.color ?? PALETTE[0]
    const placement = {
      id: uuid(),
      itemId,
      name,
      x: pendingCustomShape.x,
      y: pendingCustomShape.y,
      width: pendingCustomShape.width,
      length: pendingCustomShape.length,
      layers: 1,
      rotated: false,
      color,
      weight,
    }
    if (mode === 'manual') {
      useCalculator.getState().addManualPlacement(placement)
    } else {
      pinFromPlaced(clampedTripIndex, { ...placement, locked: true })
    }
    setPendingCustomShape(null)
  }

  const {
    rotationBlockReason,
    handleRotatePinned,
    handleRotateManual,
    pinAutoStack,
    actOnAutoStack,
    rotateAutoStack,
    patchAutoStack,
    checkStackHeight,
    checkLayerChange,
    handleLayerChangePinned,
    handleRemovePinned,
    removePinUnits,
    takeUnits,
    handleTogglePinLock,
    handleLayerChangeManual,
  } = usePlacementActions({
    clampedTripIndex,
    pinnedPlacements,
    result,
    usableOutline,
    selectedAutoStack,
    deckKeys: viewMode === '2d' && workspace === 'deck',
    wouldExceedMaxDeckCargo,
  })
  const { handleMergePinned, handleMergeManual, previewMerge } = useMergeActions({
    clampedTripIndex,
    pinnedPlacements,
    checkLayerChange,
    checkStackHeight,
  })
  const { modeSwitchPrompt, setModeSwitchPrompt, switchToManual, switchToAuto, handleModeChange } = useModeSwitch({
    mode,
    result,
    shownTrips,
    clampedTripIndex,
    activeTripIndex,
    manualPlacements,
    pinnedPlacements,
    pinnedPlacementsByTrip,
  })

  // «Отменить» in the toast after a layout is applied: one undo step.
  const undoVariant = { label: 'Отменить', onClick: () => undoCalculator() }

  // Generate several packing variants so the user can choose the best one.
  // Each click produces a fresh set (new seed) — repeated clicks give
  // different options, so this deliberately doesn't disable the button or
  // block re-clicks outright — only a short debounce window (below) to
  // collapse an accidental double/spam-click into one run instead of
  // stacking one duplicate toast + repack per click.
  const lastAutoRedistributeRef = useRef(0)
  const handleAutoRedistribute = () => {
    const now = Date.now()
    if (now - lastAutoRedistributeRef.current < 500) return
    lastAutoRedistributeRef.current = now
    const effectiveItems = globalRotation
      ? items
      : items.map((it) => ({ ...it, allowRotation: false }))
    // A clearance-zoned or lashing-attached placement (in the current
    // mode/trip) is an operational constraint, not just a position —
    // silently letting a full reshuffle relocate or drop it would defeat
    // the reason it was drawn. A LOCKED placement (auto mode's explicit
    // "Закрепить") is a deliberate, explicit request to protect a
    // position — the whole point of locking something is that
    // "Автораспределение" respects it instead of silently overriding it,
    // which used to be the case (locking had no effect on this button
    // whatsoever). All three are passed through as `pinned` (the only
    // mechanism packDeck has for "exclude this rectangle for everyone
    // else"), which freezes them at their exact position while everything
    // else — including any UNLOCKED item the user merely dragged around
    // earlier — still reshuffles normally. A lashing point's cornerX/
    // cornerY and the anchor's own x/y are only ever carried over by
    // translating them by the placement's own move delta
    // (remapLashingPointsForRedistribute) — that's a best-effort
    // geometric guess, not a guarantee the rigging still makes physical
    // sense afterward, so freezing the placement in place is what
    // actually keeps a lashing setup valid across a redistribute.
    const sourcePlacements: (ManualPlacement | PinnedPlacement)[] = mode === 'manual' ? manualPlacements : pinnedPlacements
    const isLocked = (p: ManualPlacement | PinnedPlacement) => 'locked' in p && !!p.locked
    const frozenPinned: PinnedPlacement[] = keptByVariants(sourcePlacements, deck.lashingPoints)
      .map((p) => ({
        id: p.id,
        itemId: p.itemId,
        name: p.name,
        x: p.x,
        y: p.y,
        width: p.width,
        length: p.length,
        layers: p.layers,
        rotated: p.rotated,
        color: p.color,
        weight: p.weight,
        clearanceMargin: p.clearanceMargin,
        locked: isLocked(p),
        // Round 20 — composition-only preservation. `p` is a raw stored
        // ManualPlacement/PinnedPlacement here — straight passthrough. This
        // pin is fed into packDeckVariants as PackOptions.pinned, whose own
        // pin-loop already copies `.composition` through into PlacedItem
        // verbatim (Round 14) — but only if it's still present on the pin
        // by the time it gets there, which it wasn't before this fix.
        composition: p.composition,
      }))
    // In auto mode an unlocked pin is the packer's own layout (an applied
    // variant, a mode switch), not something the user placed — re-arranging
    // it is what this button is for, so there's nothing to warn about. (The
    // old warning counted those internal pins, and every trip's, though
    // only this trip is repacked.) In manual mode every placement is the
    // user's own: say how many got re-arranged. What stays put is said in
    // the section before the click (keptByVariants).
    const frozenIds = new Set(frozenPinned.map((p) => p.id))
    const reshuffled =
      mode === 'manual' ? manualPlacements.filter((p) => !frozenIds.has(p.id) && !isQuarantined(p)).length : 0
    const newVariants = packDeckVariants(
      deck.width,
      deck.length,
      effectiveItems,
      {
        sortStrategy,
        gap: deck.gap,
        boardOffset: deck.boardOffset,
        clearance: deck.clearance,
        separationRules: separationRulesInUnit,
        outline: deck.outline,
        restrictionZones: deck.restrictionZones,
        pinned: frozenPinned,
        loadZones: deck.loadZones,
        unit: deck.unit,
        maxTotalWeightKg: deck.maxDeckCargoT !== undefined ? deck.maxDeckCargoT * 1000 : undefined,
      },
      3
    )
    if (newVariants.length === 0) return
    // The best one goes on the deck straight away: one click to a layout.
    applyVariant(newVariants[0])
    setVariantsSnapshot({ list: newVariants, builtFor: variantInputsAfterApply(), applied: 0 })
    const what = `Применён: ${newVariants[0].label} · ${newVariants[0].utilizationPct}%`
    if (reshuffled > 0) {
      toast.warning(`Ручные штабели (${reshuffled}) переставлены заново`, { description: what, action: undoVariant })
    } else {
      toast.success(what, { action: undoVariant })
    }
  }

  // Apply a chosen variant: in manual mode store as manual placements, in
  // auto mode pin every placement from the variant's own result.
  //
  // The auto-mode branch used to just clear pinnedPlacementsByTrip and rely
  // on the live `result` (packDeck re-run with whatever sortStrategy/globalRotation
  // the store currently holds) to redraw - but packDeckVariants generates
  // each variant with its OWN sort strategy plus a seeded shuffle
  // (mulberry32(baseSeed + variantIdx*1013), see packing.ts) that the live
  // recompute never reproduces. So picking a different variant just re-showed
  // whatever the default live packing already was, regardless of which
  // variant was clicked - "Вариант 2 — мелкие сначала" and "Вариант 1 — по
  // площади" looked identical because neither ever actually got applied.
  // Pinning the variant's own placements locks in exactly what was shown in
  // the preview, the same way switching manual -> auto mode already converts
  // placements into pins elsewhere in this file.

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
        clearanceMargin: p.clearanceMargin,
        // Round 20 — composition-only preservation, same reasoning as
        // handleModeChange's AUTO->MANUAL branch above (source is PlacedItem).
        composition: p.composition,
      }))
      const matches = matchLashingCarryover(s.manualPlacements, newManual)
      useCalculator.setState({
        manualPlacements: [...newManual, ...s.manualPlacements.filter(isQuarantined)],
        // Same fix as handleModeChange: don't wipe every trip's pins just
        // because a variant was applied while in manual mode — this had
        // nothing to do with any AUTO trip and shouldn't destroy them.
        pinnedPlacementsByTrip: { ...s.pinnedPlacementsByTrip, [clampedTripIndex]: [] },
        selectedPinIds: [],
        selectedAutoKeys: [],
      })
      useCalculator.getState().remapLashingPointsForRedistribute(matches)
    } else {
      const newPinned = variant.result.placed.map((p) => ({
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
        clearanceMargin: p.clearanceMargin,
        locked: p.locked,
        // Round 20 — composition-only preservation, same reasoning as
        // handleModeChange's MANUAL->AUTO branch above (source is PlacedItem).
        composition: p.composition,
      }))
      const matches = matchLashingCarryover(s.pinnedPlacementsByTrip[clampedTripIndex] ?? [], newPinned)
      useCalculator.setState({
        // Replace only the current trip's pins — same fix as
        // handleModeChange, this used to overwrite the whole map and
        // silently discard every other trip's pins.
        pinnedPlacementsByTrip: {
          ...s.pinnedPlacementsByTrip,
          [clampedTripIndex]: [...newPinned, ...(s.pinnedPlacementsByTrip[clampedTripIndex] ?? []).filter(isQuarantined)],
        },
        manualPlacements: [],
        selectedPinIds: [],
        selectedAutoKeys: [],
      })
      useCalculator.getState().remapLashingPointsForRedistribute(matches)
    }
  }
  // What the variants list is now kept with: the store as the variant left
  // it (its placements, and lashing points moved along with them).
  const variantInputsAfterApply = () => variantInputsOf(useCalculator.getState(), activeId, clampedTripIndex)

  const handleSelectVariant = (variant: PackVariant) => {
    applyVariant(variant)
    setVariantsSnapshot((prev) => ({ list: prev.list, builtFor: variantInputsAfterApply(), applied: prev.list.indexOf(variant) }))
    toast.success(`Применён: ${variant.label} · ${variant.utilizationPct}%`, { action: undoVariant })
  }

  // Esc goes back from the stability workspace to the deck, unless a field,
  // a dialog or a menu takes it.
  useEffect(() => {
    if (workspace !== 'stability') return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const target = e.target instanceof Element ? e.target : null
      if (target?.closest('input, textarea, select, [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]')) return
      setWorkspace('deck')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [workspace])

  // What «Требуют внимания» offers (spec 8.4), on the record a case is
  // about. Removing a stack or a pin says so with «Отменить».
  const handleCheckAction = (action: CheckAction) => {
    const s = useCalculator.getState()
    const undo = { label: 'Отменить', onClick: () => undoCalculator() }
    switch (action.kind) {
      case 'delete':
        if (s.mode === 'manual') s.removeManualPlacement(action.recordId)
        else s.removePinned(action.trip, action.recordId)
        toast.info('Штабель удалён', { action: undo })
        break
      case 'keep-makeup':
        // What the stack holds stays unknown; the user takes it as it is.
        if (s.mode === 'manual') s.updateManualPlacement(action.recordId, { legacyUnknownComposition: undefined })
        else s.updatePinned(action.trip, action.recordId, { legacyUnknownComposition: undefined })
        break
      case 'unpin':
        s.removePinned(action.trip, action.recordId)
        toast.info('Закрепление снято — груз встанет туда, где есть место', { action: undo })
        break
      case 'show':
        setActiveTripIndex(action.trip)
        useCalculator.setState(
          s.mode === 'manual'
            ? { selectedManualIds: [action.recordId], selectedPinIds: [], selectedAutoKeys: [] }
            : { selectedPinIds: [action.recordId], selectedManualIds: [], selectedAutoKeys: [] }
        )
        break
    }
  }

  // The whole plan's checks (spec 8.4), every trip: their ✕ and ⚠ in the
  // status line and on the «Проверки» tab, the list at the top of that
  // section.
  const planFacts = useMemo(
    () =>
      gatherPlanFacts({
        mode,
        trips: hasEmptyTrailingTrip ? trips.slice(0, -1) : trips,
        pinnedPlacementsByTrip,
        manualPlacements,
        items,
        deck,
        separationRules: separationRulesInUnit,
      }),
    [mode, trips, hasEmptyTrailingTrip, pinnedPlacementsByTrip, manualPlacements, items, deck, separationRulesInUnit]
  )
  const planChecks = useMemo(() => buildChecks(planFacts), [planFacts])
  // The check opened in «Проверки» (8.4): what it found, and its stacks at
  // fault lit up on the open trip's deck while the section is open.
  const openCheckDetails = useMemo(() => (openCheck ? checkDetails(planFacts, openCheck) : null), [planFacts, openCheck])
  const focusKeys = activeSection === 'checks' && openCheckDetails ? (openCheckDetails.stacks.get(clampedTripIndex) ?? null) : null

  // The plan for the vessel (spec 11): every trip, drawn from the
  // calculation — whatever the view, the trip on screen or the selection.
  const handleExportPdf = async () => {
    const projectName = projects.find((p) => p.id === activeId)?.name ?? 'DeckLoad'
    try {
      await exportPlanPdf({
        projectName,
        deck,
        items,
        mode,
        trips: shownTrips,
        manualPlacements,
        pinnedPlacementsByTrip,
        facts: planFacts,
        numbers: cargoNumberByItemId,
        date: new Date(),
      })
      setPdfMadeFrom(calculation)
      toast.success('PDF скачан')
    } catch {
      toast.error('Не удалось собрать PDF')
    }
  }

  // Esc closes the inspector by dropping the selection (spec 5.4). An armed
  // tool takes Esc first (above), and so do fields, dialogs and menus.
  const hasSelection = selectedPinIds.length + selectedAutoKeys.length + selectedManualIds.length > 0
  const toolArmed = !!(
    placingLashingPoint ||
    placingPowerSocket ||
    placingAnnotation ||
    activeStampId ||
    drawingCustomShape ||
    pendingCustomShape ||
    editingDeckOutline ||
    drawingRestrictionShape ||
    drawingRestrictionZoneFreeform ||
    deckPhotoTool
  )
  useEffect(() => {
    if (!hasSelection || toolArmed || workspace !== 'deck') return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const target = e.target instanceof Element ? e.target : null
      if (target?.closest('input, textarea, select, [role="dialog"], [role="alertdialog"], [role="menu"], [data-radix-popper-content-wrapper]')) return
      clearSelection()
      clearManualSelection()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [hasSelection, toolArmed, workspace, clearSelection, clearManualSelection])

  // The selection for the inspector, the mini-panel and the right-click menu
  // (spec 6.5, 6.6): one stack with its details and actions, or several with
  // the actions on all of them.
  const samePlace = (a: { itemId: string; x: number; y: number }, b: { itemId: string; x: number; y: number }) =>
    a.itemId === b.itemId && Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01
  const selectedPin =
    mode === 'auto' && selectedPinIds.length === 1 && selectedAutoKeys.length === 0
      ? pinnedPlacements.find((p) => p.id === selectedPinIds[0])
      : undefined
  const selectedManual =
    mode === 'manual' && selectedManualIds.length === 1 ? manualPlacements.find((m) => m.id === selectedManualIds[0]) : undefined
  const inspected = (() => {
    const record = selectedPin ?? selectedManual
    const placed = selectedManual
      ? result.placed.find((p) => manualPlacements[p.index]?.id === selectedManual.id)
      : selectedPin
        ? result.placed.find((p) => samePlace(p, selectedPin))
        : selectedAutoStack
    const source = record ?? placed
    if (!source) return undefined
    const kind: InspectedStack['kind'] = selectedManual ? 'manual' : selectedPin ? 'pin' : 'auto'
    const item = items.find((it) => it.id === source.itemId)
    const layers = Math.max(1, source.layers)
    // «+» adds one more of the stack's own cargo. Only the height (or the
    // cargo's «Ярусов» cap) makes it impossible: with every unit placed it
    // takes one off another stack, and the handler explains anything else.
    const ownLayers = record?.composition ? placementLayersOfItem(record, source.itemId) : layers
    const add = checkLayerChange(source.itemId, ownLayers, 1, record?.id)
    const addBlocked = ownLayers + 1 > add.maxPhys
    const addReason = item && !(item.height > 0) ? 'У груза не задана высота' : add.reason
    const unit = UNIT_LABEL[deck.unit]
    const rotateBlocked = rotationBlockReason(record ?? source)
    const stack: InspectedStack = {
      kind,
      name: source.name,
      number: cargoNumberByItemId.get(source.itemId),
      size: item
        ? `${fmtNumber(item.width)} × ${fmtNumber(item.length)} × ${fmtNumber(item.height)} ${unit}`
        : `${fmtNumber(source.width)} × ${fmtNumber(source.length)} ${unit}`,
      category: placementCategoryLabel(record ?? source, items),
      unitWeight: !record?.composition && item?.weight ? `${fmtNumber(item.weight)} кг` : undefined,
      stackWeight: `${fmtTonnes(record ? placementTotalWeightKg(record, items) : (source.weight ?? 0) * layers)} т`,
      layers,
      maxLayers: add.maxPhys,
      rotate: rotateBlocked ? { ok: false, reason: rotateBlocked } : { ok: true },
      addLayer: addBlocked ? { ok: false, reason: addReason } : { ok: true },
      removeLayer:
        layers > 1
          ? { ok: true }
          : { ok: false, reason: `Минимум 1 ярус — штабель убирается кнопкой «${kind === 'manual' ? 'Убрать с палубы' : 'Удалить'}»` },
      composition: record?.composition?.map((seg) => ({
        number: cargoNumberByItemId.get(seg.itemId),
        name: items.find((it) => it.id === seg.itemId)?.name ?? 'Неизвестный груз',
        layers: seg.layers,
      })),
      state: kind === 'manual' ? 'manual' : kind === 'auto' ? 'auto' : selectedPin?.locked ? 'locked' : 'layout',
      units: record ? placementTotalLayers(record) : layers,
      problems: stackProblems({ placed, record, trip: result, deck, items, separationRules: separationRulesInUnit }),
    }
    return { stack, anchor: placed ?? source }
  })()
  // Built here rather than inside the function above: an auto stack's
  // actions go through a ref (actOnAutoStack), and a function called during
  // render mustn't hold them.
  const inspectedActions: StackActions | undefined = !inspected
    ? undefined
    : selectedManual
      ? {
          rotate: () => handleRotateManual(selectedManual.id),
          addLayer: () => handleLayerChangeManual(selectedManual.id, 1),
          removeLayer: () => handleLayerChangeManual(selectedManual.id, -1),
          remove: () => {
            removeManualPlacement(selectedManual.id)
            clearManualSelection()
          },
        }
      : selectedPin
        ? {
            rotate: () => handleRotatePinned(selectedPin.id),
            addLayer: () => handleLayerChangePinned(selectedPin.id, 1),
            removeLayer: () => handleLayerChangePinned(selectedPin.id, -1),
            pin: () => handleTogglePinLock(selectedPin.id, true),
            unpin: () => removePinned(clampedTripIndex, selectedPin.id),
            remove: () => handleRemovePinned(selectedPin.id),
          }
        : selectedAutoStack
          ? {
              rotate: () => rotateAutoStack(selectedAutoStack),
              addLayer: () => actOnAutoStack(selectedAutoStack, { kind: 'layers', delta: 1 }),
              removeLayer: () => actOnAutoStack(selectedAutoStack, { kind: 'layers', delta: -1 }),
              pin: () => {
                pinAutoStack(selectedAutoStack)
              },
              remove: () => actOnAutoStack(selectedAutoStack, { kind: 'remove' }),
            }
          : undefined
  const selectionCount = mode === 'manual' ? selectedManualIds.length : selectedPinIds.length + selectedAutoKeys.length
  const inspectedSelection = ((): InspectedSelection | undefined => {
    if (selectionCount < 2) return undefined
    if (mode === 'manual') {
      const chosen = manualPlacements.filter((m) => selectedManualIds.includes(m.id))
      return {
        count: chosen.length,
        mode,
        units: chosen.reduce((sum, m) => sum + placementTotalLayers(m), 0),
        removeAll: () => {
          for (const m of chosen) removeManualPlacement(m.id)
          clearManualSelection()
          toast.info(`С палубы убрано штабелей: ${chosen.length}`)
        },
      }
    }
    const pins = pinnedPlacements.filter((p) => selectedPinIds.includes(p.id))
    const autos = result.placed.filter(
      (p) => selectedAutoKeys.includes(autoPlacementKey(p)) && !pinnedPlacements.some((pin) => samePlace(pin, p))
    )
    const units = pins.reduce((sum, p) => sum + placementTotalLayers(p), 0) + autos.reduce((sum, p) => sum + p.layers, 0)
    return {
      count: pins.length + autos.length,
      mode,
      units,
      pinAll:
        pins.some((p) => !p.locked) || autos.length > 0
          ? () => {
              for (const p of pins) if (!p.locked) handleTogglePinLock(p.id, true)
              const ids = [...pins.map((p) => p.id), ...autos.map((p) => pinAutoStack(p))]
              selectPins(ids)
            }
          : undefined,
      unpinAll:
        pins.length > 0
          ? () => {
              for (const p of pins) removePinned(clampedTripIndex, p.id)
            }
          : undefined,
      removeAll: () => {
        for (const p of pins) removePinUnits(p)
        for (const p of autos) takeUnits(p.itemId, p.layers)
        clearSelection()
        toast.info(`Удалено штабелей: ${pins.length + autos.length} (−${units} ед.)`)
      },
    }
  })()
  const closeInspector = () => {
    clearSelection()
    clearManualSelection()
  }

  const statusInput: StatusLineInput = {
    utilization: result.utilization,
    weightKg: result.totalWeight,
    maxDeckCargoT: deck.maxDeckCargoT,
    placedUnits: placedAcrossTrips.reduce((sum, p) => sum + p.stackedCount, 0),
    totalUnits: items.reduce((sum, it) => sum + Math.max(0, it.quantity), 0),
    tripCount: shownTrips.length,
    gm: statusGm,
    checks: planChecks,
  }
  const marks = sectionMarks({
    vesselTemplateId: deck.vesselTemplateId,
    deck: { width: deck.width, length: deck.length, unit: deck.unit },
    items,
    placedUnits: statusInput.placedUnits,
    checks: checkCounts(planChecks),
    pdfUpToDate,
  })

  // Until the visitor's real flags are readable, show neither the intro nor
  // the app: a plain surface in the app's own background colour, so a
  // returning visitor goes straight into the calculator without ever
  // requesting the intro video.
  if (!clientReady) {
    return <div className="h-screen bg-paper" aria-hidden />
  }

  if (!entered) {
    return <VideoIntro onEnter={handleEnterIntro} />
  }

  return (
    <div className="h-screen flex flex-col bg-paper overflow-hidden">
      <TopBar
        projectMenu={
          <ProjectMenu onOpenFile={() => importInputRef.current?.click()} onSaveFile={handleExportJson} onClear={handleNewCalculation} />
        }
        helpMenu={<HelpMenu onStartTour={handleShowTour} onShowIntro={handleReplayIntro} />}
        activeSection={activeSection}
        marks={marks}
        onSelectSection={openSection}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undoCalculator}
        onRedo={redoCalculator}
        mode={mode}
        onModeChange={handleModeChange}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onExportPdf={handleExportPdf}
      />
      <input ref={importInputRef} type="file" accept="application/json,.json" className="hidden" onChange={handleImportFile} />

      {/* Unplaced-cargo banner — sits outside the scrollable <main> (like the
          header) so it's visible the instant something doesn't fit, instead
          of requiring a scroll all the way down to the bottom of the
          Статистика card to discover it. */}
      {redStripCount > 0 && (
        <div className="shrink-0 border-b bg-red-50 dark:bg-red-950/30 px-4 py-2">
          <div className="flex items-start gap-2 flex-wrap">
            <span className="flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-400 shrink-0">
              <AlertTriangle className="h-3.5 w-3.5" />
              Не поместилось ({redStripCount}):
            </span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {unfitAnywhere.map((u, i) => {
                const where = trips.length >= 10 ? 'не помещается за 10 рейсов' : 'ни в один рейс'
                return (
                  <Badge
                    key={`unfit-${u.itemId}-${i}`}
                    variant="destructive"
                    className="text-xs font-normal"
                    title={`${where}: ${u.reason}`}
                  >
                    {u.name} — {where}: {u.reason}
                  </Badge>
                )
              })}
            </div>
          </div>
        </div>
      )}
      {manualToDo.length > 0 && (
        <div className="shrink-0 border-b bg-amber-50 dark:bg-amber-950/30 px-4 py-2">
          <div className="flex items-start gap-2 flex-wrap">
            <span className="text-xs font-medium text-amber-800 dark:text-amber-300 shrink-0">
              Ещё не размещено вручную:
            </span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {manualToDo.map((u, i) => (
                <Badge key={`todo-${u.itemId}-${i}`} variant="outline" className="text-xs font-normal">
                  {u.name} — {u.reason.replace(/^Не размещено вручную \((.*)\)$/, '$1')}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        <SectionPanel active={activeSection} collapsed={panelCollapsed} onCollapsedChange={changePanelCollapsed} onSelect={openSection}>
          {activeSection === 'vessel' && (
            <VesselSection
              onNewCalculationForVessel={handleNewCalculationForVessel}
              onApplyVesselToCurrent={handleApplyVesselToCurrent}
              zoneLoads={zoneLoads}
              stability={statusGm}
              hasVessel={!!deck.vessel}
              onOpenStability={() => setWorkspace('stability')}
            />
          )}
          {activeSection === 'cargo' && (
            <CargoSection
              onOpenTable={() => setCargoTableOpen(true)}
              placedAcrossTrips={placedAcrossTrips}
              hoveredItemId={hoveredItemId}
              onHover={handleHover}
              onPlaceCustomShape={handlePlaceCustomShape}
            />
          )}
          {activeSection === 'placement' && (
            <PlacementSection
              mode={mode}
              tripIndex={clampedTripIndex}
              result={result}
              trips={shownTrips}
              onSelectTrip={(i) => {
                setActiveTripIndex(i)
                clearSelection()
              }}
              carriedToNextTrip={carriedToNextTrip}
              hasCargo={items.some((it) => it.quantity >= 1)}
              onPickVariants={handleAutoRedistribute}
              variants={variants}
              appliedVariant={appliedVariant}
              onSelectVariant={handleSelectVariant}
            />
          )}
          {activeSection === 'checks' && (
            <ChecksSection
              checks={planChecks}
              openCheck={openCheck}
              openDetails={openCheckDetails}
              onToggleCheck={(id) => setOpenCheck((open) => (open === id ? null : id))}
              tripIndex={clampedTripIndex}
              onSelectTrip={(i) => {
                setActiveTripIndex(i)
                clearSelection()
              }}
              onOpenSection={openSection}
              onOpenStability={() => setWorkspace('stability')}
              onCheckAction={handleCheckAction}
            />
          )}
          {activeSection === 'report' && (
            <ReportSection hasCargo={items.some((it) => it.quantity >= 1)} onExportPdf={handleExportPdf} onSaveFile={handleExportJson} />
          )}
        </SectionPanel>

        <main className="flex-1 min-w-0 flex flex-col">
          {/* The trip tabs and the canvas tools; over the stability workspace
              only the tabs, when there is more than one trip. */}
          {(workspace === 'deck' || shownTrips.length > 1) && (
          <div className="flex min-h-11 items-center gap-2 px-4 pt-3">
            <TripTabs
              trips={shownTrips}
              activeIndex={clampedTripIndex}
              onSelect={(i) => {
                setActiveTripIndex(i)
                clearSelection()
              }}
            />
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {/* DeckVisualization puts its canvas tools here (spec 6.10). */}
              <div ref={setCanvasToolsEl} className="flex items-center" />
              {workspace === 'deck' && <ViewMenu />}
            </div>
          </div>
          )}
          {carriedToNextTrip > 0 && (
            <p className="px-4 pt-2 text-sm text-ink-2" data-testid="trip-carry-over">
              {carriedToNextTrip} ед. {pluralRu(carriedToNextTrip, 'уходит', 'уходят', 'уходят')} в рейс {clampedTripIndex + 2}
              {carryReasons.length > 0 && ` — ${carryReasons.map((u) => `${u.name}: ${u.reason}`).join('; ')}`}
            </p>
          )}
          {/* The 2D deck takes the whole area (spec 5.4). The 3D view sits in
              its middle while it fits, and scrolls from the top when it
              doesn't (auto margins, not justify-center). The stability
              workspace takes the deck's place. */}
          {workspace === 'stability' ? (
            <StabilityWorkspace
              evaluation={tripStability}
              trip={shownTrips.length > 1 ? { index: clampedTripIndex, count: shownTrips.length } : undefined}
              onClose={() => setWorkspace('deck')}
            />
          ) : (
          <div className="relative flex min-h-0 flex-1 flex-col">
          {activeStamp && viewMode === '2d' && (
            <StampHint name={activeStamp.name} onRotate={toggleStampRotation} onCancel={() => setActiveStamp(null)} />
          )}
          <div className="flex min-h-0 flex-1 flex-col overflow-auto px-4 py-3" data-tour="deck-view">
            <div className={viewMode === '3d' ? 'my-auto w-full' : 'min-h-0 w-full flex-1'}>
              {viewMode === '3d' ? (
                <Deck3DView
                  result={result}
                  cargoNumberByItemId={cargoNumberByItemId}
                  deckWidth={result.deckWidth}
                  deckLength={result.deckLength}
                  deckOutline={deck.outline}
                  mode={mode}
                  manualPlacements={manualPlacements}
                  pinnedPlacements={pinnedPlacements}
                  onSelectManual={toggleManualSelection}
                  onSelectPin={togglePinSelection}
                  onSelectAuto={(p, additive) => toggleAutoSelection(autoPlacementKey(p), additive)}
                  selection={{ pinIds: selectedPinIds, manualIds: selectedManualIds, autoKeys: selectedAutoKeys }}
                />
              ) : (
              <DeckVisualization
                toolbarContainer={canvasToolsEl}
                selectionTools={inspected && <MiniPanel stack={inspected.stack} actions={inspectedActions!} />}
                selectionAnchor={inspected?.anchor}
                selectionMenu={inspected && <StackMenuItems stack={inspected.stack} actions={inspectedActions!} />}
                // The inspector covers the deck area's right 320 px; its own
                // 16 px padding (px-4) is part of that.
                coveredRight={inspected || inspectedSelection ? INSPECTOR_WIDTH_PX - 16 : 0}
                deckForwardIsPositiveY={deck.deckForwardIsPositiveY ?? true}
                result={result}
                unit={deck.unit}
                gap={deck.gap}
                boardOffset={deck.boardOffset}
                showFreeSpace={showFreeSpace}
                showGrid={showGrid}
                showLabels={showLabels}
                showCargoContents={showCargoContents}
                backgroundImage={deck.backgroundImage}
                backgroundImageOpacity={deck.backgroundImageOpacity}
                backgroundImageRect={deck.backgroundImageRect}
                onSetBackgroundImage={setDeckBackgroundImage}
                photoTool={deckPhotoTool}
                onSetPhotoTool={setDeckPhotoTool}
                onSetBackgroundImageRect={setDeckBackgroundImageRect}
                deckOutline={deck.outline}
                editingDeckOutline={editingDeckOutline}
                onSetDeckOutline={(outline) => setDeck({ outline })}
                onSetEditingDeckOutline={setEditingDeckOutline}
                hoveredItemId={hoveredItemId}
                onHover={handleHover}
                mode={mode}
                activeStamp={activeStamp}
                stampRotated={stampRotated}
                stampBlocked={activeStamp ? (stampRefusal(activeStamp.id)?.text ?? null) : null}
                drawingCustomShape={drawingCustomShape}
                onFinishDrawing={handleFinishDrawing}
                pendingCustomShape={pendingCustomShape}
                onPlace={(p) => {
                  const refusal = stampRefusal(p.itemId)
                  if (refusal) {
                    if (refusal.level === 'error') toast.error(refusal.text)
                    else toast.warning(refusal.text)
                    return
                  }
                  if (mode === 'manual') {
                    useCalculator.getState().addManualPlacement(p)
                  } else {
                    pinFromPlaced(clampedTripIndex, { ...p, locked: true })
                  }
                }}
                onMoveManual={(id, x, y) => updateManualPlacement(id, { x, y })}
                onUpdateManualClearance={(id, margin) => updateManualPlacement(id, { clearanceMargin: margin })}
                onMergeManual={handleMergeManual}
                previewMerge={previewMerge}
                onDragChange={setStackDragging}
                manualPlacements={manualPlacements}
                pinnedPlacements={pinnedPlacements}
                selectedPinIds={selectedPinIds}
                selectedAutoKeys={selectedAutoKeys}
                onToggleAutoSelection={toggleAutoSelection}
                onPinPlaced={(p) => pinFromPlaced(clampedTripIndex, p)}
                onUpdatePinned={(id, x, y) => updatePinned(clampedTripIndex, id, { x, y })}
                onUpdatePinnedClearance={(id, margin) => updatePinned(clampedTripIndex, id, { clearanceMargin: margin })}
                onMergePinned={handleMergePinned}
                onTogglePinLock={handleTogglePinLock}
                onTogglePinSelection={togglePinSelection}
                onClearSelection={clearSelection}
                selectedManualIds={selectedManualIds}
                onToggleManualSelection={toggleManualSelection}
                onClearManualSelection={clearManualSelection}
                loadZones={deck.loadZones}
                lashingPoints={deck.lashingPoints}
                categoryByItemId={categoryByItemId}
                cargoNumberByItemId={cargoNumberByItemId}
                separationRules={separationRulesInUnit}
                separationPairs={separationPairs}
                lashingShortIds={lashingShortIds}
                focusKeys={focusKeys}
                placingLashingPoint={placingLashingPoint}
                onPlaceLashingPoint={(x, y, corner) => {
                  const count = (deck.lashingPoints?.length ?? 0) + 1
                  addLashingPoint({
                    x,
                    y,
                    label: `Точка ${count}`,
                    placementId: corner?.placementId,
                    itemId: corner ? placementItemId(corner.placementId) : undefined,
                    cornerX: corner?.cornerX,
                    cornerY: corner?.cornerY,
                    verticalAngleDeg: corner ? 45 : undefined,
                    mslKg: corner ? LASHING_DEVICES.chain_g80_10.mslKg : undefined,
                    deviceType: corner ? 'chain_g80_10' : undefined,
                  })
                  if (corner) toast.success('Крепление добавлено')
                }}
                onUpdateLashingPoint={updateLashingPoint}
                vesselMotion={deck.vesselMotion}
                onUpdateLoadZone={updateLoadZone}
                powerSockets={deck.powerSockets}
                placingPowerSocket={placingPowerSocket}
                onPlacePowerSocket={(x, y) => {
                  const count = (deck.powerSockets?.length ?? 0) + 1
                  addPowerSocket({ x, y, label: `Розетка ${count}` })
                }}
                onUpdatePowerSocket={updatePowerSocket}
                annotations={deck.annotations}
                placingAnnotation={placingAnnotation}
                onPlaceAnnotation={(x, y, leader) => {
                  if (!placingAnnotation) return
                  const defaultText: Record<typeof placingAnnotation.kind, string> = {
                    bow: 'Нос',
                    stern: 'Корма',
                    port: 'Лево борт',
                    starboard: 'Право борт',
                    note: '',
                  }
                  addAnnotation({
                    x,
                    y,
                    text: defaultText[placingAnnotation.kind],
                    kind: placingAnnotation.kind,
                    leaderX: leader?.x,
                    leaderY: leader?.y,
                  })
                  // The four orientation stamps are normally placed
                  // once each — auto-disarm so a second stray click
                  // doesn't drop a duplicate. A free "Заметка" stays
                  // armed so the user can drop several notes in a row,
                  // same as placingLashingPoint's "Готово" pattern.
                  if (placingAnnotation.kind !== 'note') setPlacingAnnotation(null)
                }}
                onUpdateAnnotation={updateAnnotation}
                restrictionZones={deck.restrictionZones}
                drawingRestrictionShape={drawingRestrictionShape}
                onAddRestrictionZone={addRestrictionZone}
                onUpdateRestrictionZone={updateRestrictionZone}
                onRemoveRestrictionZone={removeRestrictionZone}
                drawingRestrictionZoneFreeform={drawingRestrictionZoneFreeform}
                onSetDrawingRestrictionShape={setDrawingRestrictionShape}
                onSetDrawingRestrictionZoneFreeform={setDrawingRestrictionZoneFreeform}
              />
              )}
            </div>
          </div>
          {/* Over the right of the deck while stacks are selected (spec 5.4),
              after it in the tab order. */}
          {(inspected || inspectedSelection) && !stackDragging && (
            <Inspector
              stack={inspected?.stack}
              actions={inspectedActions}
              selection={inspectedSelection}
              lashing={<StackLashing autoStack={selectedAutoStack} onPatchAutoStack={patchAutoStack} />}
              onShowChecks={() => openSection('checks')}
              onClose={closeInspector}
            />
          )}
          </div>
          )}
          <StatusLine
            input={statusInput}
            onOpenSection={openSection}
            onOpenStability={() => setWorkspace('stability')}
            cargoTable={{ open: cargoTableOpen, onToggle: () => setCargoTableOpen((v) => !v) }}
          />
        </main>
      </div>
      {cargoTableOpen && (
        <CargoDrawer title="Таблица грузов" onClose={() => setCargoTableOpen(false)}>
          <CargoTable placedAcrossTrips={placedAcrossTrips} unit={deck.unit} hoveredItemId={hoveredItemId} onHover={handleHover} />
        </CargoDrawer>
      )}
      <ProductTour steps={TOUR_STEPS} active={tourActive} onClose={handleCloseTour} />
      <AlertDialog open={modeSwitchPrompt !== null} onOpenChange={(open) => { if (!open) setModeSwitchPrompt(null) }}>
        <AlertDialogContent>
          {modeSwitchPrompt?.to === 'auto' ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Перейти в авто-режим?</AlertDialogTitle>
                <AlertDialogDescription>
                  Как поступить с грузом, который вы расставили вручную? «Оставить позиции» — штабели
                  останутся на местах и будут закреплены, остальное расставится само. «Переразместить» —
                  весь груз расставится заново.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Отмена</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-background text-foreground border hover:bg-accent"
                  onClick={() => switchToAuto(false)}
                >
                  Переразместить
                </AlertDialogAction>
                <AlertDialogAction onClick={() => switchToAuto(true)}>Оставить позиции</AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : modeSwitchPrompt?.to === 'manual' ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Перейти в ручной режим?</AlertDialogTitle>
                <AlertDialogDescription>
                  В ручном режиме один рейс. На палубе останется рейс {clampedTripIndex + 1}, а{' '}
                  {modeSwitchPrompt.strandedUnits} ед. из других рейсов станут неразмещёнными, пока вы не
                  вернётесь в авто-режим.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Отмена</AlertDialogCancel>
                <AlertDialogAction onClick={switchToManual}>Перейти</AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
