'use client'

import { useId } from 'react'
import { Plus, ShieldAlert, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { NumberField } from '@/components/calculator/NumberField'
import { useCalculator, UNIT_LABEL } from '@/store/calculator'
import {
  LASHING_DEVICES,
  WIRE_ROPE_SPECS,
  DEFAULT_WIRE_ROPE_TYPE,
  assessLashingRequirement,
  type ClearanceMargin,
  type LashingDeviceType,
  type PinnedPlacement,
  type PlacedItem,
  type WireRopeType,
} from '@/lib/packing'
import { segmentLashingInputs, type ComposablePlacement } from '@/lib/placementComposition'
import { lashingShortfall } from '@/lib/planFacts'
import { cn } from '@/lib/utils'

// Stable empty-array reference for the zustand selector — a fresh `[]` every
// call reads as "the snapshot changed" and re-renders forever.
const EMPTY_POINTS: never[] = []

export type PlacementPatch = {
  clearanceMargin?: ClearanceMargin
  lashingWireType?: WireRopeType
  lashingJustification?: string
}

// «Крепление» in the inspector (spec 6.5): how the selected stack is
// secured — lashing points, or a clearance zone around it instead — the
// wire, what the norms ask of it, its points with their device, MSL and
// angle, and adding or taking them off. It was the sidebar's «Крепление
// груза». A point tied to no stack is «Судно»'s.
//
// It acts on the stack selected on the deck, whichever trip its pin is on;
// a stack the auto-packer placed has no record yet, so the first change
// pins it (onPatchAutoStack).
export function StackLashing({
  autoStack,
  onPatchAutoStack,
}: {
  autoStack?: PlacedItem
  onPatchAutoStack?: (placed: PlacedItem, patch: PlacementPatch) => void
}) {
  const points = useCalculator((s) => s.deck.lashingPoints ?? EMPTY_POINTS)
  const items = useCalculator((s) => s.items)
  const unit = useCalculator((s) => s.deck.unit)
  const mode = useCalculator((s) => s.mode)
  const selectedManualIds = useCalculator((s) => s.selectedManualIds)
  const selectedPinIds = useCalculator((s) => s.selectedPinIds)
  const manualPlacements = useCalculator((s) => s.manualPlacements)
  const pinnedPlacementsByTrip = useCalculator((s) => s.pinnedPlacementsByTrip)
  const updateManualPlacement = useCalculator((s) => s.updateManualPlacement)
  const updatePinned = useCalculator((s) => s.updatePinned)
  const removeLashingPoint = useCalculator((s) => s.removeLashingPoint)
  const updateLashingPoint = useCalculator((s) => s.updateLashingPoint)
  const clearLashingPointsFor = useCalculator((s) => s.clearLashingPointsFor)
  const placingLashingPoint = useCalculator((s) => s.placingLashingPoint)
  const setPlacingLashingPoint = useCalculator((s) => s.setPlacingLashingPoint)
  const deck = useCalculator((s) => s.deck)
  const uid = useId()
  const u = UNIT_LABEL[unit]

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
  const placement:
    | (ComposablePlacement & {
        id?: string
        name: string
        clearanceMargin?: ClearanceMargin
        lashingWireType?: WireRopeType
        lashingJustification?: string
      })
    | undefined = selectedManual ?? selectedPin ?? (autoStack && { itemId: autoStack.itemId, name: autoStack.name, layers: autoStack.layers })
  if (!placement) return null

  // Zone mode is on as soon as a margin is set at all, whatever its size:
  // while typing «0,4» the value passes through 0, and the fields must not
  // vanish mid-edit.
  const zoned = placement.clearanceMargin !== undefined
  const patch = (p: PlacementPatch) => {
    if (selectedManual) updateManualPlacement(selectedManual.id, p)
    else if (selectedPin && selectedPinTrip !== undefined) updatePinned(selectedPinTrip, selectedPin.id, p)
    else if (autoStack) onPatchAutoStack?.(autoStack, p)
  }
  const setSide = (side: keyof ClearanceMargin, v: number) => {
    const current = placement.clearanceMargin ?? { top: 0, right: 0, bottom: 0, left: 0 }
    patch({ clearanceMargin: { ...current, [side]: Math.max(0, v) } })
  }
  // An auto-placed stack has no id yet, so nothing is attached to it.
  const own = placement.id ? points.filter((p) => p.placementId === placement.id) : []
  const wire: WireRopeType = placement.lashingWireType ?? DEFAULT_WIRE_ROPE_TYPE
  // One verdict per cargo in the stack (Round 19): a mixed stack can hold an
  // ordinary cargo and dangerous goods, each judged by its own rule.
  const assessments = segmentLashingInputs(placement, items).map((seg) => ({
    ...seg,
    assessment: assessLashingRequirement(seg.category, seg.weightKg, WIRE_ROPE_SPECS[wire].breakingLoadKN),
  }))
  // Points belong to the physical stack, so they're compared with the most
  // demanding cargo's count, not a sum.
  const required = assessments.reduce(
    (max, seg) => (seg.assessment.status === 'calculated' ? Math.max(max, seg.assessment.requiredCount ?? 0) : max),
    0
  )
  const calculated = assessments.some((s) => s.assessment.status === 'calculated')
  // Enough points can still be too weak: the same verdict the check gives.
  const record = selectedManual ?? selectedPin
  const balanceFails = !!record && !!lashingShortfall(record, deck, items)?.balanceFails

  return (
    <div className="space-y-2.5">
      {/* Lashing points and a clearance zone exclude each other: switching
          to the zone takes the points off. */}
      <div role="group" aria-label="Способ крепления" className="grid grid-cols-2 gap-1">
        <Button
          size="sm"
          variant={!zoned ? 'secondary' : 'outline'}
          aria-pressed={!zoned}
          className="h-7 px-1 text-xs"
          // Already in this mode: nothing to change (and nothing to pin).
          onClick={() => zoned && patch({ clearanceMargin: undefined })}
        >
          Точки крепления
        </Button>
        <Button
          size="sm"
          variant={zoned ? 'secondary' : 'outline'}
          aria-pressed={zoned}
          className="h-7 px-1 text-xs"
          onClick={() => {
            if (placement.id) clearLashingPointsFor(placement.id)
            patch({ clearanceMargin: placement.clearanceMargin ?? { top: 1, right: 1, bottom: 1, left: 1 } })
            // The placing tool isn't tied to a stack: left armed, a click on
            // this stack would tie a new point to it, zone or not.
            if (placingLashingPoint) setPlacingLashingPoint(false)
          }}
        >
          Зона отступа
        </Button>
      </div>

      {zoned ? (
        <div className="space-y-1">
          <p className="text-xs text-ink-2">Свободное место вокруг штабеля: другой груз ближе не встанет</p>
          <div className="grid grid-cols-2 gap-1">
            {(
              [
                ['top', 'Верх'],
                ['right', 'Право'],
                ['bottom', 'Низ'],
                ['left', 'Лево'],
              ] as const
            ).map(([side, label]) => (
              <SideField key={side} label={label} unit={u} value={placement.clearanceMargin?.[side] ?? 0} onCommit={(v) => setSide(side, v)} />
            ))}
          </div>
        </div>
      ) : (
        <>
          {assessments.map((seg, idx) => {
            const segLabel =
              assessments.length > 1
                ? `${items.find((it) => it.id === seg.itemId)?.name ?? seg.itemId} (${seg.layers} ед., ${Math.round(seg.weightKg)} кг): `
                : null
            if (seg.assessment.status === 'not-applicable') {
              return (
                <div key={`${seg.itemId}-${idx}`} className="flex gap-1.5 rounded-md border border-danger p-2 text-xs text-danger">
                  <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    {segLabel && <b>{segLabel}</b>}
                    <b>Категория «{seg.category}» — груз для IMDG Code.</b> Классификация, сегрегация и документация — по IMDG Code
                    (вне приложения, согласуйте с грузоотправителем и капитаном); прочность самого крепления — отдельная проверка.
                    РД 31.11.21.23-96 к этой категории не применим, числа не показываем. Расстояния до другого груза — в правилах
                    сепарации («Проверки»), силовой баланс точек — на схеме.
                  </span>
                </div>
              )
            }
            if (seg.assessment.status === 'insufficient-data') {
              return (
                <p key={`${seg.itemId}-${idx}`} className="rounded-md border p-2 text-xs text-ink-2">
                  {segLabel && <b>{segLabel}</b>}
                  Недостаточно данных для оценки: {seg.assessment.missingInputs?.join(', ')}.
                </p>
              )
            }
            if (seg.assessment.status === 'calculated') {
              return (
                <div key={`${seg.itemId}-${idx}`} className="rounded-md border p-2 text-xs text-ink-2">
                  {segLabel && <div className="mb-0.5">{segLabel}</div>}
                  {seg.assessment.methodology === 'metal-rd' && <>РД 31.11.21.23-96 (п. 2.2.3): требуется найтовов — {seg.assessment.requiredCount}</>}
                  {seg.assessment.methodology === 'general' && (
                    <>
                      Ориентировочное количество найтовов: {seg.assessment.requiredCount}
                      <div className="mt-0.5">Не является нормативным расчётом крепления.</div>
                    </>
                  )}
                </div>
              )
            }
            return null
          })}

          {calculated && (
            <div className="space-y-1.5">
              <label htmlFor={`${uid}-wire`} className="text-xs text-ink-2">
                Канат найтова
              </label>
              <Select value={wire} onValueChange={(v) => patch({ lashingWireType: v as WireRopeType })}>
                <SelectTrigger id={`${uid}-wire`} className="h-7 w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(WIRE_ROPE_SPECS).map(([key, w]) => (
                    <SelectItem key={key} value={key}>
                      {w.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {own.length < required && (
                <div className="space-y-1">
                  <label htmlFor={`${uid}-why`} className="text-xs text-ink-2">
                    Обоснование — точек меньше расчётного (идёт в PDF)
                  </label>
                  <textarea
                    id={`${uid}-why`}
                    className="min-h-[44px] w-full resize-y rounded border bg-transparent p-1.5 text-xs"
                    placeholder="Например: груз на деревянной клети между бортовыми стенками, доп. крепление сверх клети не требуется по проекту"
                    value={placement.lashingJustification ?? ''}
                    onChange={(e) => patch({ lashingJustification: e.target.value })}
                  />
                </div>
              )}
            </div>
          )}

          {/* What the norms ask, when they can say; what is set, always. */}
          <p className={cn('text-xs', own.length < required ? 'text-danger' : 'text-ink-2')} data-testid="lashing-count">
            {calculated ? `Нужно ${required}, задано ${own.length}` : `Задано точек: ${own.length}`}
          </p>
          {balanceFails && (
            <p className="text-xs text-danger" data-testid="lashing-balance">
              Не держит по расчёту сил (IMO CSS Code, упрощённо): нужны точки прочнее или под другим углом — на палубе его точки
              красные
            </p>
          )}
          {own.length > 0 && (
            <ul className="space-y-1.5" aria-label="Точки крепления штабеля">
              {own.map((p, i) => {
                const name = p.label || `Точка ${i + 1}`
                return (
                  <li key={p.id} className="space-y-1.5 rounded-md border p-2">
                    <div className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-xs">{name}</span>
                      <button
                        type="button"
                        onClick={() => removeLashingPoint(p.id)}
                        aria-label={`Удалить «${name}»`}
                        title="Удалить точку"
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-2 hover:bg-accent hover:text-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                    <Select
                      value={p.deviceType ?? 'custom'}
                      onValueChange={(v) => {
                        const deviceType = v as LashingDeviceType
                        updateLashingPoint(p.id, { deviceType, mslKg: LASHING_DEVICES[deviceType].mslKg || p.mslKg })
                      }}
                    >
                      <SelectTrigger aria-label={`Устройство «${name}»`} className="h-7 w-full text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(LASHING_DEVICES).map(([key, d]) => (
                          <SelectItem key={key} value={key}>
                            {d.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="grid grid-cols-2 gap-1">
                      <SideField label="MSL" unit="кг" value={p.mslKg ?? 0} onCommit={(v) => updateLashingPoint(p.id, { mslKg: v })} />
                      <SideField label="Угол" unit="°" value={p.verticalAngleDeg ?? 45} max={90} onCommit={(v) => updateLashingPoint(p.id, { verticalAngleDeg: v })} />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          <Button
            size="sm"
            variant={placingLashingPoint ? 'secondary' : 'outline'}
            aria-pressed={placingLashingPoint}
            className="h-7 w-full text-xs"
            onClick={() => setPlacingLashingPoint(!placingLashingPoint)}
          >
            <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Добавить точку крепления
          </Button>
          {placingLashingPoint && <p className="text-xs text-ink-2">Клик у угла штабеля, затем по палубе, где точка. Esc — готово</p>}
          {own.length > 0 && placement.id && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-full text-xs text-danger hover:text-danger"
              onClick={() => clearLashingPointsFor(placement.id!)}
            >
              <Trash2 className="mr-1 h-3 w-3" aria-hidden="true" />
              Снять все точки этого штабеля ({own.length})
            </Button>
          )}
        </>
      )}
    </div>
  )
}

// A figure of the stack's securing, applied on Enter or leaving the field.
function SideField({
  label,
  unit,
  value,
  max,
  onCommit,
}: {
  label: string
  unit: string
  value: number
  max?: number
  onCommit: (v: number) => void
}) {
  const id = useId()
  return (
    <div className="space-y-0.5">
      <label htmlFor={id} className="block text-xs leading-none text-ink-2">
        {label} ({unit})
      </label>
      <NumberField id={id} min={0} max={max} value={value} onCommit={onCommit} className="h-7 px-1.5 text-xs" />
    </div>
  )
}
