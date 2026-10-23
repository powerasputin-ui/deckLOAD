'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import dynamic from 'next/dynamic'
import { flushSync } from 'react-dom'
import { v4 as uuid } from 'uuid'
import {
  AlertTriangle,
} from 'lucide-react'
import { useStore } from 'zustand'
import { Button } from '@/components/ui/button'
import { fmtNumber, fmtTonnes, pluralRu } from '@/lib/utils'
import { cargoNumbers } from '@/lib/cargoPalette'
import { Badge } from '@/components/ui/badge'
import { useCalculator, UNIT_LABEL, convertLength, clearCalculatorHistory, undoCalculator, redoCalculator, roundForDisplay, PALETTE, autoPlacementKey, DEMO_DECK } from '@/store/calculator'
import { useProjects, scheduleAutosave, downloadCorruptedStorage } from '@/store/projects'
import { vesselTemplateById, type VesselTemplate } from '@/lib/vesselTemplates'
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
  packMultiTrip,
  packingResultFromManual,
  rotatePlacementAnywhere,
  maxLayersFor,
  computeFreeRects,
  computeGridStep,
  clampToDeck,
  rectInsidePolygon,
  erodePolygon,
  withClearanceFootprint,
  collidesWithClearance,
  isPipeShape,
  pyramidSpreadAsClearance,
  addClearanceMargins,
  type ClearanceMargin,
  type CargoShape,
  lashingPointExclusionRects,
  restrictionZoneExclusions,
  checkZoneLoads,
  computeZoneLoads,
  LASHING_DEVICES,
  type ManualPlacement,
  type PinnedPlacement,
  type PackVariant,
  type PackingResult,
  type CompositionSegment,
  type CargoItem,
  stackHeightBudget,
  separationViolations,
  type PlacedItem,
} from '@/lib/packing'
import { placementLayersOfItem, placementPush, placementPop, placementTotalLayers, placementTotalWeightKg, segmentsOf, placementConcatComposition, stackHeight, exceedsHeightBudget, placementCategorySet } from '@/lib/placementComposition'
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
import { ReportSection } from '@/components/sections/ReportSection'
import { sectionMarks, type SectionId } from '@/lib/workflow'
import type { StatusLineInput } from '@/lib/statusLine'
import { buildChecks, checkCounts } from '@/lib/checks'
import { gatherPlanFacts, stackProblems } from '@/lib/planFacts'
import { Inspector, INSPECTOR_WIDTH_PX, type InspectedSelection, type InspectedStack, type StackActions } from '@/components/shell/Inspector'
import { MiniPanel, StackMenuItems } from '@/components/shell/MiniPanel'
import { buildLoadingConditionFromPlacements, computeStabilityResult, G_METACENTRIC_MIN_SAFE, type DeckShipFrame } from '@/lib/stability'
import { VideoIntro } from '@/components/intro/VideoIntro'
import { ProductTour, type TourStep } from '@/components/onboarding/ProductTour'
import { exportDeckPlanToPdf, buildLashingRequirementRows, lashingPlacementsForPlan } from '@/lib/exportPdf'
import { wouldExceedDeckCapacity } from '@/lib/cargoValidation'
import { toast } from 'sonner'

// Once a visitor clicks through the intro, this survives reloads/new tabs
// so the video doesn't replay every time they come back.
const INTRO_SEEN_KEY = 'deckload-intro-seen'

// Separate flag from INTRO_SEEN_KEY on purpose — the video intro and the
// interactive product tour are different first-run experiences (one is
// atmospheric/passive, the other walks the real working UI) with
// independent "seen" states: skipping the tour shouldn't require rewatching
// the video, and vice versa.
const TOUR_SEEN_KEY = 'deckload-tour-seen'

// Touching window.localStorage at all throws (SecurityError) when the browser
// blocks site data for this page — and the intro/tour flags are read during
// render, so an unguarded read used to replace the whole app with an error
// page. Without storage the flags simply aren't remembered between visits.
function readSeenFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}
function writeSeenFlag(key: string): void {
  try {
    window.localStorage.setItem(key, '1')
  } catch {
    // not remembered across visits — nothing else depends on it
  }
}

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

const getTourSeenSnapshot = () => readSeenFlag(TOUR_SEEN_KEY)
const getTourSeenServerSnapshot = () => false

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
    body: 'Грузы расставляются сами. Перетащите штабель, чтобы закрепить его, или выделите и правьте.',
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

// useSyncExternalStore (not useState+useEffect) to read this: it's the hook
// React designed exactly for "a value that lives outside React and may
// differ between the server-rendered snapshot and the real client value" —
// it renders `false` (getServerSnapshot) for the initial/server-matching
// pass with no hydration-mismatch warning, then transparently re-renders
// with the real localStorage value right after hydration. A plain
// useState+useEffect pair would need its own three-state dance (null while
// unchecked) to get the same guarantee, and calling setState directly
// inside the effect body trips react-hooks/set-state-in-effect.
const noopSubscribe = () => () => {}
const getIntroSeenSnapshot = () => readSeenFlag(INTRO_SEEN_KEY)
const getIntroSeenServerSnapshot = () => false

// A placement quarantined when its project was loaded (malformed, with no
// composition to fall back on — see PinnedPlacement.malformed) is never part
// of any result.placed. Every handler below that rebuilds a placement list
// from result.placed must carry these over untouched: the load-time toast
// promises they stay in the project and out of every calculation, and
// rebuilding used to delete them (or, manual -> auto, quietly un-quarantine
// them by dropping the flag).
const isQuarantined = (p: { malformed?: unknown; composition?: unknown }) => !!p.malformed && !p.composition

export default function Home() {
  // false for the server render AND the hydration pass that must match it,
  // true from the first real client render on. The two "seen" flags below
  // report `false` during that first pass no matter what localStorage says,
  // so on their own they can't tell "visitor hasn't seen it" from "haven't
  // been able to read it yet" — which made every returning visitor's HTML
  // start with the intro (poster + 3.5 MB video requested, then thrown away
  // on hydration) and, wherever `entered` was already true on that pass,
  // armed the product tour a second time.
  const clientReady = useSyncExternalStore(noopSubscribe, () => true, () => false)
  const introSeen = useSyncExternalStore(noopSubscribe, getIntroSeenSnapshot, getIntroSeenServerSnapshot)
  // A same-session "just clicked enter" flag — the snapshot above only
  // reflects localStorage from a PAST visit; localStorage.setItem in
  // handleEnterIntro doesn't itself trigger a re-render (noopSubscribe
  // never fires), so entering this session is tracked separately.
  const [justEntered, setJustEntered] = useState(false)
  // Clicking "DeckLoad" in the header replays the intro on demand — this
  // overrides both the localStorage "seen" flag and justEntered until the
  // visitor clicks/skips through the video again.
  const [replayIntro, setReplayIntro] = useState(false)
  // NEXT_PUBLIC_SKIP_INTRO is inlined as a constant at build time —
  // identical on server and client, so it's safe to read directly here.
  // Set ONLY in vitest.config.ts's test environment, so the unit suite
  // renders the calculator directly (the e2e suite seeds the "seen"
  // localStorage flags instead — see playwright.config.ts).
  const entered = !replayIntro && (process.env.NEXT_PUBLIC_SKIP_INTRO === '1' || introSeen || justEntered)
  const handleEnterIntro = () => {
    writeSeenFlag(INTRO_SEEN_KEY)
    setJustEntered(true)
    setReplayIntro(false)
  }
  const handleReplayIntro = () => setReplayIntro(true)
  const tourSeen = useSyncExternalStore(noopSubscribe, getTourSeenSnapshot, getTourSeenServerSnapshot)
  const [tourActive, setTourActive] = useState(false)
  // Auto-arm the tour once per mount as soon as we know both `entered` and
  // `tourSeen` for real. Deliberately NOT a "compare previous `entered`"
  // transition check (this file's usual pattern, e.g. PhotoCropDialog.tsx's
  // prevBitmap): that only fires on a false→true EDGE, which a returning
  // visitor who already has INTRO_SEEN_KEY set from a past visit (so
  // `entered` is already true on the very first render, no edge to catch)
  // would never cross — this simpler "haven't auto-triggered yet" guard
  // fires correctly whether `entered` starts true or becomes true later.
  const [tourAutoTriggered, setTourAutoTriggered] = useState(false)
  if (clientReady && entered && !tourSeen && !tourAutoTriggered) {
    setTourAutoTriggered(true)
    setTourActive(true)
  }
  const handleCloseTour = () => {
    writeSeenFlag(TOUR_SEEN_KEY)
    setTourActive(false)
  }
  const handleShowTour = () => setTourActive(true)
  const deckSvgRef = useRef<SVGSVGElement>(null)
  const canUndo = useStore(useCalculator.temporal, (s) => s.pastStates.length > 0)
  const canRedo = useStore(useCalculator.temporal, (s) => s.futureStates.length > 0)
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
  const setDeckBackgroundImageOpacity = useCalculator((s) => s.setDeckBackgroundImageOpacity)
  const setDeckBackgroundImageRect = useCalculator((s) => s.setDeckBackgroundImageRect)
  const mode = useCalculator((s) => s.mode)
  const manualPlacements = useCalculator((s) => s.manualPlacements)
  const updateManualPlacement = useCalculator((s) => s.updateManualPlacement)
  const removeManualPlacement = useCalculator((s) => s.removeManualPlacement)
  const activeStampId = useCalculator((s) => s.activeStampId)
  const setActiveStamp = useCalculator((s) => s.setActiveStamp)
  const pendingPresetStamp = useCalculator((s) => s.pendingPresetStamp)
  const addOrIncrementCargoFromTemplate = useCalculator((s) => s.addOrIncrementCargoFromTemplate)
  const drawingCustomShape = useCalculator((s) => s.drawingCustomShape)
  const pendingCustomShape = useCalculator((s) => s.pendingCustomShape)
  const setPendingCustomShape = useCalculator((s) => s.setPendingCustomShape)
  const editingDeckOutline = useCalculator((s) => s.editingDeckOutline)
  const setEditingDeckOutline = useCalculator((s) => s.setEditingDeckOutline)
  const stampRotated = useCalculator((s) => s.stampRotated)
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
  const getActiveProject = useProjects((s) => s.getActive)
  const importProject = useProjects((s) => s.importProject)
  const createProject = useProjects((s) => s.createProject)
  const importInputRef = useRef<HTMLInputElement>(null)

  const handleExportJson = () => {
    const active = getActiveProject()
    if (!active) {
      toast.error('Нет активного расчёта для экспорта')
      return
    }
    const json = JSON.stringify(active, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const slug = active.name.trim().toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'project'
    const date = new Date().toISOString().slice(0, 10)
    a.href = url
    a.download = `deckload-${slug}-${date}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    toast.success('Проект скачан')
  }

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      let parsed: unknown
      try {
        parsed = JSON.parse(String(reader.result))
      } catch {
        toast.error('Файл повреждён или это не JSON')
        return
      }
      const id = importProject(parsed)
      if (!id) {
        toast.error('Файл не похож на проект DeckLoad')
        return
      }
      toast.success('Проект импортирован')
    }
    reader.onerror = () => toast.error('Не удалось прочитать файл')
    reader.readAsText(file)
  }

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
  // Variants are a snapshot of one project's cargo on one trip. Applying one
  // after switching project or trip, or after editing the cargo or the deck,
  // used to write a stale layout over the current one — so they're kept
  // together with what they were built from and only shown while that still
  // matches (see `variants` below the trip clamp).
  const [variantsSnapshot, setVariantsSnapshot] = useState<{ list: PackVariant[]; builtFor: unknown[] }>({
    list: [],
    builtFor: [],
  })
  // A mode switch that would quietly change saved data asks first (Phase 0,
  // L5/L21) — see handleModeChange.
  const [modeSwitchPrompt, setModeSwitchPrompt] = useState<
    null | { to: 'auto' } | { to: 'manual'; strandedUnits: number }
  >(null)
  const [activeTripIndex, setActiveTripIndex] = useState(0)
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

  // Ctrl+Z / Ctrl+Y (and Ctrl+Shift+Z) for undo/redo of cargo & deck-layout
  // history. Skipped while focus is inside a text input/textarea/contentEditable
  // — those fields (width, weight, category, …) have their own native
  // browser undo stack, and hijacking Ctrl+Z there would fight it instead of
  // undoing whatever the user actually meant.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      const key = e.key.toLowerCase()
      if (key !== 'z' && key !== 'y') return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault()
        redoCalculator()
      } else if (key === 'z') {
        e.preventDefault()
        undoCalculator()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Escape cancels lashing-point placement mode and/or an active manual-mode
  // cargo stamp — otherwise the only way to dismiss the drag preview "shadow"
  // was switching to auto mode and back.
  useEffect(() => {
    if (!placingLashingPoint && !placingPowerSocket && !placingAnnotation && !activeStampId && !pendingPresetStamp && !drawingCustomShape && !pendingCustomShape && !editingDeckOutline && !drawingRestrictionShape && !drawingRestrictionZoneFreeform) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (placingLashingPoint) setPlacingLashingPoint(false)
      if (placingPowerSocket) setPlacingPowerSocket(false)
      if (placingAnnotation) setPlacingAnnotation(null)
      if (activeStampId) setActiveStamp(null)
      if (pendingPresetStamp) useCalculator.getState().setPendingPresetStamp(null)
      if (drawingCustomShape) useCalculator.getState().setDrawingCustomShape(false)
      if (pendingCustomShape) useCalculator.getState().setPendingCustomShape(null)
      if (editingDeckOutline) setEditingDeckOutline(false)
      if (drawingRestrictionShape) setDrawingRestrictionShape(null)
      if (drawingRestrictionZoneFreeform) setDrawingRestrictionZoneFreeform(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [placingLashingPoint, setPlacingLashingPoint, placingPowerSocket, setPlacingPowerSocket, placingAnnotation, setPlacingAnnotation, activeStampId, setActiveStamp, pendingPresetStamp, drawingCustomShape, pendingCustomShape, editingDeckOutline, setEditingDeckOutline, drawingRestrictionShape, setDrawingRestrictionShape, drawingRestrictionZoneFreeform, setDrawingRestrictionZoneFreeform])

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
      pendingPresetStamp: null,
      activePresetCategory: null,
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

  // In auto mode, cargo that doesn't fit in one voyage automatically spills
  // into additional trips (same deck, repeated) via packMultiTrip. Manual mode
  // stays single-trip — the user places cargo by hand on one deck at a time.
  const trips: PackingResult[] = useMemo(() => {
    if (mode === 'manual') {
      const totalRequested = items.reduce((s, it) => s + it.quantity, 0)
      // Standing cargo is rechecked against the deck as it is now (L14): a
      // new outline, a moved obstacle or a widened clearance zone used to
      // leave a stack where it may not stand, with nothing said.
      return [
        packingResultFromManual(deck.width, deck.length, manualPlacements, totalRequested, items, deck.clearance, deck.outline, {
          boardOffset: deck.boardOffset,
          gap: deck.gap,
          restrictionZones: deck.restrictionZones,
        }),
      ]
    }
    const effectiveItems = globalRotation
      ? items
      : items.map((it) => ({ ...it, allowRotation: false }))
    // Each trip is a separate deck instance — packMultiTrip applies the
    // matching trip's own pins (pinnedByTrip[tripIndex]) at every iteration,
    // so pinning/dragging cargo works identically on any trip, not just the first.
    return packMultiTrip(
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
        // Real, vessel-specific stowage limits — see PackOptions' own doc
        // comments in packing.ts for exactly how each is enforced (loadZones
        // soft-prefers a non-overloading position when one exists;
        // maxTotalWeightKg hard-stops once the vessel's own approved deck
        // capacity would be exceeded). Both are undefined/empty until a
        // vessel template with real limits has actually been applied.
        loadZones: deck.loadZones,
        unit: deck.unit,
        maxTotalWeightKg: deck.maxDeckCargoT !== undefined ? deck.maxDeckCargoT * 1000 : undefined,
      },
      10,
      pinnedPlacementsByTrip
    )
  }, [deck.width, deck.length, deck.gap, deck.boardOffset, deck.clearance, deck.outline, deck.restrictionZones, deck.loadZones, deck.unit, deck.maxDeckCargoT, items, sortStrategy, globalRotation, mode, manualPlacements, pinnedPlacementsByTrip, separationRulesInUnit])

  // Clamp (rather than store) the selected trip in range as the trip count
  // changes (e.g. cargo edited so fewer/more voyages are needed) — avoids a
  // setState-in-effect render cascade for something purely derived.
  // packMultiTrip also keeps the trip on which it stopped making progress:
  // with cargo that can't fit even an empty deck, that's a last tab with
  // nothing on it. It carries no cargo, so it isn't shown as a trip — its
  // shortfall still reports what fits nowhere (below).
  const lastTrip = trips[trips.length - 1]
  const hasEmptyTrailingTrip =
    mode === 'auto' &&
    trips.length > 1 &&
    lastTrip.placedCount === 0 &&
    (pinnedPlacementsByTrip[trips.length - 1] ?? []).length === 0
  const shownTrips = hasEmptyTrailingTrip ? trips.slice(0, -1) : trips
  const clampedTripIndex = Math.max(0, Math.min(activeTripIndex, shownTrips.length - 1))
  const result = shownTrips[clampedTripIndex] ?? shownTrips[0]
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
  // Only a position the user chose is worth a red alarm: a rejected layout
  // pin (left by an applied variant) just gets its units packed elsewhere.
  const rejectedPinsHere = result.unplaced.filter(
    (u) => u.kind === 'pin' && !!(pinnedPlacementsByTrip[clampedTripIndex] ?? []).find((p) => p.id === u.pinId)?.locked
  )
  const manualToDo = mode === 'manual' ? result.unplaced.filter((u) => u.kind === 'manual') : []
  // Manual stacks the deck changed under (see packingResultFromManual).
  const manualConflicts = mode === 'manual' ? result.placed.filter((p) => p.conflict) : []
  const redStripCount = unfitAnywhere.length + rejectedPinsHere.length + manualConflicts.length
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
  const variantInputs: unknown[] = [
    activeId,
    clampedTripIndex,
    items,
    deck.width,
    deck.length,
    deck.unit,
    deck.gap,
    deck.boardOffset,
    deck.clearance,
    deck.outline,
    deck.restrictionZones,
  ]
  const variants =
    variantsSnapshot.builtFor.length === variantInputs.length &&
    variantsSnapshot.builtFor.every((v, i) => Object.is(v, variantInputs[i]))
      ? variantsSnapshot.list
      : []
  // Pins for the currently-open trip only — each trip is its own deck instance.
  const pinnedPlacements = pinnedPlacementsByTrip[clampedTripIndex] ?? []
  // A library vessel whose sources disagree on deck strength, with no limit
  // picked yet (the choice sits in the sidebar's «Зоны нагрузки»).
  const deckStrengthPending =
    !!vesselTemplateById(deck.vesselTemplateId)?.limits?.deckStrengthTPerM2 && deck.deckStrengthChoiceTPerM2 === undefined
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

  const activeStamp = useMemo(() => {
    if (pendingPresetStamp) {
      return {
        id: '__pending-preset__',
        width: pendingPresetStamp.width ?? 2,
        length: pendingPresetStamp.length ?? 1.2,
        // Matches the color swatch shown on the preset row it was armed
        // from — the real item keeps this same color when created.
        color: pendingPresetStamp.color ?? PALETTE[items.length % PALETTE.length],
        name: pendingPresetStamp.name ?? 'Груз',
        weight: pendingPresetStamp.weight,
        shape: pendingPresetStamp.shape,
      }
    }
    if (!activeStampId) return null
    const it = items.find((x) => x.id === activeStampId)
    if (!it) return null
    return { id: it.id, width: it.width, length: it.length, color: it.color, name: it.name, weight: it.weight, shape: it.shape }
  }, [activeStampId, pendingPresetStamp, items])

  // NOTE: deck-geometry changes (gap/boardOffset/width/length/clearance) no
  // longer trigger a repack here — that used to duplicate and silently
  // override the store's own reflow (useCalculator's `setDeck`), which
  // carefully keeps existing manual/pinned placements as close to their
  // user-chosen position as possible instead of discarding them. `setDeck`
  // is now the single source of truth for this; see calculator.ts.

  // The 2D deck's <svg>, once mounted — right away when it already is, a few
  // frames after leaving 3D otherwise. Gives up after ~3 s so a deck that
  // never mounts can't hang the export.
  const waitForDeckSvg = () =>
    new Promise<SVGSVGElement | null>((resolve) => {
      const started = performance.now()
      const poll = () => {
        if (deckSvgRef.current) return resolve(deckSvgRef.current)
        if (performance.now() - started > 3000) return resolve(null)
        requestAnimationFrame(poll)
      }
      poll()
    })

  // «Отчёт» is ticked while the PDF downloaded in this tab still matches the
  // calculation (spec 5.3). The store replaces a slice whenever it changes, so
  // the references a download was made from tell whether anything changed since.
  const calculation = { items, deck, manualPlacements, pinnedPlacementsByTrip, separationRules, mode, sortStrategy, globalRotation }
  const [pdfMadeFrom, setPdfMadeFrom] = useState<typeof calculation | null>(null)
  const pdfUpToDate =
    pdfMadeFrom !== null && (Object.keys(calculation) as (keyof typeof calculation)[]).every((k) => pdfMadeFrom[k] === calculation[k])

  // The PDF gets the deck as drawn for print — light colours whatever the
  // theme, the whole deck, labels sized for paper (DeckVisualization's
  // printMode). It is switched on only for the moment of copying the SVG:
  // flushSync renders it, the copy is taken, flushSync switches it back, all
  // before the browser paints, so the screen never shows it.
  const [deckPrintMode, setDeckPrintMode] = useState(false)
  const copyDeckForPrint = (svgEl: SVGSVGElement): SVGSVGElement => {
    flushSync(() => setDeckPrintMode(true))
    const copy = svgEl.cloneNode(true) as SVGSVGElement
    flushSync(() => setDeckPrintMode(false))
    return copy
  }

  const handleExportPdf = async () => {
    // The plan is rasterized from the 2D <svg>, which doesn't exist in 3D —
    // exporting from 3D used to fail with «Схема палубы ещё не готова».
    // Switch to 2D for the export and come back afterwards.
    const from3d = viewMode === '3d'
    if (from3d) setViewMode('2d')
    const svgEl = await waitForDeckSvg()
    if (!svgEl) {
      if (from3d) setViewMode('3d')
      toast.error('Схема палубы ещё не готова')
      return
    }
    const projectName = projects.find((p) => p.id === activeId)?.name ?? 'DeckLoad'
    const points = deck.lashingPoints ?? []
    // Mode-scoped: pins left over from an earlier auto session are not part
    // of a manual plan. In auto mode every stack placed in any trip counts,
    // pinned or not (see lashingPlacementsForPlan).
    const allPlacements = lashingPlacementsForPlan(mode, manualPlacements, shownTrips, pinnedPlacementsByTrip)
    // Round 19: composition-aware, per-segment row expansion — see
    // buildLashingRequirementRows's own doc comment (exportPdf.ts) for the
    // full contract. Pulled out as its own pure function specifically so it
    // can be unit-tested without jsPDF/canvas.
    const { rows: lashingRequirements, dangerousGoodsNames } = buildLashingRequirementRows(allPlacements, items, points)
    const trip = mode === 'auto' && shownTrips.length > 1 ? { index: clampedTripIndex, count: shownTrips.length } : undefined
    try {
      await exportDeckPlanToPdf({ svgEl: copyDeckForPrint(svgEl), deck, unit: deck.unit, result, projectName, lashingRequirements, dangerousGoodsNames, trip, cargoNumberByItemId })
      setPdfMadeFrom(calculation)
      toast.success('PDF скачан')
    } catch {
      toast.error('Не удалось собрать PDF')
    } finally {
      if (from3d) setViewMode('3d')
    }
  }

  const handleNewCalculation = () => {
    useCalculator.setState({
      deck: { ...DEMO_DECK },
      items: [],
      manualPlacements: [],
      pinnedPlacementsByTrip: {},
      separationRules: [],
      selectedPinIds: [],
      selectedAutoKeys: [],
      selectedManualIds: [],
      mode: 'auto',
      activeStampId: null,
      pendingPresetStamp: null,
      activePresetCategory: null,
      stampRotated: false,
    })
    clearCalculatorHistory()
    prevOverloadedZoneCountRef.current = 0
    toast.success('Текущий расчёт очищен')
  }

  // "Судно" header button — creates a fresh calculation with a real
  // vessel's deck size + stability data (lightship/hydrostatics/tanks)
  // already filled in. Cargo is deliberately left empty; see
  // src/lib/vesselTemplates.ts for exactly which fields are real vs.
  // estimated for each vessel.
  //
  // Writes go through saveSnapshot (the PROJECT'S own persisted data),
  // never useCalculator.setState directly — createProject() switches
  // activeId, which schedules the "load project into calculator" effect
  // above (~line 332) to run on the next commit and overwrite the
  // calculator store from projects.find(activeId)'s CURRENT data. Calling
  // useCalculator.setState synchronously here would just get clobbered by
  // that effect a moment later (confirmed live — vessel came back
  // undefined). Updating the project itself first means the load effect
  // picks up the vessel data on its own, instead of fighting it.
  const handleApplyVesselTemplate = (tpl: VesselTemplate) => {
    const newId = createProject(tpl.label)
    saveSnapshot({
      id: newId,
      deck: {
        width: tpl.deck.width,
        length: tpl.deck.length,
        unit: 'm',
        gap: 0.1,
        boardOffset: 0.2,
        // Seed the deck-wide stack-height budget from the vessel's own
        // approved limit (e.g. 3.0 m for a pipe stack, ДВТК п. 2.1.2) — the
        // number was already shown in the picker as a promise, so applying
        // the template must actually make it bind, not just display it.
        clearance: tpl.limits?.maxStackHeightM ?? 0,
        // Same reasoning as clearance above — the picker already shows
        // "груз до N т" as a promise; without binding it here, the app can
        // silently let a user load far past the vessel's own approved
        // total-deck-cargo capacity with zero warning (this WAS the case —
        // maxDeckCargoT existed only as picker text, never checked).
        maxDeckCargoT: tpl.limits?.maxDeckCargoT,
        tenFootContainerCapacity: tpl.limits?.tenFootContainerCapacity,
        vessel: tpl.vessel,
        shipFrame: tpl.shipFrame,
        deckForwardIsPositiveY: tpl.deckForwardIsPositiveY,
        // A non-rectangular real deck silhouette (digitized from a GA
        // drawing) and its real obstacles (hatches, moon pool, etc.) —
        // same "bind the promise, don't just display it" reasoning as
        // clearance/maxDeckCargoT above. Both undefined for a template
        // with only a plain rectangular deck (e.g. Kuznetsov).
        outline: tpl.deck.outline,
        restrictionZones: tpl.restrictionZones,
        // Remembered, so the deck-strength choice (Sidebar «Зоны нагрузки»)
        // knows which vessel's sources to offer, also after a reload.
        vesselTemplateId: tpl.id,
      },
      items: [],
      manualPlacements: [],
      pinnedPlacementsByTrip: {},
      separationRules: [],
      mode: 'auto',
      sortStrategy: 'area-desc',
      globalRotation: true,
      showFreeSpace: true,
      showGrid: true,
      showLabels: true,
      showCargoContents: true,
    })
    toast.success(`Создан расчёт для «${tpl.label}»`)
    // A vessel whose sources disagree on deck strength gets no limit picked
    // for it: the choice waits in «Зоны нагрузки» (opened by itself) and the
    // stats say «лимит не выбран» until it's made. It used to be a toast
    // that vanished after 20 seconds, leaving no limit and no reminder.
  }

  // Shared by handleRotatePinned/handleRotateManual below — these two were
  // ~50 lines of near-identical logic each (build `others`, call
  // rotatePlacementAnywhere, re-check rectInsidePolygon, build
  // preciseOthers, call collidesWithClearance), differing only in which
  // store list/updater they touch. A future fix to the rotation-collision
  // logic (e.g. the own-zone-after-rotation check documented below) had to
  // be applied to both copies by hand, with nothing enforcing they stay
  // identical — this collapses them into one implementation.
  const attemptRotate = (
    self: { itemId: string; name: string; x: number; y: number; width: number; length: number; layers: number; rotated: boolean; clearanceMargin?: ClearanceMargin; rotationLocked?: boolean; composition?: CompositionSegment[] },
    siblings: { x: number; y: number; width: number; length: number; clearanceMargin?: ClearanceMargin }[],
    excludeFromResultPlaced: (p: (typeof result.placed)[number]) => boolean,
    commit: (patch: { x: number; y: number; width: number; length: number; rotated: boolean }) => void
  ): void => {
    // rotationLocked (set by a cross-item merge whose dragged item didn't
    // allow rotation) wins even if the placement's own itemId's CargoItem
    // currently allows it — the merge may have folded in units that don't.
    //
    // Round 29 corrective pass: `rotationLocked` alone is NOT proven
    // authoritative for every composed placement — it's correctly
    // maintained by every LIVE creation path (merge/`+`/`-`/removeItem),
    // but hydration only type-checks it (`typeof pin.rotationLocked ===
    // 'boolean'`), never re-derives it from the loaded `composition` +
    // current catalog `allowRotation`. An imported/hand-edited project can
    // carry a composed placement whose `rotationLocked` is stale or absent
    // even though a real constituent disallows rotation — trusting
    // `rotationLocked` alone there would wrongly ALLOW rotating cargo that
    // shouldn't move. For a composed placement, checked live from
    // `composition` + the current catalog (most-restrictive-wins across
    // every constituent, the same check planComposedMerge itself uses) —
    // `rotationLocked` is OR'd in on top, never replaced, so a lock already
    // set by a live merge can only stay at least as restrictive, never
    // become more permissive. An uncomposed placement keeps the exact
    // original single-item check (self.itemId is its own sole identity).
    const composedNonRotatable = self.composition
      ? segmentsOf(self as { itemId: string; layers: number; composition?: CompositionSegment[] }).some(
          (seg) => items.find((it) => it.id === seg.itemId)?.allowRotation === false
        )
      : false
    // Geometry (outline/shape/height, used below for the post-rotation
    // collision check) still needs SOME catalog item — falls back to the
    // first composition segment's own item when the nominal `itemId`
    // doesn't resolve (Tier-1: valid composition, broken nominal identity).
    // Every real composed placement's constituents share one physical
    // shape/footprint by construction (planComposedMerge's own pipe-shape/
    // dimension compatibility gate), so any constituent's own item is an
    // equally valid geometry source — never a guess about which one.
    const item =
      items.find((it) => it.id === self.itemId) ??
      (self.composition ? items.find((it) => it.id === self.composition![0].itemId) : undefined)
    if (self.rotationLocked || composedNonRotatable || (!self.composition && !item?.allowRotation)) {
      toast.warning(`Груз «${self.name}» не разрешает поворот`)
      return
    }
    if (!item) {
      // No catalog item at all could be resolved (composed placement whose
      // EVERY constituent is unknown — malformed.invalidComposition would
      // normally already exclude this placement from ever being rendered/
      // selectable, but this stays a safe, explicit fallback rather than
      // reading `undefined` fields below).
      toast.warning(`Груз «${self.name}» повреждён — поворот недоступен`)
      return
    }
    const lashingRects: { x: number; y: number; width: number; length: number; clearanceMargin?: ClearanceMargin }[] = lashingPointExclusionRects(deck.lashingPoints ?? [], deck.gap)
    const zoneRects = restrictionZoneExclusions(deck.restrictionZones ?? [])
    const others = [...siblings, ...lashingRects, ...zoneRects].map((p) => withClearanceFootprint(p))
    const rotated = rotatePlacementAnywhere(self, deck.width, deck.length, deck.boardOffset, deck.gap, others, usableOutline)
    if (!rotated) {
      toast.warning('Невозможно повернуть: нет места')
      return
    }
    if (usableOutline && !rectInsidePolygon(rotated, usableOutline)) {
      toast.warning('Невозможно повернуть: груз выйдет за пределы палубы')
      return
    }
    // rotatePlacementAnywhere above only inflates the OTHER side's clearance
    // zones — swapping width/length here can newly overlap a neighbour that
    // was clear before the rotation, if it's this placement's OWN zone
    // that's now in the way. Additive precision check for custom (possibly
    // concave) outlines too — rotatePlacementAnywhere is bbox-only and
    // unchanged; this only rejects a bbox-approved rotation that a real
    // outline-vs-outline check finds actually overlapping.
    const preciseOthers = [
      ...result.placed
        .filter((p) => !excludeFromResultPlaced(p))
        .map((p) => ({ x: p.x, y: p.y, width: p.width, length: p.length, rotated: p.rotated, outline: p.outline, clearanceMargin: p.clearanceMargin, shape: p.shape, height: p.height, stackedCount: p.stackedCount })),
      ...zoneRects,
    ]
    // The rotated placement's own footprint also needs pipe-pyramid
    // self-widening (see collidesWithClearance) so it can't rotate itself
    // right up against a neighbour closer than its own pyramid base allows.
    const target = { x: rotated.x, y: rotated.y, width: rotated.width, length: rotated.length, rotated: !self.rotated, outline: item.outline, clearanceMargin: self.clearanceMargin, shape: item.shape, height: item.height, stackedCount: self.layers }
    if (collidesWithClearance(target, preciseOthers, deck.gap)) {
      toast.warning('Невозможно повернуть: нет места')
      return
    }
    commit({ x: rotated.x, y: rotated.y, width: rotated.width, length: rotated.length, rotated: !self.rotated })
  }

  const handleRotatePinned = (id: string) => {
    const pin = pinnedPlacements.find((p) => p.id === id)
    if (!pin) return
    const siblings = pinnedPlacements
      .filter((p) => p.id !== id)
      .map((p) => ({ x: p.x, y: p.y, width: p.width, length: p.length, clearanceMargin: p.clearanceMargin }))
    attemptRotate(
      pin,
      siblings,
      (p) => p.itemId === pin.itemId && Math.abs(p.x - pin.x) < 0.01 && Math.abs(p.y - pin.y) < 0.01,
      // Rotating is the user's choice of how the stack sits — «Закреплён».
      (patch) => updatePinned(clampedTripIndex, id, { ...patch, locked: true })
    )
  }

  const handleRotateManual = (id: string) => {
    const mp = manualPlacements.find((m) => m.id === id)
    if (!mp) return
    const siblings = manualPlacements
      .filter((m) => m.id !== id)
      .map((m) => ({ x: m.x, y: m.y, width: m.width, length: m.length, clearanceMargin: m.clearanceMargin }))
    attemptRotate(
      mp,
      siblings,
      (p) => manualPlacements[p.index]?.id === id,
      (patch) => updateManualPlacement(id, patch)
    )
  }

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
  // (see StatsPanel's comment on this field), so AUTO checks only the
  // CURRENT trip's pins, matching how the weight-edit guard in updateItem
  // already treats separate trips independently.
  const wouldExceedMaxDeckCargo = (addedWeightKg: number): boolean =>
    wouldExceedDeckCapacity(
      mode === 'manual' ? manualPlacements : (pinnedPlacementsByTrip[clampedTripIndex] ?? []),
      addedWeightKg,
      deck.maxDeckCargoT,
      items
    )

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

  // Moves the selected placement a quarter grid step (arrow keys), with the
  // same edge, outline and collision checks as a drag. A pin moved this way
  // becomes «Закреплён».
  const nudgePlacement = (selectedId: string, dx: number, dy: number) => {
    const step = computeGridStep(deck.width, deck.length, deck.unit) / 4
    const placements = mode === 'manual' ? manualPlacements : pinnedPlacements
    const current = placements.find((p) => p.id === selectedId)
    if (!current) return
    const nudgedItem = items.find((it) => it.id === current.itemId)
    const target2 = {
      x: current.x + dx * step,
      y: current.y + dy * step,
      width: current.width,
      length: current.length,
    }
    // Clamp the WIDENED footprint (own clearanceMargin + a pipe pyramid's
    // own base-row spread) against the deck edge/board-offset, not just
    // the raw single-unit rect — otherwise a nudge can walk the raw rect
    // flush against the edge while the wider footprint actually drawn on
    // screen sticks out past it. Same reasoning as resolveSnappedDragPosition's
    // selfMargin handling.
    const nudgeMargin = addClearanceMargins(
      current.clearanceMargin,
      nudgedItem ? pyramidSpreadAsClearance(nudgedItem, current.layers) : undefined
    )
    const ml = nudgeMargin?.left ?? 0
    const mr = nudgeMargin?.right ?? 0
    const mt = nudgeMargin?.top ?? 0
    const mb = nudgeMargin?.bottom ?? 0
    const wideClamped = clampToDeck(
      { x: target2.x - ml, y: target2.y - mt, width: current.width + ml + mr, length: current.length + mt + mb },
      deck.width,
      deck.length,
      deck.boardOffset
    )
    const clamped = { x: wideClamped.x + ml, y: wideClamped.y + mt }
    if (
      usableOutline &&
      !rectInsidePolygon(
        { x: clamped.x - ml, y: clamped.y - mt, width: current.width + ml + mr, length: current.length + mt + mb },
        usableOutline
      )
    )
      return
    // Single check (bbox + outline + both-direction clearance margin) —
    // sourced from result.placed like the rotate handlers above, since
    // raw ManualPlacement/PinnedPlacement never carry outline data.
    type CollisionCandidate = { x: number; y: number; width: number; length: number; rotated?: boolean; outline?: { x: number; y: number }[]; clearanceMargin?: ClearanceMargin; shape?: CargoShape; height?: number; stackedCount?: number }
    const placedRects: CollisionCandidate[] =
      mode === 'manual'
        ? result.placed
            .filter((p) => manualPlacements[p.index]?.id !== selectedId)
            .map((p) => ({ x: p.x, y: p.y, width: p.width, length: p.length, rotated: p.rotated, outline: p.outline, clearanceMargin: p.clearanceMargin, shape: p.shape, height: p.height, stackedCount: p.stackedCount }))
        : result.placed
            .filter((p) => !(p.itemId === current.itemId && Math.abs(p.x - current.x) < 0.01 && Math.abs(p.y - current.y) < 0.01))
            .map((p) => ({ x: p.x, y: p.y, width: p.width, length: p.length, rotated: p.rotated, outline: p.outline, clearanceMargin: p.clearanceMargin, shape: p.shape, height: p.height, stackedCount: p.stackedCount }))
    const lashingRects3: CollisionCandidate[] = lashingPointExclusionRects(deck.lashingPoints ?? [], deck.gap)
    const zoneRects3: CollisionCandidate[] = restrictionZoneExclusions(deck.restrictionZones ?? [])
    const preciseOthers = [...placedRects, ...lashingRects3, ...zoneRects3]
    // Same pipe-pyramid self-widening as the rotate handlers above, so a
    // nudged pipe stack can't be walked closer to a neighbour than its
    // own pyramid base actually allows.
    const target3 = { x: clamped.x, y: clamped.y, width: current.width, length: current.length, rotated: current.rotated, outline: nudgedItem?.outline, clearanceMargin: current.clearanceMargin, shape: nudgedItem?.shape, height: nudgedItem?.height, stackedCount: current.layers }
    if (collidesWithClearance(target3, preciseOthers, deck.gap)) return
    if (mode === 'manual') updateManualPlacement(selectedId, { x: clamped.x, y: clamped.y })
    else updatePinned(clampedTripIndex, selectedId, { x: clamped.x, y: clamped.y, locked: true })
  }

  // Buttons and keys that change a purely auto-placed stack (see the store's
  // selectedAutoKeys) first pin it — locked, the change is the user's choice —
  // and then act on that pin. The handlers below read placements and the
  // packing result from this render, which doesn't have the new pin yet, so
  // the action waits for the render that does (runPendingPinAction).
  type PinAction = { kind: 'rotate' } | { kind: 'layers'; delta: number } | { kind: 'remove' } | { kind: 'nudge'; dx: number; dy: number }
  const pendingPinActionRef = useRef<{ id: string; action: PinAction } | null>(null)
  const pinAutoStack = (placed: PlacedItem) =>
    pinFromPlaced(clampedTripIndex, {
      itemId: placed.itemId,
      name: placed.name,
      x: placed.x,
      y: placed.y,
      width: placed.width,
      length: placed.length,
      layers: placed.layers,
      rotated: placed.rotated,
      color: placed.color,
      weight: placed.weight,
      locked: true,
    })
  const actOnAutoStack = (placed: PlacedItem, action: PinAction) => {
    pendingPinActionRef.current = { id: pinAutoStack(placed), action }
  }
  // A plain field patch (clearance zone, wire type…) needs no placement
  // lookups, so it lands on the new pin straight away.
  const patchAutoStack = (placed: PlacedItem, patch: Partial<PinnedPlacement>) => {
    updatePinned(clampedTripIndex, pinAutoStack(placed), patch)
  }

  // Arrow keys nudge the selected cargo item; Space rotates it — 2D only
  // (alongside its existing pointer-drag, as a keyboard alternative). The 3D
  // view stays camera-only (rotate/zoom), no keyboard-driven editing there.
  // Skipped while focus is inside a text input (same guard as the other two
  // keydown listeners above), and for Space on a focused button or control,
  // which the browser presses. Space anywhere else is swallowed even with
  // nothing selected, so the page doesn't scroll. Arrow keys are only swallowed while something is
  // selected (round 31 — with nothing to nudge they used to kill keyboard
  // scrolling), and nothing inside a dialog/popover/menu is touched. Which
  // item is selected is read fresh on every keypress rather than once when
  // the effect was set up, so selecting a new item takes effect immediately
  // without waiting for the effect to re-subscribe.
  // The latest handler, so the window listener below subscribes once per
  // view instead of on every render (it reads selection, placements and the
  // packing result, which change all the time).
  const deckKeyDownRef = useRef<(e: KeyboardEvent) => void>(() => {})
  useEffect(() => {
    deckKeyDownRef.current = (e: KeyboardEvent) => {
      // e.target is typed as HTMLElement by KeyboardEvent's declaration, but
      // at runtime it can be a non-Element EventTarget (document, window —
      // e.g. when nothing has focus, or on a synthetically dispatched
      // event), which has neither .tagName nor .getAttribute/.closest and
      // would throw. Guard with a real instanceof check instead of trusting
      // the type cast.
      const target = e.target instanceof Element ? e.target : null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target as HTMLElement | null)?.isContentEditable) return
      // Also stay out of the way of open dropdowns/comboboxes (deck unit,
      // packing strategy, etc.) — those use arrows/Space for their own
      // keyboard navigation (Radix's Select trigger has role="combobox",
      // its option list role="listbox") and would otherwise get hijacked by
      // this listener now that it's active outside the 3D view too.
      if (target?.getAttribute('role') === 'combobox' || target?.closest('[role="listbox"]')) return
      // Dialogs, popovers and menus own their keyboard too — Space/Enter on
      // their buttons, arrows between their items. Swallowing Space here made
      // every button inside them (e.g. "Отмена" in a confirmation) dead to
      // the keyboard.
      if (target?.closest('[role="dialog"], [role="alertdialog"], [role="menu"]')) return

      const isSpace = e.key === ' ' || e.code === 'Space'
      // A focused button or other control takes Space itself: the browser
      // presses it. Swallowing Space here made every toolbar button dead to
      // the keyboard (L9). A click on the deck moves focus off the toolbar,
      // so Space still rotates the selection after working on the deck.
      if (isSpace && target?.closest('button, a[href], [role="button"], [role="radio"], [role="checkbox"], [role="switch"], [role="tab"], summary')) return
      let dx = 0
      let dy = 0
      if (e.key === 'ArrowLeft') dx = -1
      else if (e.key === 'ArrowRight') dx = 1
      else if (e.key === 'ArrowUp') dy = -1
      else if (e.key === 'ArrowDown') dy = 1
      else if (!isSpace) return

      // A purely auto-placed stack selected (no pin yet): the key changes
      // it, so it's pinned first and the change follows (actOnAutoStack).
      if (selectedAutoStack) {
        e.preventDefault()
        actOnAutoStack(selectedAutoStack, isSpace ? { kind: 'rotate' } : { kind: 'nudge', dx, dy })
        return
      }

      const selectedId = mode === 'manual' ? selectedManualIds[0] : selectedPinIds[0]
      // An arrow key only means "nudge" when there is something to nudge —
      // with no selection it must keep scrolling the page like any other
      // arrow press. Space is swallowed regardless (see the comment above).
      if (!selectedId && !isSpace) return
      e.preventDefault()
      if (!selectedId) return

      if (isSpace) {
        if (mode === 'manual') handleRotateManual(selectedId)
        else handleRotatePinned(selectedId)
        return
      }

      nudgePlacement(selectedId, dx, dy)
    }
  })
  useEffect(() => {
    if (viewMode !== '2d') return
    const onKeyDown = (e: KeyboardEvent) => deckKeyDownRef.current(e)
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [viewMode])

  // A composed stack is ONE physical column: its total height has to fit the
  // whole-column budget (stackHeightBudget — the deck clearance and each
  // constituent's own maxStackHeightM), exactly as a single-item stack of the
  // same height must. checkLayerChange only ever sees one item's share, so a
  // merge of 8 + 8 pipes of 0.25 m used to stand 4 m tall under a 2 m
  // clearance (and "+" could grow a composed stack past it the same way).
  // The per-item «Ярусов» caps stay with checkLayerChange.
  const checkStackHeight = (segs: CompositionSegment[]): { ok: true } | { ok: false; reason: string } => {
    const constituents = [...new Set(segs.map((seg) => seg.itemId))]
      .map((id) => items.find((it) => it.id === id))
      .filter((it): it is CargoItem => !!it)
    const budget = stackHeightBudget(constituents, deck.clearance, deck.unit)
    const height = stackHeight(segs, items)
    if (!exceedsHeightBudget(height, budget)) return { ok: true }
    const unitLabel = UNIT_LABEL[deck.unit]
    return { ok: false, reason: `Выше предельной высоты: ${roundForDisplay(height)} ${unitLabel} из ${roundForDisplay(budget)} ${unitLabel}` }
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
    excludeIds?: string | string[],
    // Quantity the item is ABOUT to gain (the legacy cross-item merge moves the
    // dragged item's whole quantity into the target before this check can see
    // it) — added to item.quantity for the "already placed" budget below.
    extraQuantity = 0
  ): { ok: boolean; reason?: string; maxPhys: number } => {
    const excluded = new Set(excludeIds ? (Array.isArray(excludeIds) ? excludeIds : [excludeIds]) : [])
    const item = items.find((it) => it.id === itemId)
    if (!item) return { ok: false, reason: 'Груз не найден', maxPhys: 1 }
    const maxPhys = maxLayersFor(item, deck.clearance, deck.unit)
    const newLayers = currentLayers + delta
    if (newLayers < 1) return { ok: false, reason: 'Минимум 1 ярус', maxPhys }
    if (newLayers > maxPhys) {
      // Which limit binds (see maxLayersFor): without a height budget the
      // cargo's own «Ярусов» decides, one tier when it is 0; with one, the
      // «Ярусов» cap when it is the tighter, else the height. The reason is
      // shown by the inactive «+», so it names the field to change.
      const userCap = item.maxLayers && item.maxLayers > 0 ? Math.floor(item.maxLayers) : undefined
      const heightLimited = Number.isFinite(stackHeightBudget([item], deck.clearance, deck.unit))
      const reason = !heightLimited
        ? userCap
          ? `Не больше ${userCap} ${pluralRu(userCap, 'яруса', 'ярусов', 'ярусов')} — так задано в поле «Ярусов» у груза`
          : 'Один ярус: у груза «Ярусов» 0, а высота штабеля не задана — задайте «Ярусов» у груза или предельную высоту в «Судно» → «Палуба»'
        : userCap && userCap <= maxPhys
          ? `Превышен лимит ярусов для этого груза (${userCap}) — измените поле «Ярусов» в списке грузов`
          : 'Превышена предельная высота штабеля — увеличьте её в «Судно» → «Палуба», чтобы добавить ярус'
      return { ok: false, reason, maxPhys }
    }
    // Sum of layers across all placements of this item (excluding the one(s)
    // being changed) — across ALL trips, since the item's quantity is a single
    // shipment-wide budget, not per-trip.
    //
    // Round 15 (quantity scanning): scan each placement's composition for
    // THIS itemId's own layer count via placementLayersOfItem, rather than
    // filtering `placement.itemId === itemId` and summing the whole
    // placement — a composed placement can contain `itemId` as a
    // non-nominal constituent (missed by the old filter) or have `itemId`
    // as its nominal itemId while also containing other items (over-counted
    // by summing the whole placement). Exclusion (excludeIds — the
    // placement currently being edited) still applies at the placement
    // level first, unchanged. The uncomposed branch keeps the exact old
    // Math.max(1, ...) arithmetic, so this stays byte-identical for every
    // existing (uncomposed) placement.
    //
    // Round 29 corrective pass: a Tier-2 malformed placement (`malformed`
    // set, no valid `composition` to trust — see PinnedPlacement.malformed's
    // own doc comment) is excluded from `result.placed`/capacity, but this
    // scan reads the RAW store arrays directly, not `result.placed` — it
    // used to still phantom-count such a placement's raw, untrustworthy
    // `layers` toward this itemId's "already placed" sum (since its own
    // `itemId` is very often a genuinely valid one — the common
    // `malformed.invalidComposition` case), wrongly blocking the user from
    // placing more of an item that isn't actually visible anywhere on the
    // deck. Excluded here the same way it's excluded from packing.
    const layersOfIdIn = (p: { id: string; itemId: string; layers: number; composition?: CompositionSegment[]; malformed?: PinnedPlacement['malformed'] }) =>
      excluded.has(p.id) || (p.malformed && !p.composition) ? 0 : p.composition ? placementLayersOfItem(p, itemId) : p.itemId === itemId ? Math.max(1, p.layers) : 0
    const sumPlaced =
      Object.values(pinnedPlacementsByTrip)
        .flat()
        .reduce((s, p) => s + layersOfIdIn(p), 0) +
      manualPlacements.reduce((s, m) => s + layersOfIdIn(m), 0)
    const quantityBudget = item.quantity + extraQuantity
    if (sumPlaced + newLayers > quantityBudget) {
      return {
        ok: false,
        reason: `Все ${quantityBudget} ед. этого груза уже размещены — увеличьте количество в списке грузов`,
        maxPhys,
      }
    }
    return { ok: true, maxPhys }
  }

  // Find a collision-free spot on the open deck for one unpinned unit of an
  // item — tries unrotated first, then rotated (if allowed), picking the
  // first free rectangle it fits in.
  const findFreeSpotForItem = (
    item: { width: number; length: number; allowRotation?: boolean }
  ): { x: number; y: number; rotated: boolean } | null => {
    const freeRects = computeFreeRects(deck.width, deck.length, result.placed, deck.gap, deck.boardOffset, deck.outline)
    for (const r of freeRects) {
      const cellW = item.width + deck.gap
      const cellL = item.length + deck.gap
      if (cellW <= r.width && cellL <= r.height) {
        return { x: r.x + deck.gap / 2, y: r.y + deck.gap / 2, rotated: false }
      }
      if (item.allowRotation) {
        const cellWRot = item.length + deck.gap
        const cellLRot = item.width + deck.gap
        if (cellWRot <= r.width && cellLRot <= r.height) {
          return { x: r.x + deck.gap / 2, y: r.y + deck.gap / 2, rotated: true }
        }
      }
    }
    return null
  }

  // A unit taken off a stack with «−» stands on its own at the first free
  // spot instead of going back to the packer, which would stack it onto
  // another freed unit (a reported bug). In auto mode that takes a pin — a
  // locked one, so it's visible as «Закреплён» rather than a hidden pin.
  const standFreedUnit = (freedItemId: string, keepSelectedId: string) => {
    const item = items.find((it) => it.id === freedItemId)
    if (!item) return
    const spot = findFreeSpotForItem(item)
    if (!spot) return
    const unit = {
      itemId: item.id,
      name: item.name,
      x: spot.x,
      y: spot.y,
      width: spot.rotated ? item.length : item.width,
      length: spot.rotated ? item.width : item.length,
      layers: 1,
      rotated: spot.rotated,
      color: item.color,
      weight: item.weight,
    }
    if (mode === 'manual') {
      useCalculator.getState().addManualPlacement({ id: crypto.randomUUID(), ...unit })
      // Keep acting on the stack the user is clicking «−» on.
      useCalculator.setState({ selectedManualIds: [keepSelectedId] })
    } else {
      pinFromPlaced(clampedTripIndex, { ...unit, locked: true })
      useCalculator.setState({ selectedPinIds: [keepSelectedId], selectedAutoKeys: [] })
    }
  }

  const handleLayerChangePinned = (id: string, delta: number) => {
    const pin = pinnedPlacements.find((p) => p.id === id)
    if (!pin) return

    // Round 21: a composed placement's own `composition` array IS its
    // physical stack — "+"/"-" push/pop one unit on top of it directly,
    // instead of hunting for another placement to merge with (that's what
    // drag-merge/handleMergePinned is for, untouched here per C2's scope).
    // Still dormant in production: no real placement carries `composition`
    // until the merge switch-on round (24) — reachable today only via
    // hand-built composition literals in tests.
    if (pin.composition) {
      if (delta > 0) {
        // The unit "+" adds is one more of the placement's own NOMINAL
        // itemId (C2 contract) — its weight, not the composed placement's
        // own averaged `weight` field, is what genuinely adds to deck load.
        const nominalItem = items.find((it) => it.id === pin.itemId)
        if (wouldExceedMaxDeckCargo(nominalItem?.weight ?? 0)) {
          toast.error(`Превышен лимит груза на палубе (${deck.maxDeckCargoT} т)`)
          return
        }
        // checkLayerChange's own physical/quantity caps are keyed to a
        // single itemId's own layer count — pass the nominal itemId's
        // OWN count within this placement (composition-aware since Round
        // 15), not the placement's total layers across every constituent.
        const ownLayers = placementLayersOfItem(pin, pin.itemId)
        const check = checkLayerChange(pin.itemId, ownLayers, delta, id)
        if (!check.ok) {
          toast.warning(check.reason ?? 'Невозможно изменить ярусы')
          return
        }
        const composition = placementPush(pin.composition, pin.itemId, 1)
        const height = checkStackHeight(composition)
        if (!height.ok) {
          toast.warning(height.reason)
          return
        }
        const layers = placementTotalLayers({ itemId: pin.itemId, layers: 0, composition })
        // `weight` is stored PER-UNIT (existing convention) — divide the
        // composition's total back down.
        const weight = placementTotalWeightKg({ itemId: pin.itemId, layers, composition }, items) / Math.max(1, layers)
        updatePinned(clampedTripIndex, id, { composition, layers, weight, locked: true })
        return
      }
      const popped = placementPop(pin.composition)
      if (popped.remainingSingleton) {
        // Only one constituent left -> un-compose back to an ordinary
        // placement, identity transferring to the survivor (C2 contract).
        const singleton = popped.remainingSingleton
        const catalogItem = items.find((it) => it.id === singleton.itemId)
        updatePinned(clampedTripIndex, id, {
          composition: undefined,
          itemId: singleton.itemId,
          layers: singleton.layers,
          weight: catalogItem?.weight,
          locked: true,
        })
      } else if (popped.composition) {
        const composition = popped.composition
        const layers = placementTotalLayers({ itemId: pin.itemId, layers: 0, composition })
        const weight = placementTotalWeightKg({ itemId: pin.itemId, layers, composition }, items) / Math.max(1, layers)
        updatePinned(clampedTripIndex, id, { composition, layers, weight, locked: true })
      } else {
        // Defensive only: a composed placement always has >=2 segments, so
        // a single pop can never empty it. If it somehow does, fall back
        // to the existing safe full-removal path instead of leaving a
        // corrupt zero-layer placement on the deck.
        handleRemovePinned(id)
        return
      }
      // The unit that was physically on top (popped.freedItemId) may differ
      // from the placement's nominal itemId.
      standFreedUnit(popped.freedItemId, id)
      return
    }

    // «+» adds exactly one unit. It used to absorb a whole other stack of
    // this cargo, while its own tooltip promised one layer.
    const check = checkLayerChange(pin.itemId, pin.layers, delta, id)
    if (delta > 0) {
      if (check.ok) {
        // A unit the auto-packer placed elsewhere — or one that fit nowhere —
        // moves onto this stack. It only adds weight to this trip if no such
        // unit was already on it.
        const freeUnitOnThisTrip = result.placed.some(
          (p) =>
            p.itemId === pin.itemId &&
            !pinnedPlacements.some((pp) => pp.itemId === p.itemId && Math.abs(pp.x - p.x) < 0.01 && Math.abs(pp.y - p.y) < 0.01)
        )
        if (!freeUnitOnThisTrip && wouldExceedMaxDeckCargo(pin.weight ?? 0)) {
          toast.error(`Превышен лимит груза на палубе (${deck.maxDeckCargoT} т)`)
          return
        }
        updatePinned(clampedTripIndex, id, { layers: pin.layers + 1, locked: true })
        return
      }
      // Every unit is already in a placement: take one off the lowest other
      // stack of this cargo on this trip (same deck, so no weight change).
      const source =
        pin.layers + 1 <= check.maxPhys
          ? pinnedPlacements
              .filter((p) => p.id !== id && p.itemId === pin.itemId && !p.composition && !p.malformed)
              .sort((a, b) => a.layers - b.layers)[0]
          : undefined
      if (!source) {
        toast.warning(check.reason ?? 'Невозможно изменить ярусы')
        return
      }
      if (source.layers > 1) updatePinned(clampedTripIndex, source.id, { layers: source.layers - 1 })
      else removePinned(clampedTripIndex, source.id)
      updatePinned(clampedTripIndex, id, { layers: pin.layers + 1, locked: true })
      return
    }
    if (!check.ok) {
      toast.warning(check.reason ?? 'Невозможно изменить ярусы')
      return
    }
    updatePinned(clampedTripIndex, id, { layers: pin.layers - 1, locked: true })
    standFreedUnit(pin.itemId, id)
  }

  // Delete a pinned placement from the deck. Unlike unpinning, this also
  // decreases item.quantity by the placement's layer count — otherwise the
  // auto-packer would immediately re-place the freed unit elsewhere, making
  // the ✕ button look like it does nothing.
  //
  // Round 16: composition-aware — each constituent's OWN quantity is
  // decreased by its OWN physical layer count, never the nominal itemId's
  // quantity by the pin's full total (placement.itemId is never the sole
  // source of quantity — see the migration plan's Quantity contract). A
  // composition can contain the SAME itemId in more than one non-adjacent
  // segment (e.g. [A2,B3,A1]), so segments are aggregated per itemId first,
  // then applied once each. Dormant for an uncomposed pin: its implicit
  // one-segment "composition" degenerates to the exact old single update.
  const handleRemovePinned = (id: string) => {
    const pin = pinnedPlacements.find((p) => p.id === id)
    if (!pin) return
    removePinUnits(pin)
    toast.info(`Груз «${pin.name}» удалён (−${pin.layers} ед.)`)
  }
  // Drops the pin and takes its units off each cargo's quantity.
  const removePinUnits = (pin: PinnedPlacement) => {
    removePinned(clampedTripIndex, pin.id)
    const segments = pin.composition ?? [{ itemId: pin.itemId, layers: pin.layers }]
    const layersByItemId = new Map<string, number>()
    for (const seg of segments) {
      layersByItemId.set(seg.itemId, (layersByItemId.get(seg.itemId) ?? 0) + seg.layers)
    }
    for (const [itemId, removedLayers] of layersByItemId) takeUnits(itemId, removedLayers)
  }
  const takeUnits = (itemId: string, units: number) => {
    const currentItem = useCalculator.getState().items.find((it) => it.id === itemId)
    if (currentItem) {
      useCalculator.getState().updateItem(itemId, { quantity: Math.max(0, currentItem.quantity - units) })
    }
  }

  // Locks/unlocks a pinned placement — a locked one stops responding to
  // drag until unlocked via the deck's right-click menu. Purely a drag
  // gate: unlike handleRemovePinned, it never touches item.quantity or the
  // placement's existence.
  const handleTogglePinLock = (id: string, locked: boolean) => {
    updatePinned(clampedTripIndex, id, { locked })
  }

  const handleLayerChangeManual = (id: string, delta: number) => {
    const mp = manualPlacements.find((m) => m.id === id)
    if (!mp) return

    // Round 21: same composed push/pop wiring as handleLayerChangePinned
    // above — see its comment for the full rationale. Manual-mode
    // equivalent, using manualPlacements/updateManualPlacement/
    // addManualPlacement instead of the pinned-trip equivalents.
    if (mp.composition) {
      if (delta > 0) {
        const nominalItem = items.find((it) => it.id === mp.itemId)
        if (wouldExceedMaxDeckCargo(nominalItem?.weight ?? 0)) {
          toast.error(`Превышен лимит груза на палубе (${deck.maxDeckCargoT} т)`)
          return
        }
        const ownLayers = placementLayersOfItem(mp, mp.itemId)
        const check = checkLayerChange(mp.itemId, ownLayers, delta, id)
        if (!check.ok) {
          toast.warning(check.reason ?? 'Невозможно изменить ярусы')
          return
        }
        const composition = placementPush(mp.composition, mp.itemId, 1)
        const height = checkStackHeight(composition)
        if (!height.ok) {
          toast.warning(height.reason)
          return
        }
        const layers = placementTotalLayers({ itemId: mp.itemId, layers: 0, composition })
        const weight = placementTotalWeightKg({ itemId: mp.itemId, layers, composition }, items) / Math.max(1, layers)
        updateManualPlacement(id, { composition, layers, weight })
        return
      }
      const popped = placementPop(mp.composition)
      if (popped.remainingSingleton) {
        const singleton = popped.remainingSingleton
        const catalogItem = items.find((it) => it.id === singleton.itemId)
        updateManualPlacement(id, {
          composition: undefined,
          itemId: singleton.itemId,
          layers: singleton.layers,
          weight: catalogItem?.weight,
        })
      } else if (popped.composition) {
        const composition = popped.composition
        const layers = placementTotalLayers({ itemId: mp.itemId, layers: 0, composition })
        const weight = placementTotalWeightKg({ itemId: mp.itemId, layers, composition }, items) / Math.max(1, layers)
        updateManualPlacement(id, { composition, layers, weight })
      } else {
        // Defensive only, see handleLayerChangePinned's identical comment.
        removeManualPlacement(id)
        return
      }
      standFreedUnit(popped.freedItemId, id)
      return
    }

    const current = Math.max(1, mp.layers)

    // «+» adds exactly one unit: one not placed yet if there is one (that
    // adds weight to the deck), else one off the lowest other stack of this
    // cargo. It used to merge a whole other stack.
    const check = checkLayerChange(mp.itemId, current, delta, id)
    if (delta > 0) {
      if (check.ok) {
        if (wouldExceedMaxDeckCargo(mp.weight ?? 0)) {
          toast.error(`Превышен лимит груза на палубе (${deck.maxDeckCargoT} т)`)
          return
        }
        updateManualPlacement(id, { layers: current + 1 })
        return
      }
      const source =
        current + 1 <= check.maxPhys
          ? manualPlacements
              .filter((m) => m.id !== id && m.itemId === mp.itemId && !m.composition && !m.malformed)
              .sort((a, b) => Math.max(1, a.layers) - Math.max(1, b.layers))[0]
          : undefined
      if (!source) {
        toast.warning(check.reason ?? 'Невозможно изменить ярусы')
        return
      }
      if (Math.max(1, source.layers) > 1) updateManualPlacement(source.id, { layers: Math.max(1, source.layers) - 1 })
      else removeManualPlacement(source.id)
      updateManualPlacement(id, { layers: current + 1 })
      return
    }
    if (!check.ok) {
      toast.warning(check.reason ?? 'Невозможно изменить ярусы')
      return
    }
    updateManualPlacement(id, { layers: current - 1 })
    standFreedUnit(mp.itemId, id)
  }

  // Round 24 (merge switch-on): drag one placement onto another — target
  // absorbs the dragged one's ENTIRE physical composition via
  // placementConcatComposition, instead of the pre-Round-24 flat
  // mergedPlacementWeight/layers arithmetic that blended two different
  // items' weight into a single scalar and lost per-constituent identity
  // (the original Round 10 bug this whole migration exists to fix).
  // `composition` is the source of truth for the merge result; `layers`/
  // `weight` are DERIVED from it, never computed independently. The
  // target's itemId always survives as the nominal identity, regardless of
  // whether target or dragged was itself already composed.
  //
  // Quantity semantics — planComposedMerge itself never mutates catalog
  // quantity (it only VALIDATES it via checkLayerChange, exactly as `+`
  // does). Whether a merge ALSO moves catalog quantity between the two
  // items is a separate, narrower decision, split by whether composition is
  // actually involved — see legacyStandaloneCrossItemQuantityTransfer right
  // below this function for the full explanation and the exact boundary
  // (pure standalone cross-item merge that drains the dragged item: legacy
  // transfer, collapsed into the target; any other merge — partial, or with
  // a `composition` on either side: no transfer at all, on purpose). This
  // does not reinterpret
  // the Round 16 quantity-direction invariant (remove/unpin still decreases
  // quantity, never restores it) in either case.
  const planComposedMerge = (
    target: { id: string; itemId: string; layers: number; composition?: CompositionSegment[]; rotationLocked?: boolean },
    dragged: { id: string; itemId: string; layers: number; composition?: CompositionSegment[]; rotationLocked?: boolean }
  ):
    | { ok: true; composition: CompositionSegment[] | undefined; itemId: string; layers: number; weight: number; rotationLocked: boolean }
    | { ok: false; reason: string } => {
    const targetComposition = segmentsOf(target)
    const draggedComposition = segmentsOf(dragged)
    const distinctIds = Array.from(new Set([...targetComposition, ...draggedComposition].map((s) => s.itemId)))
    const sumLayersOfId = (segs: CompositionSegment[], id: string) =>
      segs.filter((s) => s.itemId === id).reduce((sum, s) => sum + s.layers, 0)

    if (distinctIds.length > 1) {
      // Pipe-shape/dimension/category compatibility — generalized from the
      // old reconcileCrossItemMerge's single-pair check to the FULL
      // constituent set on BOTH sides. A merge between two placements that
      // happen to share the same NOMINAL itemId used to skip this check
      // entirely even when their non-nominal constituents actually
      // differed — a transitive gap the Round 24 investigation identified
      // (e.g. composed(A+B) onto composed(A+C) with B/C incompatible,
      // hidden behind the matching nominal A on both sides).
      const catalogItems = distinctIds.map((id) => items.find((it) => it.id === id))
      const missingIndex = catalogItems.findIndex((it) => !it)
      if (missingIndex !== -1) return { ok: false, reason: 'Груз не найден' }
      const resolved = catalogItems as NonNullable<(typeof catalogItems)[number]>[]
      const first = resolved[0]
      for (const it of resolved) {
        if (!isPipeShape(it)) return { ok: false, reason: 'Объединение перетаскиванием доступно только для труб' }
        if (it.width !== first.width || it.length !== first.length) {
          return { ok: false, reason: `«${it.name}» и «${first.name}» — разные размеры труб, объединить нельзя` }
        }
        if (it.category !== first.category) {
          return { ok: false, reason: `«${it.name}» и «${first.name}» — разные категории груза, объединить нельзя` }
        }
      }
    }

    // Per-constituent maxLayers/quantity — reuse checkLayerChange (the same
    // tested primitive `+`/`-` and same-item merge already rely on), once
    // per distinct itemId across the COMBINED result. currentLayers=0 and
    // delta=combinedOwnLayers makes it check the new total for that item
    // directly; excluding target+dragged drops their current (about to be
    // replaced) layers from the "already placed elsewhere" sum.
    for (const id of distinctIds) {
      const combinedOwnLayers = sumLayersOfId(targetComposition, id) + sumLayersOfId(draggedComposition, id)
      const check = checkLayerChange(id, 0, combinedOwnLayers, [target.id, dragged.id])
      if (!check.ok) return { ok: false, reason: check.reason ?? 'Невозможно объединить' }
    }

    const newComposition = placementConcatComposition(targetComposition, draggedComposition)
    const height = checkStackHeight(newComposition)
    if (!height.ok) return height
    const newLayers = newComposition.reduce((sum, s) => sum + s.layers, 0)
    const newWeightTotal = newComposition.reduce((sum, s) => sum + s.layers * (items.find((it) => it.id === s.itemId)?.weight ?? 0), 0)
    const newWeight = newWeightTotal / Math.max(1, newLayers)

    // Rotation: most-restrictive-wins across EVERY constituent on BOTH
    // sides (the pre-Round-24 code only ever checked the dragged side's
    // NOMINAL item) — keeps the existing sticky rotationLocked flag/field
    // architecture unchanged, just widens what feeds into it.
    const anyNonRotatable = distinctIds.some((id) => items.find((it) => it.id === id)?.allowRotation === false)
    const rotationLocked = Boolean(target.rotationLocked || dragged.rotationLocked || anyNonRotatable)

    if (newComposition.length === 1) {
      // Collapse back to the plain/uncomposed representation — the data
      // model's invariant is that `composition` only exists for 2+ segments.
      return { ok: true, composition: undefined, itemId: newComposition[0].itemId, layers: newLayers, weight: newWeight, rotationLocked }
    }
    return { ok: true, composition: newComposition, itemId: target.itemId, layers: newLayers, weight: newWeight, rotationLocked }
  }

  // Round 24 corrective pass: the pre-Round-24 reconcileCrossItemMerge did
  // ONE more thing besides the physical checks planComposedMerge above now
  // owns — it moved catalog quantity from the dragged item to the target
  // item, since the old blended-weight representation could only attribute
  // a merged stack to ONE catalog item (the survivor), and moving quantity
  // was the only way to keep both items' own "Кол-во" truthful under that
  // constraint. That is a LEGACY contract this pass deliberately preserves
  // byte-for-byte for the exact case it originally covered — a pure
  // standalone (uncomposed on BOTH sides) cross-item merge — since nothing
  // about composition existing elsewhere in the app changes what a plain,
  // never-composed merge has always done.
  //
  // The moment EITHER side already carries a `composition`, this must NOT
  // fire: composition already tracks each constituent's units individually
  // (see planComposedMerge's own doc comment), so transferring quantity on
  // top of that would incorrectly shrink/zero a constituent's catalog
  // quantity even though its units remain legitimately placed — just now
  // nested inside a placement's composition instead of standing alone. This
  // is a strict superset-safe split, not a new quantity rule: a same-item
  // merge (target.itemId === dragged.itemId) never transferred quantity
  // either, before or after Round 24 — only a genuine cross-item, fully
  // uncomposed merge does. Does not touch remove/unpin's own quantity
  // semantics (Round 16's decrease-only contract, untouched) or removeItem.
  //
  // Round 34: ...and it only ever applies when it DRAINS the dragged item
  // (Round 31's collapse below — the dragged units become the target's). A
  // partial transfer used to fire on top of the composition planComposedMerge
  // builds for every cross-item merge, so the moved units were counted twice:
  // once inside the composition under the dragged item, once more as the
  // target's quantity — AUTO then placed a ghost stack (24 units on deck from
  // 17, weight inflated to match) and the dragged item showed "8/1 разм.".
  // The composition alone already accounts for every unit, exactly as for the
  // composed case above.
  //
  // legacyCrossItemTransferOf is the ONE place that decides whether that
  // transfer applies (and by how much) — shared by planMerge (which needs to
  // know in advance) and the applier below, so the two can't disagree.
  const legacyCrossItemTransferOf = (
    target: { itemId: string; layers: number; composition?: CompositionSegment[] },
    dragged: { itemId: string; layers: number; composition?: CompositionSegment[] }
  ) => {
    if (target.composition || dragged.composition) return null
    if (target.itemId === dragged.itemId) return null
    const store = useCalculator.getState()
    const draggedItem = store.items.find((it) => it.id === dragged.itemId)
    const targetItem = store.items.find((it) => it.id === target.itemId)
    if (!draggedItem || !targetItem) return null
    const delta = dragged.layers
    const remaining = draggedItem.quantity - delta
    if (remaining > 0) return null
    return { draggedItem, targetItem, delta, remaining }
  }

  const legacyStandaloneCrossItemQuantityTransfer = (
    target: { itemId: string; layers: number; composition?: CompositionSegment[] },
    dragged: { itemId: string; layers: number; composition?: CompositionSegment[] }
  ) => {
    const transfer = legacyCrossItemTransferOf(target, dragged)
    if (!transfer) return
    const store = useCalculator.getState()
    // A transfer only ever drains the dragged item (see above).
    store.removeItem(transfer.draggedItem.id)
    store.updateItem(transfer.targetItem.id, { quantity: transfer.targetItem.quantity + transfer.delta })
  }

  // Round 31 (fixes the "orphan constituent" the e2e suite caught): when the
  // legacy transfer takes the dragged item's ENTIRE remaining quantity it
  // deletes that item from the catalog (removeItem) — yet planComposedMerge's
  // result still lists it as a composition segment, so the merged placement
  // ended up pointing at an item that no longer exists, while the target's
  // quantity (which now includes the transferred units) was only half
  // covered by composition. AUTO mode then placed the "missing" units as a
  // ghost second stack (counts like 24/16). In that one case the dragged
  // units simply BECOME the target item's units — exactly what the
  // transferred quantity says — so the result collapses to a plain placement
  // of the target item, and the target's own limits (cap / height /
  // quantity incl. the transferred units) are re-checked for the merged
  // total instead of for the two halves separately. Every other merge
  // (partial transfer, same item, anything composed) is untouched.
  const planMerge = (
    target: Parameters<typeof planComposedMerge>[0],
    dragged: Parameters<typeof planComposedMerge>[1]
  ): ReturnType<typeof planComposedMerge> => {
    const plan = planComposedMerge(target, dragged)
    if (!plan.ok) return plan
    const transfer = legacyCrossItemTransferOf(target, dragged)
    if (!transfer) return plan
    const merged = checkLayerChange(target.itemId, 0, plan.layers, [target.id, dragged.id], transfer.delta)
    if (!merged.ok) return { ok: false, reason: merged.reason ?? 'Невозможно объединить' }
    return { ...plan, composition: undefined, itemId: target.itemId, weight: transfer.targetItem.weight ?? 0 }
  }

  const handleMergePinned = (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return
    const dragged = pinnedPlacements.find((p) => p.id === draggedId)
    const target = pinnedPlacements.find((p) => p.id === targetId)
    if (!dragged || !target) return
    const plan = planMerge(target, dragged)
    if (!plan.ok) {
      toast.warning(plan.reason)
      return
    }
    legacyStandaloneCrossItemQuantityTransfer(target, dragged)
    updatePinned(clampedTripIndex, target.id, {
      composition: plan.composition,
      itemId: plan.itemId,
      layers: plan.layers,
      weight: plan.weight,
      rotationLocked: plan.rotationLocked,
      locked: true,
    })
    removePinned(clampedTripIndex, dragged.id)
    toast.success(`Объединено: ${plan.layers} яр. груза «${target.name}»`)
  }

  useEffect(function runPendingPinAction() {
    const pending = pendingPinActionRef.current
    if (!pending || !pinnedPlacements.some((p) => p.id === pending.id)) return
    pendingPinActionRef.current = null
    const { id, action } = pending
    if (action.kind === 'rotate') handleRotatePinned(id)
    else if (action.kind === 'layers') handleLayerChangePinned(id, action.delta)
    else if (action.kind === 'remove') handleRemovePinned(id)
    else nudgePlacement(id, action.dx, action.dy)
  })

  const handleMergeManual = (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return
    const dragged = manualPlacements.find((m) => m.id === draggedId)
    const target = manualPlacements.find((m) => m.id === targetId)
    if (!dragged || !target) return
    const plan = planMerge(target, dragged)
    if (!plan.ok) {
      toast.warning(plan.reason)
      return
    }
    legacyStandaloneCrossItemQuantityTransfer(target, dragged)
    updateManualPlacement(target.id, {
      composition: plan.composition,
      itemId: plan.itemId,
      layers: plan.layers,
      weight: plan.weight,
      rotationLocked: plan.rotationLocked,
    })
    removeManualPlacement(dragged.id)
    toast.success(`Объединено: ${plan.layers} яр. груза «${target.name}»`)
  }

  // What a drag-to-merge would give, named next to its target while the
  // drag is on it (spec 6.7): «Объединить: 16 яр., 4 м из 6 м», or why it
  // can't be done — the same check, in the same words, as the drop itself.
  const previewMerge = (draggedId: string, targetId: string): { ok: boolean; text: string } | null => {
    const placements: (ManualPlacement | PinnedPlacement)[] = mode === 'manual' ? manualPlacements : pinnedPlacements
    const dragged = placements.find((p) => p.id === draggedId)
    const target = placements.find((p) => p.id === targetId)
    if (!dragged || !target) return null
    const plan = planMerge(target, dragged)
    if (!plan.ok) return { ok: false, text: plan.reason }
    const segs = plan.composition ?? [{ itemId: plan.itemId, layers: plan.layers }]
    const constituents = [...new Set(segs.map((seg) => seg.itemId))]
      .map((id) => items.find((it) => it.id === id))
      .filter((it): it is CargoItem => !!it)
    const height = stackHeight(segs, items)
    const budget = stackHeightBudget(constituents, deck.clearance, deck.unit)
    const unitLabel = UNIT_LABEL[deck.unit]
    const heightText =
      height > 0
        ? `, ${roundForDisplay(height)} ${unitLabel}${Number.isFinite(budget) ? ` из ${roundForDisplay(budget)} ${unitLabel}` : ''}`
        : ''
    return { ok: true, text: `Объединить: ${plan.layers} яр.${heightText}` }
  }

  // Switch mode while preserving placements:
  //  - auto -> manual: all placed items (pinned + auto-packed) become manual placements
  //  - manual -> auto: all manual placements become pinned, auto-packer keeps their positions
  const switchToManual = () => {
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
      clearanceMargin: p.clearanceMargin,
      // Round 20 — composition-only preservation. PlacedItem already
      // carries `composition` (copied through verbatim by packDeck/
      // packingResultFromManual, never synthesized — Round 14), so this
      // is a straight passthrough, not a new source of truth. Dormant
      // today (nothing writes composition until the merge switch-on
      // round); scoped deliberately to composition ONLY — stabilityOverride/
      // lashingWireType/lashingJustification/rotationLocked are NOT
      // present on PlacedItem at all (a structural gap, not a missed
      // copy here) and are tracked separately as a future placement-
      // metadata-ownership decision, not fixed in this round.
      composition: p.composition,
    }))
    // Lashing points only ever attach to a real placement id (pinned or
    // manual) — auto-mode's non-pinned, algorithm-placed slots never have
    // one, so only pinnedPlacements (not the full result.placed) can be a
    // carryover source here.
    const matches = matchLashingCarryover(pinnedPlacements, newManual)
    useCalculator.setState({
      mode: 'manual',
      manualPlacements: [...newManual, ...pinnedPlacements.filter(isQuarantined)],
      // Only the trip actually being converted moves into manualPlacements
      // — every OTHER trip's pins must survive untouched. This used to be
      // `pinnedPlacementsByTrip: {}`, wiping every other trip's data the
      // instant the user switched to MANUAL from anywhere but trip 0 —
      // there was no way back to it after switching back to AUTO.
      pinnedPlacementsByTrip: { ...pinnedPlacementsByTrip, [clampedTripIndex]: [] },
      selectedPinIds: [],
      selectedAutoKeys: [],
      activeStampId: null,
      pendingPresetStamp: null,
      activePresetCategory: null,
    })
    useCalculator.getState().remapLashingPointsForRedistribute(matches)
    toast.info('Ручной режим — размещения сохранены')
  }

  // keepPositions: every manual placement becomes a pin of the trip that was
  // open when the user switched to manual (the old, only behaviour).
  // Otherwise the cargo is re-packed from scratch on that trip, and lashing
  // points tied to the dropped placements go with them.
  const switchToAuto = (keepPositions: boolean) => {
    if (!keepPositions) {
      useCalculator.setState({
        mode: 'auto',
        pinnedPlacementsByTrip: { ...pinnedPlacementsByTrip, [activeTripIndex]: [] },
        manualPlacements: [],
        selectedPinIds: [],
        selectedAutoKeys: [],
        selectedManualIds: [],
        activeStampId: null,
        pendingPresetStamp: null,
        activePresetCategory: null,
      })
      useCalculator.getState().pruneStaleLashingPoints()
      toast.info('Авто-режим — груз расставлен заново')
      return
    }
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
      clearanceMargin: m.clearanceMargin,
      // Round 20 — composition-only preservation. `m` is a raw stored
      // ManualPlacement here (not PlacedItem), which already carries
      // `composition` at the type level — straight passthrough.
      composition: m.composition,
      // Keeps a quarantined placement quarantined — see isQuarantined.
      malformed: m.malformed,
      // «Оставить позиции»: the user chose these places by hand — they stay
      // «Закреплён» (lock badge, kept by «Автораспределение»).
      locked: true,
    }))
    const matches = matchLashingCarryover(manualPlacements, newPinned)
    useCalculator.setState({
      mode: 'auto',
      // Manual mode has no trip concept of its own — the edits go back
      // into whichever trip was active when the user switched TO manual.
      // NOT clampedTripIndex: manual's own `trips` array is always
      // length 1, so `clampedTripIndex = min(activeTripIndex, 0)` is
      // forced down to 0 for the whole time the user is in manual mode,
      // regardless of which trip they were on before switching —
      // activeTripIndex is the one value that still remembers it. Used
      // to hard-code trip 0 outright and replace the whole map, which
      // both mis-filed the edit under the wrong trip whenever the user
      // had switched from trip N != 0, and discarded every other trip's
      // pins in the process.
      pinnedPlacementsByTrip: { ...pinnedPlacementsByTrip, [activeTripIndex]: newPinned },
      manualPlacements: [],
      selectedPinIds: [],
      selectedAutoKeys: [],
      activeStampId: null,
      pendingPresetStamp: null,
      activePresetCategory: null,
    })
    useCalculator.getState().remapLashingPointsForRedistribute(matches)
    toast.info('Авто-режим — размещения сохранены как закреплённые')
  }

  const handleModeChange = (newMode: 'auto' | 'manual') => {
    if (newMode === mode) return
    if (newMode === 'manual') {
      // Manual mode has a single trip: only the open trip's cargo moves onto
      // the manual deck, everything on the other trips becomes unplaced until
      // the user goes back to auto. That used to happen without a word.
      const strandedUnits = shownTrips.reduce((sum, t, i) => (i === clampedTripIndex ? sum : sum + t.placedCount), 0)
      if (strandedUnits > 0) {
        setModeSwitchPrompt({ to: 'manual', strandedUnits })
        return
      }
      switchToManual()
      return
    }
    // Every manual placement used to turn into a pin silently, after which
    // auto mode no longer packed that cargo — ask instead.
    if (manualPlacements.some((m) => !isQuarantined(m))) {
      setModeSwitchPrompt({ to: 'auto' })
      return
    }
    switchToAuto(true)
  }

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
    const sourcePlacements = mode === 'manual' ? manualPlacements : pinnedPlacements
    const attachedIds = new Set((deck.lashingPoints ?? []).map((lp) => lp.placementId).filter(Boolean))
    const isLocked = (p: ManualPlacement | PinnedPlacement) => 'locked' in p && !!p.locked
    const frozenPinned: PinnedPlacement[] = sourcePlacements
      .filter((p) => !!p.clearanceMargin || attachedIds.has(p.id) || isLocked(p))
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
    // user's own: say how many get re-arranged.
    if (mode === 'manual') {
      const frozenIds = new Set(frozenPinned.map((p) => p.id))
      const reshuffled = manualPlacements.filter((p) => !frozenIds.has(p.id) && !isQuarantined(p)).length
      if (reshuffled > 0) {
        toast.warning(`Ручные размещения (${reshuffled}) будут переставлены заново`)
      }
    }
    if (frozenPinned.length > 0) {
      toast.info(`Закреплённый груз, зоны отступа и точки крепления (${frozenPinned.length}) останутся на месте`)
    }
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
    setVariantsSnapshot({ list: newVariants, builtFor: variantInputs })
    // Apply the best variant immediately
    if (newVariants.length > 0) {
      applyVariant(newVariants[0])
    }
    toast.success(`Сгенерировано вариантов: ${newVariants.length}`)
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
  // Auto-redistribute hands every placement a brand-new id (it's a full
  // repack, not a move), so a lashing point's old placementId never matches
  // anything afterward. Match each old placement that actually has lashing
  // points against the nearest same-itemId placement in the new layout
  // (greedy, one new placement claimed per old one) so those points survive
  // onto "the same cargo, repacked" instead of being pruned as orphans.
  const matchLashingCarryover = (
    oldPlacements: { id: string; itemId: string; x: number; y: number }[],
    newPlacements: { id: string; itemId: string; x: number; y: number }[]
  ) => {
    const attachedOldIds = new Set(
      (useCalculator.getState().deck.lashingPoints ?? []).map((lp) => lp.placementId).filter(Boolean)
    )
    const oldWithLashing = oldPlacements.filter((p) => attachedOldIds.has(p.id))
    if (oldWithLashing.length === 0) return []
    const usedNewIds = new Set<string>()
    const matches: { oldId: string; newId: string; dx: number; dy: number }[] = []
    for (const old of oldWithLashing) {
      let best: { id: string; itemId: string; x: number; y: number } | undefined
      let bestDist = Infinity
      for (const cand of newPlacements) {
        if (usedNewIds.has(cand.id) || cand.itemId !== old.itemId) continue
        const d = Math.hypot(cand.x - old.x, cand.y - old.y)
        if (d < bestDist) {
          bestDist = d
          best = cand
        }
      }
      if (best) {
        usedNewIds.add(best.id)
        matches.push({ oldId: old.id, newId: best.id, dx: best.x - old.x, dy: best.y - old.y })
      }
    }
    return matches
  }

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

  const handleSelectVariant = (variant: PackVariant) => {
    applyVariant(variant)
    toast.info(`Применён: ${variant.label} (${variant.utilizationPct}%)`)
  }

  // Initial stability of the open trip for the status line (spec 8.3) — the
  // same calculation StabilityPanel shows in «Проверки».
  const statusGm = useMemo(() => {
    const vessel = deck.vessel
    if (!vessel) return undefined
    const frame: DeckShipFrame = deck.shipFrame ?? { originOffsetFromCenterlineM: 0, originOffsetFromMidshipsM: 0, heightAboveBaselineM: 0 }
    const loading = buildLoadingConditionFromPlacements(vessel, frame, { width: deck.width, length: deck.length }, deck.deckForwardIsPositiveY ?? true, result.placed, deck.unit, items)
    const stability = computeStabilityResult(vessel, loading)
    if (!stability) return undefined
    const limit = vessel.particulars.minGM ?? G_METACENTRIC_MIN_SAFE
    return { valueM: stability.GM_fluid, ok: stability.GM_fluid >= limit, estimated: stability.extrapolated }
  }, [deck.vessel, deck.shipFrame, deck.width, deck.length, deck.deckForwardIsPositiveY, deck.unit, result.placed, items])

  // The whole plan's checks (spec 8.4), every trip: their ✕ and ⚠ in the
  // status line and on the «Проверки» tab, the list at the top of that
  // section.
  const planChecks = useMemo(
    () =>
      buildChecks(
        gatherPlanFacts({
          mode,
          trips: hasEmptyTrailingTrip ? trips.slice(0, -1) : trips,
          pinnedPlacementsByTrip,
          manualPlacements,
          items,
          deck,
          separationRules: separationRulesInUnit,
        })
      ),
    [mode, trips, hasEmptyTrailingTrip, pinnedPlacementsByTrip, manualPlacements, items, deck, separationRulesInUnit]
  )

  // Esc closes the inspector by dropping the selection (spec 5.4). An armed
  // tool takes Esc first (above), and so do fields, dialogs and menus.
  const hasSelection = selectedPinIds.length + selectedAutoKeys.length + selectedManualIds.length > 0
  const toolArmed = !!(
    placingLashingPoint ||
    placingPowerSocket ||
    placingAnnotation ||
    activeStampId ||
    pendingPresetStamp ||
    drawingCustomShape ||
    pendingCustomShape ||
    editingDeckOutline ||
    drawingRestrictionShape ||
    drawingRestrictionZoneFreeform
  )
  useEffect(() => {
    if (!hasSelection || toolArmed) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const target = e.target instanceof Element ? e.target : null
      if (target?.closest('input, textarea, select, [role="dialog"], [role="alertdialog"], [role="menu"], [data-radix-popper-content-wrapper]')) return
      clearSelection()
      clearManualSelection()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [hasSelection, toolArmed, clearSelection, clearManualSelection])

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
    const stack: InspectedStack = {
      kind,
      name: source.name,
      number: cargoNumberByItemId.get(source.itemId),
      size: item
        ? `${fmtNumber(item.width)} × ${fmtNumber(item.length)} × ${fmtNumber(item.height)} ${unit}`
        : `${fmtNumber(source.width)} × ${fmtNumber(source.length)} ${unit}`,
      unitWeight: !record?.composition && item?.weight ? `${fmtNumber(item.weight)} кг` : undefined,
      stackWeight: `${fmtTonnes(record ? placementTotalWeightKg(record, items) : (source.weight ?? 0) * layers)} т`,
      layers,
      maxLayers: add.maxPhys,
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
              rotate: () => actOnAutoStack(selectedAutoStack, { kind: 'rotate' }),
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
              {mode === 'manual' ? 'Требует перестановки' : 'Не поместилось'} ({redStripCount}):
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
              {rejectedPinsHere.map((u, i) => (
                <Badge
                  key={`pin-${u.itemId}-${i}`}
                  variant="destructive"
                  className="text-xs font-normal"
                  title={u.reason}
                >
                  {u.name} — {u.reason}
                </Badge>
              ))}
              {manualConflicts.map((p) => (
                <Badge
                  key={`conflict-${p.index}`}
                  variant="destructive"
                  className="text-xs font-normal"
                  title={p.conflict}
                >
                  {p.name} — {p.conflict}
                </Badge>
              ))}
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
          {activeSection === 'vessel' && <VesselSection onApplyVesselTemplate={handleApplyVesselTemplate} zoneLoads={zoneLoads} />}
          {activeSection === 'cargo' && (
            <CargoSection
              result={result}
              placedAcrossTrips={placedAcrossTrips}
              unit={deck.unit}
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
              onAutoRedistribute={handleAutoRedistribute}
              variants={variants}
              onSelectVariant={handleSelectVariant}
            />
          )}
          {activeSection === 'checks' && (
            <ChecksSection
              checks={planChecks}
              onOpenSection={openSection}
              stats={{
                result,
                unit: deck.unit,
                loadZones: deck.loadZones,
                deckOutline: deck.outline,
                maxDeckCargoT: deck.maxDeckCargoT,
                tenFootContainerCapacity: deck.tenFootContainerCapacity,
                deckStrengthPending,
                cargoNumberByItemId,
                unplaced:
                  mode === 'auto'
                    ? {
                        count: unfitUnits,
                        label: 'Не влезло',
                        note: carriedToNextTrip > 0 ? `ещё ${carriedToNextTrip} в рейс ${clampedTripIndex + 2}` : undefined,
                      }
                    : { count: Math.max(0, result.requestedCount - result.placedCount), label: 'Не размещено' },
              }}
              stability={{
                result,
                deckWidth: deck.width,
                deckLength: deck.length,
                unit: deck.unit,
                vessel: deck.vessel,
                shipFrame: deck.shipFrame,
                deckForwardIsPositiveY: deck.deckForwardIsPositiveY,
                items,
              }}
              lashing={{ autoStack: selectedAutoStack, onPatchAutoStack: patchAutoStack }}
            />
          )}
          {activeSection === 'report' && (
            <ReportSection hasCargo={items.some((it) => it.quantity >= 1)} onExportPdf={handleExportPdf} onSaveFile={handleExportJson} />
          )}
        </SectionPanel>

        <main className="flex-1 min-w-0 flex flex-col">
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
              <ViewMenu />
            </div>
          </div>
          {carriedToNextTrip > 0 && (
            <p className="px-4 pt-2 text-sm text-ink-2" data-testid="trip-carry-over">
              {carriedToNextTrip} ед. {pluralRu(carriedToNextTrip, 'уходит', 'уходят', 'уходят')} в рейс {clampedTripIndex + 2}
              {carryReasons.length > 0 && ` — ${carryReasons.map((u) => `${u.name}: ${u.reason}`).join('; ')}`}
            </p>
          )}
          {/* The deck sits in the middle of the area while it fits, and scrolls
              from the top when it doesn't (auto margins, not justify-center). */}
          <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col overflow-auto px-4 py-3" data-tour="deck-view">
            <div className="my-auto w-full">
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
                ref={deckSvgRef}
                toolbarContainer={canvasToolsEl}
                selectionTools={inspected && <MiniPanel stack={inspected.stack} actions={inspectedActions!} />}
                selectionAnchor={inspected?.anchor}
                selectionMenu={inspected && <StackMenuItems stack={inspected.stack} actions={inspectedActions!} />}
                // The inspector covers the deck area's right 320 px; its own
                // 16 px padding (px-4) is part of that.
                coveredRight={inspected || inspectedSelection ? INSPECTOR_WIDTH_PX - 16 : 0}
                printMode={deckPrintMode}
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
                onSetBackgroundImageOpacity={setDeckBackgroundImageOpacity}
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
                drawingCustomShape={drawingCustomShape}
                onFinishDrawing={handleFinishDrawing}
                onPlace={(p) => {
                  // A preset catalog item being placed for the first time — the
                  // click itself is what creates the CargoItem (quantity 1) and
                  // defines it as "wanted", so the aggregate quantity cap below
                  // doesn't apply here; resolve the real item id first.
                  let itemId = p.itemId
                  const wasPendingPreset = !!pendingPresetStamp
                  if (pendingPresetStamp) {
                    // A preset stamp skips the quantity guard below on
                    // purpose (see the comment further down where it
                    // stays armed) — but that's not license to skip the
                    // capacity guard too. It was, until now: this branch
                    // never called wouldExceedMaxDeckCargo at all, in
                    // either mode, so repeatedly clicking an armed preset
                    // could blow past maxDeckCargoT with zero pushback.
                    const presetWeight = pendingPresetStamp.weight
                    if (wouldExceedMaxDeckCargo(presetWeight ?? 0)) {
                      toast.error(`Превышен лимит груза на палубе (${deck.maxDeckCargoT} т)`)
                      return
                    }
                    itemId = addOrIncrementCargoFromTemplate(pendingPresetStamp)
                  } else {
                    // Scoped to THIS item, not a global sum across every
                    // cargo type — an aggregate check let a fully-placed
                    // item keep being over-placed by clicking its own
                    // stamp, as long as some OTHER item's quantity still
                    // had "room" in the total (e.g. item A qty 1 already
                    // placed, item B qty 1 still unplaced: clicking A's
                    // stamp again passed 1 >= 2 = false and placed a
                    // second A anyway).
                    const item = items.find((it) => it.id === p.itemId)
                    const itemRequested = item?.quantity ?? 0
                    // Round 23: composition-aware — placementLayersOfItem
                    // (already the canonical primitive checkLayerChange
                    // uses, see its own layersOfIdIn helper above) counts
                    // only THIS itemId's own layers within each
                    // placement, not the placement's flat total. A plain
                    // `pin.itemId === p.itemId` filter-and-sum-whole-
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
                      pl.malformed && !pl.composition ? 0 : pl.composition ? placementLayersOfItem(pl, p.itemId) : pl.itemId === p.itemId ? Math.max(1, pl.layers) : 0
                    const itemPlaced =
                      mode === 'manual'
                        ? manualPlacements.reduce((s, m) => s + layersOfIdIn(m), 0)
                        : Object.values(pinnedPlacementsByTrip)
                            .flat()
                            .reduce((s, pin) => s + layersOfIdIn(pin), 0)
                    if (itemPlaced >= itemRequested) {
                      toast.warning(
                        `Все ${itemRequested} ед. груза «${item?.name ?? ''}» уже размещены — увеличьте количество в списке грузов`
                      )
                      return
                    }
                    if (wouldExceedMaxDeckCargo(item?.weight ?? 0)) {
                      toast.error(`Превышен лимит груза на палубе (${deck.maxDeckCargoT} т)`)
                      return
                    }
                  }
                  const placement = { ...p, itemId }
                  if (mode === 'manual') {
                    useCalculator.getState().addManualPlacement(placement)
                  } else {
                    pinFromPlaced(clampedTripIndex, { ...placement, locked: true })
                  }
                  // Deliberately NOT calling setActiveStamp(itemId) here.
                  // pendingPresetStamp stays armed after this first
                  // placement, so the next click keeps going through the
                  // uncapped addOrIncrementCargoFromTemplate branch above
                  // instead of falling into the aggregate-quantity cap —
                  // that cap makes sense for a pre-declared "Грузы" item
                  // (its quantity was set on purpose), but a preset has
                  // no quantity yet; it's only ever defined by how many
                  // times the user clicks. Switching to the capped
                  // activeStampId after one click used to leave a stamp
                  // that still looked armed but silently refused every
                  // further click ("Все грузы уже размещены") until the
                  // user went and manually raised the quantity in
                  // "Грузы" — this keeps placing for as long as the
                  // preset stamp stays armed (toggle it off, Escape, or
                  // arm something else to stop).
                  if (wasPendingPreset) {
                    useCalculator.getState().setActivePresetCategory(null)
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
              onShowChecks={() => openSection('checks')}
              onClose={closeInspector}
            />
          )}
          </div>
          <StatusLine input={statusInput} onOpenSection={openSection} />
        </main>
      </div>
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
