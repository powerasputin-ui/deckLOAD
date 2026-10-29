'use client'

// The blocks of the left panel's «Судно» and «Проверки» sections still kept
// from the old sidebar (spec 13, stage 2: moved as is): «Зоны нагрузки» and
// the selected stack's lashing, each with its own collapsible heading, until
// stage 4 rebuilds them.
import { useContext, useState } from 'react'
// Stable empty-array references for zustand selectors — `s.deck.x ?? []`
// would allocate a new array every call, which useSyncExternalStore treats
// as "the snapshot changed" and re-renders forever.
const EMPTY_ZONES: never[] = []
const EMPTY_POINTS: never[] = []
import {
  Plus,
  ChevronDown,
  ChevronRight,
  Trash2,
  Scale,
  ShieldAlert,
  MapPin,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { isWholeDeckZone, useCalculator, UNIT_LABEL, roundForDisplay } from '@/store/calculator'
import {
  LASHING_DEVICES,
  WIRE_ROPE_SPECS,
  DEFAULT_WIRE_ROPE_TYPE,
  assessLashingRequirement,
  type LashingDeviceType,
  type PinnedPlacement,
  type PlacedItem,
  type ClearanceMargin,
  type ZoneLoadCheck,
  type WireRopeType,
} from '@/lib/packing'
import { segmentLashingInputs, type ComposablePlacement } from '@/lib/placementComposition'
import { BlockOpenState } from '@/components/shell/SectionPanel'
import { cn, fmtNumber } from '@/lib/utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export type PlacementPatch = {
  clearanceMargin?: ClearanceMargin
  lashingWireType?: WireRopeType
  lashingJustification?: string
}


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

export function LoadZonesSection({ zoneLoads }: { zoneLoads?: ZoneLoadCheck[] }) {
  const zones = useCalculator((s) => s.deck.loadZones ?? EMPTY_ZONES)
  const unit = useCalculator((s) => s.deck.unit)
  const addLoadZone = useCalculator((s) => s.addLoadZone)
  const updateLoadZone = useCalculator((s) => s.updateLoadZone)
  const removeLoadZone = useCalculator((s) => s.removeLoadZone)
  const deckWidth = useCalculator((s) => s.deck.width)
  const deckLength = useCalculator((s) => s.deck.length)

  return (
    <Section
      icon={<Scale className="h-4 w-4" />}
      title="Зоны нагрузки"
      badge={zones.length}
      defaultOpen={false}
      tourId="load-zones"
    >
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Лимит — это ПЛОТНОСТЬ (тонны на каждый квадратный метр площади зоны), не общий вес зоны целиком. Лимит «2» на зоне 5×4 м (20 м²) значит зона держит до 2×20 = 40 т в сумме, не 2 т. Превышение — мягкое предупреждение, груз не блокируется.
        </p>
        {zones.map((z, i) => {
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
              {/* Named as «Проверки» names it (planFacts' zone label). */}
              <div className="text-xs font-medium">
                Зона {i + 1}
                {isWholeDeckZone(z, deckWidth, deckLength) && ' (вся палуба)'}
              </div>
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
  const selectedWireType: WireRopeType = selectedPlacement?.lashingWireType ?? DEFAULT_WIRE_ROPE_TYPE
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

