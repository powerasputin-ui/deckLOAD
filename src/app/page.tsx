'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import dynamic from 'next/dynamic'
import { v4 as uuid } from 'uuid'
import {
  Ship,
  Wand2,
  MousePointerClick,
  Download,
  Upload,
  AlertTriangle,
  HelpCircle,
} from 'lucide-react'
import { useStore } from 'zustand'
import { Button } from '@/components/ui/button'
import { fmtNumber } from '@/lib/utils'
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
import { useCalculator, UNIT_LABEL, convertLength, clearCalculatorHistory, PALETTE, DEMO_DECK, createDemoItems } from '@/store/calculator'
import { useProjects, scheduleAutosave } from '@/store/projects'
import { VESSEL_TEMPLATES, type VesselTemplate } from '@/lib/vesselTemplates'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
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
} from '@/lib/packing'
import { placementLayersOfItem, placementPush, placementPop, placementTotalLayers, placementTotalWeightKg, segmentsOf, placementConcatComposition } from '@/lib/placementComposition'
import { DeckVisualization } from '@/components/calculator/DeckVisualization'
const Deck3DView = dynamic(() => import('@/components/calculator/Deck3DView'), {
  ssr: false,
  loading: () => (
    <div className="w-full rounded-lg border flex items-center justify-center text-sm text-muted-foreground" style={{ height: 480 }}>
      Загрузка 3D...
    </div>
  ),
})
import { ItemList } from '@/components/calculator/ItemList'
import { StatsPanel } from '@/components/calculator/StatsPanel'
import { StabilityPanel } from '@/components/calculator/StabilityPanel'
import { PlacementPanel } from '@/components/calculator/PlacementPanel'
import { Sidebar } from '@/components/calculator/Sidebar'
import { PresetsBar } from '@/components/calculator/PresetsBar'
import { VideoIntro } from '@/components/intro/VideoIntro'
import { ProductTour, type TourStep } from '@/components/onboarding/ProductTour'
import { exportDeckPlanToPdf, buildLashingRequirementRows } from '@/lib/exportPdf'
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
const getTourSeenSnapshot = () => window.localStorage.getItem(TOUR_SEEN_KEY) === '1'
const getTourSeenServerSnapshot = () => false

// Each `selector` targets a `data-tour="..."` attribute placed directly on
// the real element elsewhere in the app (Sidebar's "Палуба" Section,
// DeckVisualization's card, PlacementPanel's auto-redistribute button,
// StatsPanel/StabilityPanel's own Card, the header's library/export
// buttons) — the tour never needs its own copy of those elements, just a
// stable hook into the ones that already exist. Order and wording were
// approved as a first pass; both are easy to revise here without touching
// ProductTour.tsx itself.
const TOUR_STEPS: TourStep[] = [
  {
    id: 'vessel-library',
    selector: '[data-tour="vessel-library"]',
    title: 'Библиотека судов',
    body: 'Начните с реального судна из библиотеки или используйте демо-палубу по умолчанию.',
  },
  {
    id: 'deck-settings',
    selector: '[data-tour="deck-settings"]',
    title: 'Параметры палубы',
    body: 'Здесь задаётся ширина и длина палубы — в метрах, сантиметрах или футах.',
  },
  {
    id: 'load-zones',
    selector: '[data-tour="load-zones"]',
    title: 'Зоны нагрузки',
    body: 'Если на палубе есть места с ограничением нагрузки на м² (например, над топливными танками) — задайте их здесь. Система не даст превысить лимит при расстановке груза.',
  },
  {
    id: 'separation',
    selector: '[data-tour="separation"]',
    title: 'Сепарация груза',
    body: 'Некоторые грузы нельзя ставить рядом друг с другом (например, опасные вещества и продукты питания). Здесь задаются минимальные дистанции между категориями груза.',
  },
  {
    id: 'lashing',
    selector: '[data-tour="lashing"]',
    title: 'Крепление груза',
    body: 'Формула РД 31.11.21.23-96 точна для категории «Металлопродукция»; для остального груза — ориентировочная оценка. Для опасных грузов (химикаты, взрывоопасное) вместо числа показывается предупреждение — здесь нужен отдельный расчёт по IMDG Code.',
  },
  {
    id: 'cargo-list',
    selector: '[data-tour="cargo-list"]',
    title: 'Список груза',
    body: 'Добавьте свой груз или используйте один из демо-предметов.',
  },
  {
    id: 'view-mode',
    selector: '[data-tour="view-mode"]',
    title: 'Вид 2D / 3D',
    body: 'Переключайтесь между видом сверху (2D — здесь расставляется и двигается груз) и объёмным 3D-видом (для наглядной проверки — только просмотр, камера вращается и приближается).',
  },
  {
    id: 'deck-view',
    selector: '[data-tour="deck-view"]',
    title: 'Схема палубы',
    body: 'Кликните по грузу слева, затем по палубе — груз встанет на это место. В авто-режиме грузы расставляются сами.',
  },
  {
    id: 'auto-redistribute',
    selector: '[data-tour="auto-redistribute"]',
    title: 'Автораспределение',
    body: 'Нажмите — система предложит несколько готовых вариантов расстановки груза на выбор, вместо расстановки вручную.',
  },
  {
    id: 'stats',
    selector: '[data-tour="stats"]',
    title: 'Статистика загрузки',
    body: 'Видно, сколько груза уместилось и сколько свободного места осталось.',
  },
  {
    id: 'stability',
    selector: '[data-tour="stability"]',
    title: 'Остойчивость судна',
    body: 'Если выбрано судно с реальными данными — здесь считаются крен, дифферент и метацентрическая высота.',
  },
  {
    id: 'export',
    selector: '[data-tour="export"]',
    title: 'Экспорт',
    body: 'Сохраните расчёт в JSON, чтобы позже открыть его снова или отправить коллегам. Рядом есть кнопка «Скачать PDF» — для печатной версии.',
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
const getIntroSeenSnapshot = () => window.localStorage.getItem(INTRO_SEEN_KEY) === '1'
const getIntroSeenServerSnapshot = () => false

export default function Home() {
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
  // Set ONLY in playwright.config.ts's and vitest.config.ts's test
  // environments, so automated suites skip straight to the calculator.
  const entered = !replayIntro && (process.env.NEXT_PUBLIC_SKIP_INTRO === '1' || introSeen || justEntered)
  const handleEnterIntro = () => {
    window.localStorage.setItem(INTRO_SEEN_KEY, '1')
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
  if (entered && !tourSeen && !tourAutoTriggered) {
    setTourAutoTriggered(true)
    setTourActive(true)
  }
  const handleCloseTour = () => {
    window.localStorage.setItem(TOUR_SEEN_KEY, '1')
    setTourActive(false)
  }
  const handleShowTour = () => setTourActive(true)
  const deckSvgRef = useRef<SVGSVGElement>(null)
  const mainRef = useRef<HTMLElement>(null)
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
  const clearSelection = useCalculator((s) => s.clearSelection)
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  // 3D is a read-only camera-orbit snapshot of the same layout — no
  // drag/pin/zone editing there, that stays exclusively in the 2D view.
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d')
  const [variants, setVariants] = useState<PackVariant[]>([])
  const [activeTripIndex, setActiveTripIndex] = useState(0)
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
        useCalculator.temporal.getState().redo()
      } else if (key === 'z') {
        e.preventDefault()
        useCalculator.temporal.getState().undo()
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
      return [packingResultFromManual(deck.width, deck.length, manualPlacements, totalRequested, items, deck.clearance, deck.outline)]
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
  const clampedTripIndex = Math.max(0, Math.min(activeTripIndex, trips.length - 1))
  const result = trips[clampedTripIndex] ?? trips[0]
  // Pins for the currently-open trip only — each trip is its own deck instance.
  const pinnedPlacements = pinnedPlacementsByTrip[clampedTripIndex] ?? []

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

  const handleExportPdf = async () => {
    const svgEl = deckSvgRef.current
    if (!svgEl) {
      toast.error('Схема палубы ещё не готова')
      return
    }
    const projectName = projects.find((p) => p.id === activeId)?.name ?? 'DeckLoad'
    const points = deck.lashingPoints ?? []
    // Mode-scoped, not "everything in state" — switching mode never clears
    // or migrates either array (see setMode's own comment), so pinned data
    // left over from a prior AUTO session stays in pinnedPlacementsByTrip
    // even while the user has since moved to MANUAL and abandoned it. Used
    // to combine both regardless of mode, which billed lashing-gear
    // requirements for cargo that isn't part of the plan currently being
    // exported. In AUTO, all trips are still included — a multi-trip
    // shipment's lashing gear is bought once for the whole operation, not
    // separately per trip.
    const allPlacements: (ManualPlacement | PinnedPlacement)[] =
      mode === 'manual' ? manualPlacements : Object.values(pinnedPlacementsByTrip).flat()
    // Round 19: composition-aware, per-segment row expansion — see
    // buildLashingRequirementRows's own doc comment (exportPdf.ts) for the
    // full contract. Pulled out as its own pure function specifically so it
    // can be unit-tested without jsPDF/canvas.
    const { rows: lashingRequirements, dangerousGoodsNames } = buildLashingRequirementRows(allPlacements, items, points)
    try {
      await exportDeckPlanToPdf({ svgEl, deck, unit: deck.unit, result, projectName, lashingRequirements, dangerousGoodsNames })
      toast.success('PDF скачан')
    } catch {
      toast.error('Не удалось собрать PDF')
    }
  }

  const handleNewCalculation = () => {
    useCalculator.setState({
      deck: { width: 20, length: 8, unit: 'm', gap: 0.1, boardOffset: 0.2, clearance: 0 },
      items: [],
      manualPlacements: [],
      pinnedPlacementsByTrip: {},
      separationRules: [],
      selectedPinIds: [],
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

  const handleResetCurrent = () => {
    useCalculator.setState({
      deck: { ...DEMO_DECK },
      items: createDemoItems(() => crypto.randomUUID()),
      manualPlacements: [],
      pinnedPlacementsByTrip: {},
      separationRules: [],
      selectedPinIds: [],
      selectedManualIds: [],
      mode: 'auto',
      activeStampId: null,
      pendingPresetStamp: null,
      activePresetCategory: null,
    })
    clearCalculatorHistory()
    prevOverloadedZoneCountRef.current = 0
    toast.info('Восстановлен демонстрационный пример')
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
    toast.success(`Судно «${tpl.label}» загружено`)
    // Deck-strength limit is a genuinely conflicting range for some vessels
    // (see VesselTemplate.limits.deckStrengthTPerM2's own doc comment) —
    // never auto-picked. Offer both real sourced values as an explicit
    // one-click choice instead; the zone applies to the whole deck, which
    // addLoadZone already supports without any drag-UI. Deferred to a toast
    // (rather than firing addLoadZone synchronously here) because
    // createProject/saveSnapshot above only stage the new project — the
    // calculator store is overwritten by a separate effect on the next
    // commit, so an immediate addLoadZone call here would target the OLD
    // project and then get clobbered anyway.
    const strength = tpl.limits?.deckStrengthTPerM2
    if (strength) {
      const makeZone = (maxLoadPerArea: number) => {
        useCalculator.getState().addLoadZone({
          x: 0,
          y: 0,
          width: tpl.deck.width,
          length: tpl.deck.length,
          maxLoadPerArea,
        })
      }
      toast.custom(
        (t) => (
          <div className="rounded-md border bg-background p-3 shadow-lg text-xs space-y-2 w-72">
            <div className="font-medium">Зона нагрузки на всю палубу — «{tpl.label}»</div>
            <div className="text-muted-foreground">
              Источники расходятся ({strength.sources}) — выберите лимит сами.
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px] flex-1"
                onClick={() => {
                  makeZone(strength.min)
                  toast.dismiss(t)
                }}
              >
                {fmtNumber(strength.min)} т/м²
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px] flex-1"
                onClick={() => {
                  makeZone(strength.max)
                  toast.dismiss(t)
                }}
              >
                {fmtNumber(strength.max)} т/м²
              </Button>
            </div>
          </div>
        ),
        { duration: 20000 }
      )
    }
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
      (patch) => updatePinned(clampedTripIndex, id, patch)
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
      pinFromPlaced(clampedTripIndex, placement)
    }
    setPendingCustomShape(null)
  }

  // Arrow keys nudge the selected cargo item; Space rotates it — 2D only
  // (alongside its existing pointer-drag, as a keyboard alternative). The 3D
  // view stays camera-only (rotate/zoom), no keyboard-driven editing there.
  // Skipped while focus is inside a text input (same guard as the other two
  // keydown listeners above). The listener stays attached whenever nothing
  // is selected too — it still needs to swallow Space/arrow keys (via
  // preventDefault) so they don't fall through to whatever toolbar button
  // currently has DOM focus (Space on a focused <button> re-clicks it
  // natively) rather than silently doing nothing. Which item is selected is
  // read fresh on every keypress rather than once when the effect was set
  // up, so selecting a new item takes effect immediately without waiting
  // for the effect to re-subscribe.
  useEffect(() => {
    if (viewMode !== '2d') return
    const onKeyDown = (e: KeyboardEvent) => {
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

      const isSpace = e.key === ' ' || e.code === 'Space'
      let dx = 0
      let dy = 0
      if (e.key === 'ArrowLeft') dx = -1
      else if (e.key === 'ArrowRight') dx = 1
      else if (e.key === 'ArrowUp') dy = -1
      else if (e.key === 'ArrowDown') dy = 1
      else if (!isSpace) return
      e.preventDefault()

      const selectedId = mode === 'manual' ? selectedManualIds[0] : selectedPinIds[0]
      if (!selectedId) return

      if (isSpace) {
        if (mode === 'manual') handleRotateManual(selectedId)
        else handleRotatePinned(selectedId)
        return
      }

      const step = computeGridStep(deck.width, deck.length) / 4
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
      else updatePinned(clampedTripIndex, selectedId, { x: clamped.x, y: clamped.y })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [viewMode, mode, selectedManualIds, selectedPinIds, manualPlacements, pinnedPlacements, deck, deck.restrictionZones, clampedTripIndex, updateManualPlacement, updatePinned, handleRotateManual, handleRotatePinned, items, result])

  // Check whether a layer change is allowed for a placement.
  // - maxPhys: physical ceiling from clearance / item.height
  // - totalPlacedForItem: current sum of layers across all placements of this item
  // - item.quantity: total units requested
  // Returns { ok: boolean, reason?: string }
  const checkLayerChange = (
    itemId: string,
    currentLayers: number,
    delta: number,
    excludeIds?: string | string[]
  ): { ok: boolean; reason?: string; maxPhys: number } => {
    const excluded = new Set(excludeIds ? (Array.isArray(excludeIds) ? excludeIds : [excludeIds]) : [])
    const item = items.find((it) => it.id === itemId)
    if (!item) return { ok: false, reason: 'Груз не найден', maxPhys: 1 }
    const maxPhys = maxLayersFor(item, deck.clearance)
    const newLayers = currentLayers + delta
    if (newLayers < 1) return { ok: false, reason: 'Минимум 1 ярус', maxPhys }
    if (newLayers > maxPhys) {
      // maxPhys is bound by the item's own "Ярусов" cap (not the deck's
      // height ceiling) whenever that cap is set and is the smaller/equal
      // value actually in effect — including when deck.clearance is 0,
      // where maxLayersFor now lets an explicit item cap through directly
      // rather than silently forcing 1 (see maxLayersFor's own comment).
      const reason =
        item.maxLayers && item.maxLayers > 0 && item.maxLayers <= maxPhys
          ? `Превышен лимит ярусов для этого груза (${item.maxLayers}) — измените поле «Ярусов» в списке грузов`
          : `Превышена высота под палубой — увеличьте зазор (clearance) в настройках, чтобы добавить ярус`
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
    if (sumPlaced + newLayers > item.quantity) {
      return {
        ok: false,
        reason: `Все ${item.quantity} ед. этого груза уже размещены — увеличьте количество в списке грузов`,
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

  // "+" mirrors "-": "-" takes the top layer off and stands it up as its own
  // container elsewhere on the deck; "+" should take an existing container
  // of the same item off the deck and stack it onto the selected one — the
  // point-and-click equivalent of dragging one placement onto another,
  // rather than conjuring a new unit out of unplaced quantity. Looks for
  // another placement of this item already on the deck (a pin first, else a
  // still-auto-placed instance, which gets pinned so it can be merged) and
  // returns what handleMergePinned needs to absorb it.
  const findMergeSourcePinned = (itemId: string, excludeId: string): { id: string } | null => {
    // Round 21 corrective pass (reasoning updated after Round 24): a
    // composed placement's nominal `itemId` can coincidentally match
    // `itemId` even though it also carries OTHER constituents — offering it
    // here would feed it into handleMergePinned below as a "+" source. That
    // handler is composition-AWARE since Round 24 (planComposedMerge), but
    // "+" and drag-to-merge are still two deliberately DIFFERENT
    // operations: "+" is Round 21's single-unit push (pulls exactly one
    // more layer of the SAME nominal item off the deck), while
    // handleMergePinned performs a bulk absorption of the WHOLE dragged
    // placement's composition. Letting a composed placement through this
    // "+" path would silently turn a single-unit push into a bulk multi-
    // constituent merge instead — the guard stays, just for that reason now
    // instead of composition-blindness. A freely-still-auto-placed instance
    // (the second branch, below) can never be composed in the first place —
    // composition only ever exists on an already-PINNED source (see
    // PlacedItem.composition's own doc comment in packing.ts), and this
    // scan explicitly excludes positions that match an existing pin — so no
    // equivalent guard is needed there.
    //
    // Round 29 corrective pass: same reasoning extends to a Tier-2
    // malformed placement (`malformed` set, no valid `composition` to
    // trust — see PinnedPlacement.malformed's own doc comment). Offering
    // one here would feed its raw, untrustworthy `layers` into
    // handleMergePinned, which would silently absorb (and DELETE) it —
    // phantom data merged into a real placement, and the malformed record
    // gone without ever surfacing to the user, defeating the whole "never
    // dropped, always preserved for diagnosis" contract.
    const otherPin = pinnedPlacements.find((p) => p.id !== excludeId && p.itemId === itemId && !p.composition && !p.malformed)
    if (otherPin) return { id: otherPin.id }
    const freeInstance = result.placed.find((p) => {
      if (p.itemId !== itemId) return false
      return !pinnedPlacements.some(
        (pp) => pp.itemId === itemId && Math.abs(pp.x - p.x) < 0.01 && Math.abs(pp.y - p.y) < 0.01
      )
    })
    if (!freeInstance) return null
    const newId = pinFromPlaced(clampedTripIndex, {
      itemId: freeInstance.itemId,
      name: freeInstance.name,
      x: freeInstance.x,
      y: freeInstance.y,
      width: freeInstance.width,
      length: freeInstance.length,
      layers: freeInstance.stackedCount,
      rotated: freeInstance.rotated,
      color: freeInstance.color,
      weight: freeInstance.weight,
    })
    return { id: newId }
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
        const layers = placementTotalLayers({ itemId: pin.itemId, layers: 0, composition })
        // `weight` is stored PER-UNIT (existing convention) — divide the
        // composition's total back down.
        const weight = placementTotalWeightKg({ itemId: pin.itemId, layers, composition }, items) / Math.max(1, layers)
        updatePinned(clampedTripIndex, id, { composition, layers, weight })
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
        })
      } else if (popped.composition) {
        const composition = popped.composition
        const layers = placementTotalLayers({ itemId: pin.itemId, layers: 0, composition })
        const weight = placementTotalWeightKg({ itemId: pin.itemId, layers, composition }, items) / Math.max(1, layers)
        updatePinned(clampedTripIndex, id, { composition, layers, weight })
      } else {
        // Defensive only: a composed placement always has >=2 segments, so
        // a single pop can never empty it. If it somehow does, fall back
        // to the existing safe full-removal path instead of leaving a
        // corrupt zero-layer placement on the deck.
        handleRemovePinned(id)
        return
      }
      // Stand the freed unit up as its own single-layer placement, same as
      // the uncomposed "-" below — but sourced from the segment that was
      // PHYSICALLY on top (popped.freedItemId), which may differ from the
      // placement's own nominal `itemId`.
      const freedItem = items.find((it) => it.id === popped.freedItemId)
      if (freedItem) {
        const spot = findFreeSpotForItem(freedItem)
        if (spot) {
          pinFromPlaced(clampedTripIndex, {
            itemId: freedItem.id,
            name: freedItem.name,
            x: spot.x,
            y: spot.y,
            width: spot.rotated ? freedItem.length : freedItem.width,
            length: spot.rotated ? freedItem.width : freedItem.length,
            layers: 1,
            rotated: spot.rotated,
            color: freedItem.color,
            weight: freedItem.weight,
          })
          useCalculator.setState({ selectedPinIds: [id] })
        }
      }
      return
    }

    if (delta > 0) {
      const source = findMergeSourcePinned(pin.itemId, id)
      if (source) {
        // A merge just restacks two placements already on the deck (or
        // promotes an already-auto-placed, already-weight-budgeted unit) —
        // total deck weight doesn't change, so it's not subject to the cap.
        handleMergePinned(source.id, id)
        return
      }
      // No merge source: this "+" pulls a fresh unit from unplaced
      // quantity, genuinely adding weight to the deck — that IS subject to
      // the cap. Manual mode's own "+" button already checked this
      // (handleLayerChangeManual); pinned had no equivalent at all.
      if (wouldExceedMaxDeckCargo(pin.weight ?? 0)) {
        toast.error(`Превышен лимит груза на палубе (${deck.maxDeckCargoT} т)`)
        return
      }
    }

    const check = checkLayerChange(pin.itemId, pin.layers, delta, id)
    if (!check.ok) {
      toast.warning(check.reason ?? 'Невозможно изменить ярусы')
      return
    }
    updatePinned(clampedTripIndex, id, { layers: pin.layers + delta })
    // Popping a layer off just frees one unit of quantity for the
    // auto-packer's generic remaining-quantity pool — and that pool's
    // default heuristic re-stacks same-item leftovers up to their physical
    // layer limit. So a second "-" click elsewhere would silently restack
    // its freed unit onto this one instead of standing apart. Lock the
    // freed unit down immediately as its own single-layer pin on open deck
    // space, so it always lands as an independent container.
    if (delta < 0) {
      const item = items.find((it) => it.id === pin.itemId)
      if (item) {
        const spot = findFreeSpotForItem(item)
        if (spot) {
          pinFromPlaced(clampedTripIndex, {
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
          })
          // pinFromPlaced selects the newly freed unit — keep the selection
          // on the stack the user is actually clicking "-" on instead, so
          // repeated clicks keep acting on it.
          useCalculator.setState({ selectedPinIds: [id] })
        }
      }
    }
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
    removePinned(clampedTripIndex, id)
    const segments = pin.composition ?? [{ itemId: pin.itemId, layers: pin.layers }]
    const layersByItemId = new Map<string, number>()
    for (const seg of segments) {
      layersByItemId.set(seg.itemId, (layersByItemId.get(seg.itemId) ?? 0) + seg.layers)
    }
    for (const [itemId, removedLayers] of layersByItemId) {
      const currentItem = useCalculator.getState().items.find((it) => it.id === itemId)
      if (currentItem) {
        useCalculator.getState().updateItem(itemId, { quantity: Math.max(0, currentItem.quantity - removedLayers) })
      }
    }
    toast.info(`Груз «${pin.name}» удалён (−${pin.layers} ед.)`)
  }

  // Locks/unlocks a pinned placement — a locked one stops responding to
  // drag until unlocked via the deck's right-click menu. Purely a drag
  // gate: unlike handleRemovePinned, it never touches item.quantity or the
  // placement's existence.
  const handleTogglePinLock = (id: string, locked: boolean) => {
    updatePinned(clampedTripIndex, id, { locked })
  }

  // Manual-mode equivalent of findMergeSourcePinned — every placement here
  // is already a manual placement (no separate "still auto-placed" pool to
  // fall back to), so this just looks for another one of the same item.
  // Round 21 corrective pass (reasoning updated after Round 24): same
  // `!m.composition` guard as findMergeSourcePinned above, same reason —
  // never offer a composed placement through the single-unit "+" path,
  // since handleMergeManual's drag-to-merge (composition-aware since Round
  // 24) is a deliberately different, bulk-absorption operation.
  const findMergeSourceManual = (itemId: string, excludeId: string): { id: string } | null => {
    // Round 29 corrective pass: same `!m.malformed` guard as
    // findMergeSourcePinned above, same reason — never offer a Tier-2
    // malformed placement as a "+" merge source.
    const other = manualPlacements.find((m) => m.id !== excludeId && m.itemId === itemId && !m.composition && !m.malformed)
    return other ? { id: other.id } : null
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
      const freedItem = items.find((it) => it.id === popped.freedItemId)
      if (freedItem) {
        const spot = findFreeSpotForItem(freedItem)
        if (spot) {
          useCalculator.getState().addManualPlacement({
            id: crypto.randomUUID(),
            itemId: freedItem.id,
            name: freedItem.name,
            x: spot.x,
            y: spot.y,
            width: spot.rotated ? freedItem.length : freedItem.width,
            length: spot.rotated ? freedItem.width : freedItem.length,
            layers: 1,
            rotated: spot.rotated,
            color: freedItem.color,
            weight: freedItem.weight,
          })
          useCalculator.setState({ selectedManualIds: [id] })
        }
      }
      return
    }

    const current = Math.max(1, mp.layers)

    // Same "+" logic as handleLayerChangePinned: grab an existing placement
    // of this item off the deck and stack it, instead of only pulling from
    // unplaced quantity.
    if (delta > 0) {
      const source = findMergeSourceManual(mp.itemId, id)
      if (source) {
        // A merge just restacks two placements already on the deck — total
        // deck weight doesn't change, so it's not subject to the cargo cap.
        handleMergeManual(source.id, id)
        return
      }
      // No merge source: this "+" pulls a fresh unit from unplaced quantity,
      // genuinely adding weight to the deck — that IS subject to the cap.
      if (wouldExceedMaxDeckCargo(mp.weight ?? 0)) {
        toast.error(`Превышен лимит груза на палубе (${deck.maxDeckCargoT} т)`)
        return
      }
    }

    const check = checkLayerChange(mp.itemId, current, delta, id)
    if (!check.ok) {
      toast.warning(check.reason ?? 'Невозможно изменить ярусы')
      return
    }
    updateManualPlacement(id, { layers: current + delta })
    // Same "-" logic as handleLayerChangePinned: stand the freed unit up as
    // its own placement on open deck space instead of letting it vanish.
    if (delta < 0) {
      const item = items.find((it) => it.id === mp.itemId)
      if (item) {
        const spot = findFreeSpotForItem(item)
        if (spot) {
          useCalculator.getState().addManualPlacement({
            id: crypto.randomUUID(),
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
          })
          // addManualPlacement doesn't change selection — explicitly keep it
          // on the placement the user is clicking "-" on, matching the pinned
          // version's behavior (repeated clicks keep acting on the same one).
          useCalculator.setState({ selectedManualIds: [id] })
        }
      }
    }
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
  // (pure standalone cross-item merge: legacy transfer preserved
  // byte-for-byte; anything where either side already carries a
  // `composition`: no transfer at all, on purpose). This does not reinterpret
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
  const legacyStandaloneCrossItemQuantityTransfer = (
    target: { itemId: string; layers: number; composition?: CompositionSegment[] },
    dragged: { itemId: string; layers: number; composition?: CompositionSegment[] }
  ) => {
    if (target.composition || dragged.composition) return
    if (target.itemId === dragged.itemId) return
    const store = useCalculator.getState()
    const draggedItem = store.items.find((it) => it.id === dragged.itemId)
    const targetItem = store.items.find((it) => it.id === target.itemId)
    if (!draggedItem || !targetItem) return
    const delta = dragged.layers
    const remaining = draggedItem.quantity - delta
    if (remaining <= 0) store.removeItem(draggedItem.id)
    else store.updateItem(draggedItem.id, { quantity: remaining })
    store.updateItem(targetItem.id, { quantity: targetItem.quantity + delta })
  }

  const handleMergePinned = (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return
    const dragged = pinnedPlacements.find((p) => p.id === draggedId)
    const target = pinnedPlacements.find((p) => p.id === targetId)
    if (!dragged || !target) return
    const plan = planComposedMerge(target, dragged)
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
    })
    removePinned(clampedTripIndex, dragged.id)
    toast.success(`Объединено: ${plan.layers} яр. груза «${target.name}»`)
  }

  const handleMergeManual = (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return
    const dragged = manualPlacements.find((m) => m.id === draggedId)
    const target = manualPlacements.find((m) => m.id === targetId)
    if (!dragged || !target) return
    const plan = planComposedMerge(target, dragged)
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
        manualPlacements: newManual,
        // Only the trip actually being converted moves into manualPlacements
        // — every OTHER trip's pins must survive untouched. This used to be
        // `pinnedPlacementsByTrip: {}`, wiping every other trip's data the
        // instant the user switched to MANUAL from anywhere but trip 0 —
        // there was no way back to it after switching back to AUTO.
        pinnedPlacementsByTrip: { ...pinnedPlacementsByTrip, [clampedTripIndex]: [] },
        selectedPinIds: [],
        activeStampId: null,
        pendingPresetStamp: null,
        activePresetCategory: null,
      })
      useCalculator.getState().remapLashingPointsForRedistribute(matches)
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
        clearanceMargin: m.clearanceMargin,
        // Round 20 — composition-only preservation. `m` is a raw stored
        // ManualPlacement here (not PlacedItem), which already carries
        // `composition` at the type level — straight passthrough.
        composition: m.composition,
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
        activeStampId: null,
        pendingPresetStamp: null,
        activePresetCategory: null,
      })
      useCalculator.getState().remapLashingPointsForRedistribute(matches)
      toast.info('Авто-режим — размещения сохранены как закреплённые')
    }
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
    // Warn user if pinned placements (across all trips) will be cleared —
    // excluding the frozen ones above, which specifically will NOT be reset
    // (in auto mode they're a subset of pinnedPlacementsByTrip; in manual
    // mode they come from manualPlacements, which was never part of this
    // count to begin with, so no adjustment needed there).
    const totalPinnedAllTrips = Object.values(pinnedPlacementsByTrip).reduce((s, list) => s + list.length, 0)
    const totalPinned = mode === 'auto' ? totalPinnedAllTrips - frozenPinned.length : totalPinnedAllTrips
    if (totalPinned > 0) {
      toast.warning(`Незакреплённые размещения (${totalPinned}) будут переставлены заново`)
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
    setVariants(newVariants)
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
        manualPlacements: newManual,
        // Same fix as handleModeChange: don't wipe every trip's pins just
        // because a variant was applied while in manual mode — this had
        // nothing to do with any AUTO trip and shouldn't destroy them.
        pinnedPlacementsByTrip: { ...s.pinnedPlacementsByTrip, [clampedTripIndex]: [] },
        selectedPinIds: [],
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
        pinnedPlacementsByTrip: { ...s.pinnedPlacementsByTrip, [clampedTripIndex]: newPinned },
        manualPlacements: [],
        selectedPinIds: [],
      })
      useCalculator.getState().remapLashingPointsForRedistribute(matches)
    }
  }

  const handleSelectVariant = (variant: PackVariant) => {
    applyVariant(variant)
    toast.info(`Применён: ${variant.label} (${variant.utilizationPct}%)`)
  }

  if (!entered) {
    return <VideoIntro onEnter={handleEnterIntro} />
  }

  return (
    <div className="h-screen flex flex-col bg-muted/30 overflow-hidden">
      {/* Top bar */}
      <header className="shrink-0 border-b bg-background/95 backdrop-blur z-30">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <div className="flex items-center gap-2.5">
            <div className="leading-tight">
              <button
                type="button"
                onClick={handleReplayIntro}
                title="Показать вступительный ролик ещё раз"
                className="text-sm font-bold cursor-pointer hover:opacity-70"
              >
                DeckLoad
              </button>
              <div className="text-[11px] text-muted-foreground hidden sm:block">
                Загрузка палубы
              </div>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleShowTour}
              title="Показать обучение"
              aria-label="Показать обучение"
            >
              <HelpCircle className="h-4 w-4" />
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8" data-tour="vessel-library">
                  <Ship className="h-3.5 w-3.5 sm:mr-1" />
                  <span className="hidden sm:inline">Библиотека судов</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-1.5" align="end">
                <p className="px-1.5 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Библиотека судов
                </p>
                {VESSEL_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    onClick={() => handleApplyVesselTemplate(tpl)}
                    className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
                  >
                    <span className="block">{tpl.label}</span>
                  </button>
                ))}
                <p className="px-1.5 pt-1 text-[10px] text-muted-foreground">
                  Создаёт новый расчёт с палубой и данными судна; груз остаётся пустым.
                </p>
              </PopoverContent>
            </Popover>

            <Button variant="outline" size="sm" className="h-8" onClick={handleExportJson} data-tour="export">
              <Download className="h-3.5 w-3.5 sm:mr-1" />
              <span className="hidden sm:inline">Скачать JSON</span>
            </Button>

            <Button variant="outline" size="sm" className="h-8" onClick={() => importInputRef.current?.click()}>
              <Upload className="h-3.5 w-3.5 sm:mr-1" />
              <span className="hidden sm:inline">Импортировать</span>
            </Button>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={handleImportFile}
            />

            <Button variant="outline" size="sm" className="h-8" onClick={handleExportPdf}>
              <Download className="h-3.5 w-3.5 sm:mr-1" />
              <span className="hidden sm:inline">Скачать PDF</span>
            </Button>

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

      {/* Unplaced-cargo banner — sits outside the scrollable <main> (like the
          header) so it's visible the instant something doesn't fit, instead
          of requiring a scroll all the way down to the bottom of the
          Статистика card to discover it. */}
      {result.unplaced.length > 0 && (
        <div className="shrink-0 border-b bg-red-50 dark:bg-red-950/30 px-4 py-2">
          <div className="flex items-start gap-2 flex-wrap">
            <span className="flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-400 shrink-0">
              <AlertTriangle className="h-3.5 w-3.5" />
              Не поместилось ({result.unplaced.length}):
            </span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {result.unplaced.map((u, i) => (
                <Badge
                  key={`${u.itemId}-${i}`}
                  variant="destructive"
                  className="text-[10px] font-normal"
                  title={u.reason}
                >
                  {u.name} — {u.reason}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Workspace */}
      <div className="flex-1 flex min-h-0">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((v) => !v)}
          onNewCalculation={handleNewCalculation}
          onResetCurrent={handleResetCurrent}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          canUndo={canUndo}
          canRedo={canRedo}
          zoneLoads={zoneLoads}
          onUndo={() => useCalculator.temporal.getState().undo()}
          onRedo={() => useCalculator.temporal.getState().redo()}
        />

        {/* Main content */}
        <main ref={mainRef} className="flex-1 min-w-0 overflow-auto">
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 p-4">
            {/* Visualization */}
            <div className="xl:col-span-8" data-tour="deck-view">
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
                        {viewMode === '3d' ? (
                          <>Вращение/приближение камеры · клик по грузу — выбрать (двигать и вращать — в 2D)</>
                        ) : (
                          <>
                            Вид сверху
                            {deck.gap > 0 && ` · отступ ${deck.gap} ${UNIT_LABEL[deck.unit]}`}
                            {' · выбрали груз? стрелки/Пробел тоже работают'}
                          </>
                        )}
                      </CardDescription>
                    </div>
                    {viewMode === '2d' && (
                      <div className="flex items-center gap-2 text-xs flex-wrap">
                        <LegendDot hatch label="Свободно" />
                        <LegendDot icon="↻" label="Повернут" />
                        {mode === 'auto' && (
                          <LegendDot badge="🔒" badgeColor="#7c3aed" label="Закреплён" />
                        )}
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {trips.length > 1 && (
                    <div className="mb-3 flex flex-wrap items-center gap-1.5">
                      {trips.map((t, i) => (
                        <Button
                          key={i}
                          size="sm"
                          variant={i === clampedTripIndex ? 'default' : 'outline'}
                          className="h-7 px-2.5 text-xs"
                          onClick={() => { setActiveTripIndex(i); clearSelection() }}
                        >
                          Рейс {i + 1} ({t.placedCount}/{t.requestedCount})
                        </Button>
                      ))}
                    </div>
                  )}
                  {viewMode === '3d' ? (
                    <Deck3DView
                      result={result}
                      deckWidth={result.deckWidth}
                      deckLength={result.deckLength}
                      deckOutline={deck.outline}
                      mode={mode}
                      manualPlacements={manualPlacements}
                      pinnedPlacements={pinnedPlacements}
                      onSelectManual={toggleManualSelection}
                      onSelectPin={togglePinSelection}
                      onPinInPlace={(p) => pinFromPlaced(clampedTripIndex, p)}
                    />
                  ) : (
                  <DeckVisualization
                    ref={deckSvgRef}
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
                        pinFromPlaced(clampedTripIndex, placement)
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
                    onRemoveManual={removeManualPlacement}
                    onMergeManual={handleMergeManual}
                    manualPlacements={manualPlacements}
                    pinnedPlacements={pinnedPlacements}
                    selectedPinIds={selectedPinIds}
                    onPinPlaced={(p) => pinFromPlaced(clampedTripIndex, p)}
                    onUpdatePinned={(id, x, y) => updatePinned(clampedTripIndex, id, { x, y })}
                    onUpdatePinnedClearance={(id, margin) => updatePinned(clampedTripIndex, id, { clearanceMargin: margin })}
                    onMergePinned={handleMergePinned}
                    onRemovePinned={handleRemovePinned}
                    onTogglePinLock={handleTogglePinLock}
                    onRotatePinned={handleRotatePinned}
                    onTogglePinSelection={togglePinSelection}
                    onClearSelection={clearSelection}
                    onRotateManual={handleRotateManual}
                    onLayerChangePinned={handleLayerChangePinned}
                    onLayerChangeManual={handleLayerChangeManual}
                    getLayerInfo={(itemId, currentLayers) => {
                      const item = items.find((it) => it.id === itemId)
                      const maxPhys = item ? maxLayersFor(item, deck.clearance) : 1
                      // Stays clickable even when currently blocked by height/quantity —
                      // clicking always explains why via a toast (handleLayerChangePinned/
                      // Manual), rather than presenting a permanently greyed-out button.
                      const canInc = !!item && item.height > 0
                      return {
                        maxPhys,
                        canIncrease: canInc,
                        canDecrease: currentLayers > 1,
                        blockReason: canInc ? undefined : 'У груза не задана высота',
                      }
                    }}
                    selectedManualIds={selectedManualIds}
                    onToggleManualSelection={toggleManualSelection}
                    onClearManualSelection={clearManualSelection}
                    loadZones={deck.loadZones}
                    lashingPoints={deck.lashingPoints}
                    categoryByItemId={categoryByItemId}
                    separationRules={separationRulesInUnit}
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
                  <div className="mt-3 text-xs text-muted-foreground">
                    {result.placedCount}/{result.requestedCount} ед. · Загрузка:{' '}
                    <span className="font-semibold text-foreground">
                      {Math.round(result.utilization * 100)}%
                    </span>
                  </div>
                  <PresetsBar onPlaceCustomShape={handlePlaceCustomShape} />
                </CardContent>
              </Card>
            </div>

            {/* Right panel row 1: placement */}
            <div className="xl:col-span-4">
              <PlacementPanel
                mode={mode}
                tripIndex={clampedTripIndex}
                result={result}
                onAutoRedistribute={handleAutoRedistribute}
                variants={variants}
                onSelectVariant={handleSelectVariant}
              />
            </div>

            {/* Row 2: stats + items, mirrors row 1's 8/4 split. Natural
                height on both — Статистика grows with its content (no
                internal scroll), Грузы keeps its own fixed-height scroll
                list as before. Not height-matched to each other. */}
            <div className="xl:col-span-8 self-start space-y-4">
              <StatsPanel
                result={result}
                unit={deck.unit}
                loadZones={deck.loadZones}
                deckOutline={deck.outline}
                maxDeckCargoT={deck.maxDeckCargoT}
                tenFootContainerCapacity={deck.tenFootContainerCapacity}
              />
              <StabilityPanel
                result={result}
                deckWidth={deck.width}
                deckLength={deck.length}
                unit={deck.unit}
                vessel={deck.vessel}
                shipFrame={deck.shipFrame}
                deckForwardIsPositiveY={deck.deckForwardIsPositiveY}
                items={items}
              />
            </div>
            <div className="xl:col-span-4 self-start" data-tour="cargo-list">
              <ItemList
                result={result}
                unit={deck.unit}
                hoveredItemId={hoveredItemId}
                onHover={handleHover}
                onScrollPageToTop={() => mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
              />
            </div>
          </div>
        </main>
      </div>
      <ProductTour steps={TOUR_STEPS} active={tourActive} onClose={handleCloseTour} />
    </div>
  )
}

function LegendDot({
  color,
  label,
  hatch,
  icon,
  badge,
  badgeColor,
}: {
  color?: string
  label: string
  hatch?: boolean
  icon?: string
  // A tiny emoji-on-color-chip swatch, matching the actual corner badge
  // rendered on a locked/pinned item on the deck (see the `locked` branch
  // in FootprintShape) — distinct from `color`, a plain solid square, so
  // this entry can't be mistaken for the selection outline, which uses the
  // same purple (#7c3aed) for a completely different meaning.
  badge?: string
  badgeColor?: string
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
      ) : badge ? (
        <span
          className="grid h-3.5 w-4 place-items-center rounded-sm text-[8px]"
          style={{ backgroundColor: badgeColor }}
        >
          {badge}
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
