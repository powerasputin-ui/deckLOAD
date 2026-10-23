'use client'

// The blocks of the left panel's «Судно» and «Проверки» sections (spec 13,
// stage 2: today's content, moved as is). Stages 3–4 rebuild them; until
// then each keeps its own collapsible heading.
import { useContext, useId, useState } from 'react'
// Stable empty-array references for zustand selectors — `s.deck.x ?? []`
// would allocate a new array every call, which useSyncExternalStore treats
// as "the snapshot changed" and re-renders forever.
const EMPTY_ZONES: never[] = []
const EMPTY_POINTS: never[] = []
import {
  Plus,
  Settings2,
  Layers,
  ChevronDown,
  ChevronRight,
  Trash2,
  Anchor,
  Scale,
  ShieldAlert,
  MapPin,
  Ship,
  AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useCalculator, UNIT_LABEL, roundForDisplay, convertLength, isWholeDeckZone, type Unit } from '@/store/calculator'
import {
  LASHING_DEVICES,
  WIRE_ROPE_SPECS,
  assessLashingRequirement,
  type SortStrategy,
  type LashingDeviceType,
  type PinnedPlacement,
  type PlacedItem,
  type ClearanceMargin,
  type ZoneLoadCheck,
  type WireRopeType,
} from '@/lib/packing'
import { DEFAULT_VESSEL_PARTICULARS, type VesselParticulars } from '@/lib/stability'
import { vesselTemplateById } from '@/lib/vesselTemplates'
import { segmentLashingInputs, type ComposablePlacement } from '@/lib/placementComposition'
import { DEFAULT_CATEGORIES } from '@/components/calculator/ItemList'
import { BlockOpenState } from '@/components/shell/SectionPanel'
import { NumberField } from '@/components/calculator/NumberField'
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
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui/toggle-group'

export type PlacementPatch = {
  clearanceMargin?: ClearanceMargin
  lashingWireType?: WireRopeType
  lashingJustification?: string
}

// No real vessel's cargo deck comes anywhere close to this — the largest
// container ships afloat run well under 500 m LOA. Without a cap, a stray
// extra digit (e.g. typing "999999999" instead of "20") silently collapses
// the whole deck to a sliver a few px tall on screen and every placed item
// becomes unplaceable, with no error explaining why — this clamp turns that
// into a normal, explained validation instead.
const MAX_DECK_DIMENSION_M = 1000

export function Section({
  icon,
  title,
  badge,
  children,
  defaultOpen = true,
  openWhen,
  tourId,
}: {
  icon: React.ReactNode
  title: string
  badge?: number
  children: React.ReactNode
  defaultOpen?: boolean
  // Opens the section whenever this turns true (it can still be collapsed):
  // for a section holding something that waits on the user.
  openWhen?: boolean
  // Optional anchor for ProductTour (src/components/onboarding/ProductTour.tsx)
  // — placed on the outer div so the section stays a valid tour target even
  // collapsed (children unmount when `open` is false, the header never does).
  tourId?: string
}) {
  // Open or closed as the user last left it in this page (see BlockOpenState).
  const remembered = useContext(BlockOpenState)
  const [open, setOpenState] = useState(() => remembered?.get(title) ?? (defaultOpen || !!openWhen))
  const setOpen = (next: boolean) => {
    remembered?.set(title, next)
    setOpenState(next)
  }
  const [prevOpenWhen, setPrevOpenWhen] = useState(openWhen)
  if (openWhen !== prevOpenWhen) {
    setPrevOpenWhen(openWhen)
    if (openWhen) setOpen(true)
  }
  return (
    <div data-tour={tourId}>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="group mb-2 flex w-full items-center gap-2 text-left"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 text-ink-2" />
        ) : (
          <ChevronRight className="h-4 w-4 text-ink-2" />
        )}
        <span className="text-ink-2 transition-colors group-hover:text-foreground">
          {icon}
        </span>
        <span className="text-sm font-semibold">
          {title}
        </span>
        {badge !== undefined && (
          <Badge variant="secondary" className="ml-auto text-xs h-4 px-1.5">
            {badge}
          </Badge>
        )}
      </button>
      {open && <div className="pl-1">{children}</div>}
    </div>
  )
}

export function DeckSettings() {
  const deck = useCalculator((s) => s.deck)
  const setDeck = useCalculator((s) => s.setDeck)
  const setUnit = useCalculator((s) => s.setUnit)
  const sortStrategy = useCalculator((s) => s.sortStrategy)
  const setSortStrategy = useCalculator((s) => s.setSortStrategy)
  const uid = useId()
  const maxDeckInUnit = convertLength(MAX_DECK_DIMENSION_M, 'm', deck.unit)

  // Every field here applies on Enter/blur, not per keystroke: setDeck()
  // reflows and clamps the placements already on the deck whenever the size,
  // gap, board offset or clearance changes, and a transient "2" on the way to
  // "24" would rearrange (or discard stacked layers from) the user's layout
  // for good. See NumberField.
  return (
    <Section icon={<Settings2 className="h-4 w-4" />} title="Палуба" tourId="deck-settings">
      <div className="space-y-2.5">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label htmlFor={`${uid}-width`} className="text-xs text-muted-foreground">Ширина</label>
            <NumberField
              id={`${uid}-width`}
              min={0.1}
              max={maxDeckInUnit}
              step={0.1}
              value={deck.width}
              onClamp={({ bound, limit }) => {
                if (bound === 'max') toast.warning(`Максимальная ширина палубы — ${fmtNumber(limit)} ${UNIT_LABEL[deck.unit]}`)
              }}
              onCommit={(v) => setDeck({ width: v })}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor={`${uid}-length`} className="text-xs text-muted-foreground">Длина</label>
            <NumberField
              id={`${uid}-length`}
              min={0.1}
              max={maxDeckInUnit}
              step={0.1}
              value={deck.length}
              onClamp={({ bound, limit }) => {
                if (bound === 'max') toast.warning(`Максимальная длина палубы — ${fmtNumber(limit)} ${UNIT_LABEL[deck.unit]}`)
              }}
              onCommit={(v) => setDeck({ length: v })}
              className="h-8 text-xs"
            />
          </div>
        </div>
        <div className="space-y-1">
          <label htmlFor={`${uid}-gap`} className="text-xs text-muted-foreground flex items-center gap-1">
            <Layers className="h-3 w-3" /> Отступ между грузами
          </label>
          <div className="flex items-center gap-1.5">
            <NumberField
              id={`${uid}-gap`}
              min={0}
              step={0.05}
              value={deck.gap}
              onCommit={(v) => setDeck({ gap: v })}
              className="h-8 text-xs flex-1"
            />
            <span className="text-xs text-muted-foreground w-6">{UNIT_LABEL[deck.unit]}</span>
          </div>
        </div>
        <div className="space-y-1">
          <label htmlFor={`${uid}-offset`} className="text-xs text-muted-foreground flex items-center gap-1">
            <Anchor className="h-3 w-3" /> Отступ от борта
          </label>
          <div className="flex items-center gap-1.5">
            <NumberField
              id={`${uid}-offset`}
              min={0}
              step={0.05}
              value={deck.boardOffset}
              onCommit={(v) => setDeck({ boardOffset: v })}
              className="h-8 text-xs flex-1"
            />
            <span className="text-xs text-muted-foreground w-6">{UNIT_LABEL[deck.unit]}</span>
          </div>
        </div>
        <div className="space-y-1">
          <label htmlFor={`${uid}-clearance`} className="text-xs text-muted-foreground flex items-center gap-1">
            <Layers className="h-3 w-3" /> Предельная высота штабеля
          </label>
          <div className="flex items-center gap-1.5">
            <NumberField
              id={`${uid}-clearance`}
              min={0}
              step={0.1}
              value={deck.clearance}
              onCommit={(v) => setDeck({ clearance: v })}
              className="h-8 text-xs flex-1"
            />
            <span className="text-xs text-muted-foreground w-6">{UNIT_LABEL[deck.unit]}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            0 — палуба высоту не ограничивает: ярусов столько, сколько указано
            в «Ярусов» у груза, а если там 0 — один. Больше 0 — штабель не выше
            этой высоты и не больше «Ярусов»
          </p>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Единицы</label>
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
          <label className="text-xs text-muted-foreground">Стратегия упаковки</label>
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

export function LoadZonesSection({ zoneLoads }: { zoneLoads?: ZoneLoadCheck[] }) {
  const zones = useCalculator((s) => s.deck.loadZones ?? EMPTY_ZONES)
  const unit = useCalculator((s) => s.deck.unit)
  const addLoadZone = useCalculator((s) => s.addLoadZone)
  const updateLoadZone = useCalculator((s) => s.updateLoadZone)
  const removeLoadZone = useCalculator((s) => s.removeLoadZone)
  const vesselTemplateId = useCalculator((s) => s.deck.vesselTemplateId)
  const strengthChoice = useCalculator((s) => s.deck.deckStrengthChoiceTPerM2)
  const deckWidth = useCalculator((s) => s.deck.width)
  const deckLength = useCalculator((s) => s.deck.length)
  const chooseDeckStrength = useCalculator((s) => s.chooseDeckStrength)

  // A library vessel whose sources disagree on deck strength: the limit is
  // never picked for the user. The choice stays here, on top, until made.
  const vessel = vesselTemplateById(vesselTemplateId)
  const strength = vessel?.limits?.deckStrengthTPerM2
  const strengthPending = !!strength && strengthChoice === undefined
  const strengthZoneMissing =
    !!strength && strengthChoice !== undefined && !zones.some((z) => isWholeDeckZone(z, deckWidth, deckLength))

  return (
    <Section
      icon={<Scale className="h-4 w-4" />}
      title="Зоны нагрузки"
      badge={zones.length}
      defaultOpen={false}
      openWhen={strengthPending}
      tourId="load-zones"
    >
      <div className="space-y-2">
        {vessel && strength && (
          <div
            className={cn(
              'rounded-md border p-2 space-y-1.5',
              strengthPending && 'border-amber-300 bg-amber-50/60 dark:bg-amber-950/20'
            )}
          >
            {strengthPending ? (
              <div className="flex items-center gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Лимит прочности палубы не выбран
              </div>
            ) : (
              <div className="text-xs font-medium">
                Прочность палубы: {fmtNumber(strengthChoice ?? 0)} т/м²
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              «{vessel.label}»: источники расходятся ({strength.sources}). Выбор задаёт зону нагрузки на всю палубу.
            </p>
            {strengthZoneMissing && (
              <p className="text-xs text-amber-800 dark:text-amber-300">
                Зоны на всю палубу нет, лимит не проверяется. Нажмите выбранное значение, чтобы вернуть её.
              </p>
            )}
            <div className="flex gap-1.5">
              {(strength.min === strength.max ? [strength.min] : [strength.min, strength.max]).map((v) => (
                <Button
                  key={v}
                  size="sm"
                  variant={strengthChoice === v ? 'default' : 'outline'}
                  aria-pressed={strengthChoice === v}
                  className="h-7 flex-1 text-xs"
                  onClick={() => chooseDeckStrength(v)}
                >
                  {fmtNumber(v)} т/м²
                </Button>
              ))}
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
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
                <MiniNumField label="X" value={z.x} unit={UNIT_LABEL[unit]} onChange={(v) => updateLoadZone(z.id, { x: v })} />
                <MiniNumField label="Y" value={z.y} unit={UNIT_LABEL[unit]} onChange={(v) => updateLoadZone(z.id, { y: v })} />
                <MiniNumField label="Шир." value={z.width} unit={UNIT_LABEL[unit]} onChange={(v) => updateLoadZone(z.id, { width: v })} />
                <MiniNumField label="Длин." value={z.length} unit={UNIT_LABEL[unit]} onChange={(v) => updateLoadZone(z.id, { length: v })} />
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
              <p className="text-xs text-muted-foreground">
                Держит до {fmtNumber(capacityT)} т суммарно ({fmtNumber(z.maxLoadPerArea)} т/м² × {fmtNumber(areaM2)} м²)
              </p>
              {load && (
                <p
                  className={cn(
                    'text-xs tabular-nums',
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

export function SeparationRulesSection() {
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
    <Section icon={<ShieldAlert className="h-4 w-4" />} title="Сепарация груза" badge={rules.length} defaultOpen={false} tourId="separation">
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
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
            <NumberField
              aria-label="Минимальное расстояние, м"
              min={0}
              step={0.5}
              value={minDistance}
              onCommit={setMinDistance}
              className="h-7 text-xs flex-1"
            />
            <span className="text-xs text-muted-foreground">м</span>
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

export function LashingPointsSection({
  autoStack,
  onPatchAutoStack,
}: {
  autoStack?: PlacedItem
  onPatchAutoStack?: (placed: PlacedItem, patch: PlacementPatch) => void
}) {
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
  const selectedPlacement:
    | (ComposablePlacement & {
        id?: string
        name: string
        clearanceMargin?: ClearanceMargin
        lashingWireType?: WireRopeType
        lashingJustification?: string
      })
    | undefined =
    selectedManual ?? selectedPin ?? (autoStack && { itemId: autoStack.itemId, name: autoStack.name, layers: autoStack.layers })
  // Whether "zone" mode is active must NOT depend on the current value being
  // nonzero — while typing a value like "0,4", the field passes through an
  // intermediate 0, and if that briefly counted as "back to points mode" the
  // whole toggle (and the input itself) would flicker away mid-edit. Mode is
  // tracked by whether a margin is set AT ALL, not by its size.
  const selectedHasClearance = selectedPlacement?.clearanceMargin !== undefined
  const updateSelectedPlacement = (patch: PlacementPatch) => {
    if (selectedManual) updateManualPlacement(selectedManual.id, patch)
    else if (selectedPin && selectedPinTrip !== undefined) updatePinned(selectedPinTrip, selectedPin.id, patch)
    else if (autoStack) onPatchAutoStack?.(autoStack, patch)
  }
  const updateClearanceSide = (side: keyof ClearanceMargin, v: number) => {
    const current = selectedPlacement?.clearanceMargin ?? { top: 0, right: 0, bottom: 0, left: 0 }
    updateSelectedPlacement({ clearanceMargin: { ...current, [side]: Math.max(0, v) } })
  }
  // An auto-placed stack has no id yet, so nothing is attached to it.
  const selectedPointsCount = selectedPlacement?.id
    ? points.filter((p) => p.placementId === selectedPlacement.id).length
    : 0
  const selectedWireType: WireRopeType = selectedPlacement?.lashingWireType ?? 'wire_19_5_g1zhn_1670'
  // Round 19: per-segment assessment — a composed placement can span
  // multiple distinct categories (e.g. ordinary cargo + dangerous goods),
  // so it's assessed as N independent verdicts (one per constituent
  // segment) instead of one verdict using only the nominal itemId's own
  // category. Degenerates to exactly one entry, numerically identical to
  // the pre-Round-19 single assessLashingRequirement call, for every
  // existing (uncomposed) placement — segmentLashingInputs's own doc
  // comment covers why. assessLashingRequirement wraps requiredLashingCount
  // with an honest status — see its own doc comment in packing.ts for why a
  // bare number can't tell "0 required", "not enough data to say", and
  // "this methodology doesn't apply to this cargo" apart.
  const selectedAssessments = selectedPlacement
    ? segmentLashingInputs(selectedPlacement, items).map((seg) => ({
        ...seg,
        assessment: assessLashingRequirement(seg.category, seg.weightKg, WIRE_ROPE_SPECS[selectedWireType].breakingLoadKN),
      }))
    : []
  // `attachedCount` is a SHARED, placement-level physical count (C3 — lashing
  // points attach to the real stack, not to an individual constituent), so
  // it's compared against the most demanding segment's own requirement, not
  // a sum across segments (physical points can simultaneously satisfy more
  // than one segment's requirement) — see the migration plan's own I section.
  const selectedRequiredCountTotal = selectedAssessments.reduce(
    (max, seg) => (seg.assessment.status === 'calculated' ? Math.max(max, seg.assessment.requiredCount ?? 0) : max),
    0
  )

  return (
    <Section icon={<MapPin className="h-4 w-4" />} title="Крепление груза" badge={points.length} defaultOpen={false} tourId="lashing">
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Клик по грузу, затем по палубе — привязывает линию крепления с расчётом усилия по IMO CSS Code
          (упрощённый метод). Мягкая проверка — груз не блокируется. Точка без привязки — просто метка на схеме.
        </p>

        {/* Mode toggle for the currently selected placement — lashing points
            and a clearance zone are mutually exclusive per placement, so
            switching one off clears the other. */}
        {selectedPlacement && (
          <div className="rounded-md border p-2 space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground truncate">
              Режим для «{selectedPlacement.name}»
            </div>
            <div className="grid grid-cols-2 gap-1">
              <Button
                size="sm"
                variant={!selectedHasClearance ? 'default' : 'outline'}
                className="h-6 text-xs px-1"
                // Already in this mode: nothing to change (and nothing to pin).
                onClick={() => selectedHasClearance && updateSelectedPlacement({ clearanceMargin: undefined })}
              >
                Точки крепления
              </Button>
              <Button
                size="sm"
                variant={selectedHasClearance ? 'default' : 'outline'}
                className="h-6 text-xs px-1"
                onClick={() => {
                  if (selectedPlacement.id) clearLashingPointsFor(selectedPlacement.id)
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
                className="h-6 text-xs w-full text-destructive hover:text-destructive"
                onClick={() => selectedPlacement.id && clearLashingPointsFor(selectedPlacement.id)}
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Снять все точки ({selectedPointsCount}) с этого груза
              </Button>
            )}
          </div>
        )}

        {/* Round 19: one verdict block PER SEGMENT — a composed placement's
            constituents can have different categories (e.g. ordinary cargo +
            dangerous goods), so each gets its own independent verdict rather
            than one verdict computed from only the nominal itemId's category.
            A segment label is shown only when there's more than one segment
            (uncomposed placements render byte-for-byte the same single block
            as before Round 19). */}
        {selectedPlacement && selectedAssessments.map((seg, idx) => {
          const segLabel =
            selectedAssessments.length > 1
              ? `${items.find((it) => it.id === seg.itemId)?.name ?? seg.itemId} (${seg.layers} ед., ${Math.round(seg.weightKg)} кг): `
              : null
          if (seg.assessment.status === 'not-applicable') {
            return (
              <div
                key={`${seg.itemId}-${idx}`}
                className="rounded-md border border-red-300 bg-red-50/60 dark:bg-red-950/20 p-2 text-xs text-red-800 dark:text-red-300 flex gap-1.5"
              >
                <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  {segLabel && <b>{segLabel}</b>}
                  <b>Категория «{seg.category}» — груз для IMDG Code.</b> Это два разных контура: классификация,
                  сегрегация и документация — по IMDG Code (вне этого приложения, согласуйте с грузоотправителем/капитаном
                  по опасным грузам); механическая прочность самого крепления — отдельная проверка, не подменяет IMDG.
                  РД 31.11.21.23-96 к этой категории не применим, числа не показываем. Дистанции от другого груза
                  задаются в разделе «Сепарация груза». Для проверки прочности крепления смотрите индикатор у
                  прикреплённых точек на схеме (силовой баланс по IMO CSS Code Annex 13 считается уже сейчас).
                </span>
              </div>
            )
          }
          if (seg.assessment.status === 'insufficient-data') {
            return (
              <div key={`${seg.itemId}-${idx}`} className="rounded-md border p-2 text-xs text-muted-foreground">
                {segLabel && <b>{segLabel}</b>}
                Недостаточно данных для оценки: {seg.assessment.missingInputs?.join(', ')}.
              </div>
            )
          }
          if (seg.assessment.status === 'calculated') {
            return (
              <div key={`${seg.itemId}-${idx}`} className="rounded-md border p-2 text-xs font-medium text-muted-foreground">
                {segLabel && <div className="mb-0.5">{segLabel}</div>}
                {seg.assessment.methodology === 'metal-rd' && (
                  <>РД 31.11.21.23-96 (п. 2.2.3): требуется найтовов — {seg.assessment.requiredCount}</>
                )}
                {seg.assessment.methodology === 'general' && (
                  <>
                    Ориентировочное количество найтовов: {seg.assessment.requiredCount}
                    <div className="font-normal text-muted-foreground/70 mt-0.5">
                      Не является нормативным расчётом крепления.
                    </div>
                  </>
                )}
              </div>
            )
          }
          return null
        })}

        {/* Wire type / attached-point count / justification stay SHARED,
            placement-level (C3 — lashing points attach to the physical
            stack, not a specific constituent) — rendered once, gated on at
            least one segment actually having a real requirement, and
            compared against the max requirement across segments. */}
        {selectedPlacement && selectedAssessments.some((s) => s.assessment.status === 'calculated') && (
          <div className="rounded-md border p-2 space-y-1.5">
            <Select
              value={selectedWireType}
              onValueChange={(v) => updateSelectedPlacement({ lashingWireType: v as WireRopeType })}
            >
              <SelectTrigger className="h-6 w-full text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(WIRE_ROPE_SPECS).map(([key, w]) => (
                  <SelectItem key={key} value={key}>{w.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="text-xs text-muted-foreground">
              Прикреплено точек к этому грузу: {selectedPointsCount}
            </div>
            {selectedPointsCount < selectedRequiredCountTotal && (
              <div className="space-y-1">
                <div className="text-xs text-destructive">
                  Меньше расчётного числа — укажите обоснование (идёт в PDF)
                </div>
                <textarea
                  className="w-full rounded border bg-transparent text-xs p-1.5 min-h-[44px] resize-y"
                  placeholder="Например: груз на деревянной клети между бортовыми стенками, доп. крепление сверх клети не требуется по проекту"
                  value={selectedPlacement.lashingJustification ?? ''}
                  onChange={(e) => updateSelectedPlacement({ lashingJustification: e.target.value })}
                />
              </div>
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
                    <SelectTrigger className="h-6 w-full text-xs"><SelectValue /></SelectTrigger>
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
          <p className="text-xs text-muted-foreground">
            Закреплено грузов: {new Set(points.filter((p) => p.placementId).map((p) => p.placementId)).size} ·
            {' '}точек с расчётом: {attachedCount}
          </p>
        )}
      </div>
    </Section>
  )
}

export function VesselStabilitySection() {
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
  const addVariableWeight = useCalculator((s) => s.addVariableWeight)
  const updateVariableWeight = useCalculator((s) => s.updateVariableWeight)
  const removeVariableWeight = useCalculator((s) => s.removeVariableWeight)

  const [knText, setKnText] = useState('')
  const [knError, setKnError] = useState<string | null>(null)

  const particulars = vessel?.particulars ?? DEFAULT_VESSEL_PARTICULARS
  // Soft plausibility check, not a hard validation — `longitudinalOrigin`
  // is a label on how the user is READING their own booklet's numbers,
  // never converted or enforced anywhere in the calculation (see
  // buildLoadingConditionFromPlacements — lightshipLCG goes in raw). If
  // Лёгкий LCG falls well outside the range that convention could
  // plausibly produce for this hull length, the two most likely
  // explanations are: the wrong convention is selected here, or the value
  // was copied in from a source using the other one — either way, silently
  // computing a confident-looking wrong trim is worse than a warning.
  const lcgPlausibilityWarning = (() => {
    const lbp = particulars.lengthBpp
    const lcg = particulars.lightshipLCG
    if (!(lbp > 0) || lcg === 0) return null
    const margin = Math.max(5, lbp * 0.1)
    const [lo, hi] =
      particulars.longitudinalOrigin === 'aft-perpendicular' ? [-margin, lbp + margin] : [-lbp / 2 - margin, lbp / 2 + margin]
    if (lcg < lo || lcg > hi) {
      return `Лёгкий LCG ${fmtNumber(lcg)} м не похож на «${
        particulars.longitudinalOrigin === 'aft-perpendicular' ? 'от кормового перпендикуляра' : 'от миделя'
      }» при LBP ${fmtNumber(lbp)} м — проверьте точку отсчёта.`
    }
    return null
  })()
  const points = vessel?.hydrostatics.points ?? []
  const knCurves = vessel?.knCurves
  const variableWeights = vessel?.variableWeights ?? []

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
        <p className="text-xs text-muted-foreground">
          Ознакомительный/плановый расчёт — не заменяет одобренный классом судовой прибор загрузки. Данные: <b>{statusLabel}</b>.
        </p>

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Судно</p>
          <Input
            placeholder="Название судна"
            value={particulars.name ?? ''}
            onChange={(e) => setVesselParticulars({ name: e.target.value || undefined })}
            className="h-7 text-xs"
          />
          <div className="grid grid-cols-3 gap-1">
            <MiniNumField label="Длина LBP" value={particulars.lengthBpp} unit="м" onChange={(v) => setVesselParticulars({ lengthBpp: v })} />
            <MiniNumField label="Ширина" value={particulars.breadth} unit="м" onChange={(v) => setVesselParticulars({ breadth: v })} />
            <MiniNumField
              label="Угол заливания"
              value={particulars.downfloodingAngleDeg ?? 0}
              unit="°"
              onChange={(v) => setVesselParticulars({ downfloodingAngleDeg: v > 0 ? v : undefined })}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Угол заливания опционален (0 = не задан, используются стандартные 30°/40°) — задайте, если он меньше, для честной площади под GZ (IS Code 2008, п. 2.2.1).
          </p>
          <div className="grid grid-cols-2 gap-1">
            <MiniNumField label="Лёгкий вес" value={particulars.lightshipWeightKg} unit="кг" onChange={(v) => setVesselParticulars({ lightshipWeightKg: v })} />
            <MiniNumField label="Лёгкий KG" value={particulars.lightshipKG} unit="м" onChange={(v) => setVesselParticulars({ lightshipKG: v })} />
            <MiniNumField label="Лёгкий LCG" value={particulars.lightshipLCG} unit="м" onChange={(v) => setVesselParticulars({ lightshipLCG: v })} />
            <MiniNumField label="Лёгкий TCG" value={particulars.lightshipTCG} unit="м" onChange={(v) => setVesselParticulars({ lightshipTCG: v })} />
          </div>
          <div className="space-y-0.5">
            <label className="text-xs text-muted-foreground leading-none block">Точка отсчёта LCG/LCF/LCB</label>
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
            <p className="text-xs text-muted-foreground">
              Это относится ТОЛЬКО к подписи в этом разделе — Лёгкий LCG, LCG переменных грузов и «Центр палубы
              от миделя / от КП» ниже должны быть заданы на одной и той же оси, иначе судно и груз молча окажутся
              на разных шкалах.
            </p>
            {lcgPlausibilityWarning && (
              <p className="text-xs text-amber-600 dark:text-amber-500">⚠ {lcgPlausibilityWarning}</p>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Переменные грузы (танки/балласт/топливо/вода)
          </p>
          <p className="text-xs text-muted-foreground">
            Без этого GM показывается без поправки на свободную поверхность — реальная остойчивость может быть ниже.
          </p>
          {variableWeights.map((w) => (
            <div key={w.id} className="rounded-md border p-1.5 space-y-1">
              <div className="flex items-center gap-1">
                <Input
                  value={w.name}
                  onChange={(e) => updateVariableWeight(w.id, { name: e.target.value })}
                  className="h-6 text-xs flex-1"
                  placeholder="Название (напр. Балласт форпик)"
                />
                <button
                  onClick={() => removeVariableWeight(w.id)}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-destructive"
                  title="Удалить"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1">
                <MiniNumField label="Вес" value={w.weightKg} unit="кг" onChange={(v) => updateVariableWeight(w.id, { weightKg: v })} />
                <MiniNumField label="VCG" value={w.vcgM} unit="м" onChange={(v) => updateVariableWeight(w.id, { vcgM: v })} />
                <MiniNumField label="TCG" value={w.tcgM} unit="м" onChange={(v) => updateVariableWeight(w.id, { tcgM: v })} />
              </div>
              <div className="grid grid-cols-2 gap-1">
                <MiniNumField label="LCG" value={w.lcgM} unit="м" onChange={(v) => updateVariableWeight(w.id, { lcgM: v })} />
                <MiniNumField
                  label="Момент своб. пов."
                  value={w.freeSurfaceMomentTm ?? 0}
                  unit="т·м"
                  // Store whatever the user typed, 0 included — the check
                  // this field feeds (StabilityPanel's NoFreeSurfaceDataWarning,
                  // keyed on `(w.freeSurfaceMomentTm ?? 0) !== 0`) exists
                  // specifically to tell "confirmed genuinely zero" apart
                  // from "never entered." Coercing 0 back to undefined (as
                  // this used to) made that distinction impossible to
                  // express through this form at all — every zero silently
                  // became "not entered," so the tank could never leave the
                  // "unconfirmed" bucket the warning is built to flag.
                  onChange={(v) => updateVariableWeight(w.id, { freeSurfaceMomentTm: v })}
                />
              </div>
            </div>
          ))}
          <Button size="sm" variant="outline" className="h-7 text-xs w-full" onClick={() => addVariableWeight()}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Добавить переменный груз
          </Button>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Система координат палубы</p>
          <div className="grid grid-cols-3 gap-1">
            <MiniNumField
              label="Центр палубы от ДП"
              value={shipFrame?.originOffsetFromCenterlineM ?? 0}
              unit="м"
              onChange={(v) => setShipFrame({ originOffsetFromCenterlineM: v })}
            />
            <MiniNumField
              // Follows the "Точка отсчёта LCG/LCF/LCB" selection above —
              // this offset locates the DECK RECTANGLE'S OWN CENTRE (not
              // its aft/forward edge) on whichever axis that selection
              // names, per DeckShipFrame's own doc comment in stability.ts.
              label={particulars.longitudinalOrigin === 'aft-perpendicular' ? 'Центр палубы от КП' : 'Центр палубы от миделя'}
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
            <span className="text-xs text-muted-foreground">Нос палубы: {forwardIsPositiveY ? '+Y' : '−Y'}</span>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-xs px-2"
              onClick={() => setDeckForwardIsPositiveY(!forwardIsPositiveY)}
            >
              Сменить
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Гидростатика (по водоизмещению)</p>
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
          <p className="text-xs text-muted-foreground">
            LCB/MTC опциональны — без них расчёт дифферента недоступен (только GM и крен).
          </p>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Кросс-кривые KN (для полной кривой GZ)</p>
          {knCurves ? (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
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
              <p className="text-xs text-muted-foreground">
                Вставьте из формуляра остойчивости: первая строка — углы крена через запятую, далее по строке на
                каждое водоизмещение (водоизмещение, KN...). Пример:
                <br />0,10,20,30,40
                <br />2000000,0,1.2,2.3,3.1,3.6
              </p>
              <textarea
                value={knText}
                onChange={(e) => setKnText(e.target.value)}
                rows={3}
                className="w-full rounded-md border p-1.5 text-xs font-mono"
                placeholder={'0,10,20,30,40\n2000000,0,1.2,2.3,3.1,3.6'}
              />
              {knError && <p className="text-xs text-destructive">{knError}</p>}
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
      <label className="text-xs text-muted-foreground leading-none block">
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
        className="h-6 text-xs px-1"
      />
    </div>
  )
}

