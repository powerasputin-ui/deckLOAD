'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, Pencil, Plug, Sparkles, Trash2, Square, Triangle, Circle, Diamond, Ban, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useCalculator, PRESETS, PALETTE, PRESET_TEMPLATE_COLORS, UNIT_LABEL, convertLength } from '@/store/calculator'
import { type CargoShape, type RestrictionZoneShape, type AnnotationKind } from '@/lib/packing'
import { computePipeNest, REAL_CRATE_HEIGHT_M_OD1073M } from '@/lib/pipeNest'
import { cn, fmtNumber } from '@/lib/utils'

// Stable empty-array reference — see the same pattern's comment in
// Sidebar.tsx (a fresh `[] ` every selector call looks like "the snapshot
// changed" to useSyncExternalStore and re-renders forever).
const EMPTY_POWER_SOCKETS: never[] = []
const EMPTY_RESTRICTION_ZONES: never[] = []
const EMPTY_ANNOTATIONS: never[] = []

// Restriction zones aren't a cargo-template category (no CargoItem-shaped
// entries), so they get their own pseudo-key alongside PRESETS' real
// category keys rather than living inside one of those categories' item
// lists — a separate top-level button, not nested under "Объекты".
const RESTRICTION_ZONE_CATEGORY_KEY = '__restriction_zones__'
// Same reasoning as RESTRICTION_ZONE_CATEGORY_KEY — annotations aren't
// CargoItem-shaped either.
const ANNOTATIONS_CATEGORY_KEY = '__annotations__'

const ANNOTATION_STAMPS: { kind: Exclude<AnnotationKind, 'note'>; label: string }[] = [
  { kind: 'bow', label: 'Нос' },
  { kind: 'stern', label: 'Корма' },
  { kind: 'port', label: 'Лево борт' },
  { kind: 'starboard', label: 'Право борт' },
]

const RESTRICTION_ZONE_SHAPES: { shapeType: RestrictionZoneShape; label: string; Icon: typeof Square }[] = [
  { shapeType: 'rect', label: 'Прямоугольник', Icon: Square },
  { shapeType: 'triangle', label: 'Треугольник', Icon: Triangle },
  { shapeType: 'oval', label: 'Овал', Icon: Circle },
  { shapeType: 'diamond', label: 'Ромб', Icon: Diamond },
]

// Same store/logic PresetsSection used inside the Sidebar (moved here
// unchanged) — only the layout is horizontal now, to fit a bar under the
// deck instead of a vertical column in the sidebar. Category buttons open
// on click (toggle) OR on hover (purely additive — never changes the
// underlying activePresetCategory model, just an extra way to trigger it).
export function PresetsBar({ onPlaceCustomShape }: { onPlaceCustomShape: (name: string, weight?: number) => void }) {
  const [open, setOpen] = useState(false)
  const activePresetCategory = useCalculator((s) => s.activePresetCategory)
  const setActivePresetCategory = useCalculator((s) => s.setActivePresetCategory)
  const pendingPresetStamp = useCalculator((s) => s.pendingPresetStamp)
  const setPendingPresetStamp = useCalculator((s) => s.setPendingPresetStamp)
  const drawingCustomShape = useCalculator((s) => s.drawingCustomShape)
  const setDrawingCustomShape = useCalculator((s) => s.setDrawingCustomShape)
  const pendingCustomShape = useCalculator((s) => s.pendingCustomShape)
  const setPendingCustomShape = useCalculator((s) => s.setPendingCustomShape)
  // Power-socket markers live under "Объекты" too — visual-only, so they
  // don't fit the CargoItem-template shape every other entry here has, but
  // the armed-toggle-then-click-the-deck flow is the same shape as
  // "Нарисовать" right next to it.
  const sockets = useCalculator((s) => s.deck.powerSockets ?? EMPTY_POWER_SOCKETS)
  const removePowerSocket = useCalculator((s) => s.removePowerSocket)
  const placingPowerSocket = useCalculator((s) => s.placingPowerSocket)
  const setPlacingPowerSocket = useCalculator((s) => s.setPlacingPowerSocket)
  // Restriction (obstacle) zones — drawn PPT-style: pick a shape, drag on the
  // deck to size it. drawingRestrictionShape holds WHICH shape (null = off).
  const restrictionZones = useCalculator((s) => s.deck.restrictionZones ?? EMPTY_RESTRICTION_ZONES)
  const removeRestrictionZone = useCalculator((s) => s.removeRestrictionZone)
  const updateRestrictionZone = useCalculator((s) => s.updateRestrictionZone)
  const unit = useCalculator((s) => s.deck.unit)
  const drawingRestrictionShape = useCalculator((s) => s.drawingRestrictionShape)
  const setDrawingRestrictionShape = useCalculator((s) => s.setDrawingRestrictionShape)
  const drawingRestrictionZoneFreeform = useCalculator((s) => s.drawingRestrictionZoneFreeform)
  const setDrawingRestrictionZoneFreeform = useCalculator((s) => s.setDrawingRestrictionZoneFreeform)
  // Annotations (bow/stern/port/starboard labels + AutoCAD-style leader
  // notes) — purely visual, same armed-tool shape as power sockets above.
  const annotations = useCalculator((s) => s.deck.annotations ?? EMPTY_ANNOTATIONS)
  const removeAnnotation = useCalculator((s) => s.removeAnnotation)
  const updateAnnotation = useCalculator((s) => s.updateAnnotation)
  const placingAnnotation = useCalculator((s) => s.placingAnnotation)
  const setPlacingAnnotation = useCalculator((s) => s.setPlacingAnnotation)
  // Whether the NEXT "Заметка" note is armed with a leader — a local UI
  // preference, not store state, since it only matters at the moment of
  // arming (see toggleWithLeader below, which also live-updates an
  // already-armed note tool).
  const [withLeader, setWithLeader] = useState(false)
  const toggleWithLeader = () => {
    // Calling the Zustand setter from INSIDE a useState updater function
    // (the `setWithLeader(v => ...)` form) runs it during React's render
    // phase, not as a plain event-handler side effect — that's exactly
    // what triggers "Cannot update a component while rendering a
    // different component" (Home, via the store, while PresetsBar
    // renders). Compute `next` first and call both setters as two
    // ordinary statements in the event handler body instead.
    const next = !withLeader
    setWithLeader(next)
    if (placingAnnotation?.kind === 'note') setPlacingAnnotation({ kind: 'note', withLeader: next })
  }
  const [drawName, setDrawName] = useState('')
  const [drawWeight, setDrawWeight] = useState('')
  // Reset the finalize form's fields once the pending shape is cleared
  // (placed, or cancelled via Escape) — same render-time "compare previous
  // prop" pattern used elsewhere in this app instead of a useEffect.
  const [prevPendingCustomShape, setPrevPendingCustomShape] = useState(pendingCustomShape)
  if (pendingCustomShape !== prevPendingCustomShape) {
    setPrevPendingCustomShape(pendingCustomShape)
    if (!pendingCustomShape) {
      setDrawName('')
      setDrawWeight('')
    }
  }

  return (
    <div className="border-t pt-2.5 mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-left mb-1.5 group"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <span className="text-muted-foreground group-hover:text-foreground transition-colors">
          <Sparkles className="h-4 w-4" />
        </span>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Пресеты
        </span>
      </button>
      {open && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-muted-foreground leading-tight">
            Выберите категорию, затем тип груза — он вооружится для клика по палубе.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(PRESETS).map(([key, cat]) => (
              <Button
                key={key}
                variant={activePresetCategory === key ? 'secondary' : 'outline'}
                size="sm"
                className="h-7 text-xs"
                // Hover only OPENS a category when nothing is open yet (a
                // discovery convenience) — once one is open, only an
                // explicit click switches it. Letting hover always switch
                // meant the mouse merely passing over a neighbouring
                // category button on its way to an item further down (a
                // very normal cursor path once the row wraps) would silently
                // rip the open list out from under the user.
                onMouseEnter={() => {
                  if (!activePresetCategory) setActivePresetCategory(key)
                }}
                // Deliberately NOT a toggle (activePresetCategory === key ?
                // null : key) — a real mouse click always fires mouseenter
                // right before the click itself, so if this category wasn't
                // open yet, the hover handler above already opened it a
                // moment earlier; a toggle would then read that just-opened
                // state and immediately close it again on the very click
                // meant to open it. Always setting to `key` is immune to
                // whatever hover changed a beat before. To close a category,
                // pick a different one or collapse the whole bar's header.
                onClick={() => setActivePresetCategory(key)}
              >
                {cat.label}
              </Button>
            ))}
            <Button
              variant={activePresetCategory === RESTRICTION_ZONE_CATEGORY_KEY ? 'secondary' : 'outline'}
              size="sm"
              className="h-7 text-xs"
              onMouseEnter={() => {
                if (!activePresetCategory) setActivePresetCategory(RESTRICTION_ZONE_CATEGORY_KEY)
              }}
              onClick={() => setActivePresetCategory(RESTRICTION_ZONE_CATEGORY_KEY)}
            >
              Зоны ограничений
              {restrictionZones.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-[10px]">{restrictionZones.length}</Badge>
              )}
            </Button>
            <Button
              variant={activePresetCategory === ANNOTATIONS_CATEGORY_KEY ? 'secondary' : 'outline'}
              size="sm"
              className="h-7 text-xs"
              onMouseEnter={() => {
                if (!activePresetCategory) setActivePresetCategory(ANNOTATIONS_CATEGORY_KEY)
              }}
              onClick={() => setActivePresetCategory(ANNOTATIONS_CATEGORY_KEY)}
            >
              Заметки
              {annotations.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-[10px]">{annotations.length}</Badge>
              )}
            </Button>
          </div>
          {activePresetCategory && activePresetCategory !== RESTRICTION_ZONE_CATEGORY_KEY && activePresetCategory !== ANNOTATIONS_CATEGORY_KEY && (
            <div className="thin-scrollbar flex flex-wrap gap-1.5 max-h-40 overflow-y-auto pr-0.5">
              {PRESETS[activePresetCategory]?.items.map((tpl, i) => {
                // One fixed color per template NAME (PRESET_TEMPLATE_COLORS),
                // not per row position — so the same type always shows the
                // same color regardless of which category list it's viewed
                // from, and the real item created on placement keeps this
                // exact color (see addOrIncrementCargoFromTemplate).
                const color = PRESET_TEMPLATE_COLORS[tpl.name ?? ''] ?? PALETTE[i % PALETTE.length]
                const active = pendingPresetStamp?.name === tpl.name
                // PRESETS is authored once, in meters, regardless of the
                // deck's current unit (e.g. a real 20ft container is always
                // width: 6.06 there) — convert to the current unit both for
                // display here AND for the armed stamp actually placed on
                // the deck, or a preset picked while working in cm/ft would
                // show/create cargo 30-100x the wrong physical size.
                const converted = {
                  ...tpl,
                  width: tpl.width !== undefined ? convertLength(tpl.width, 'm', unit) : tpl.width,
                  length: tpl.length !== undefined ? convertLength(tpl.length, 'm', unit) : tpl.length,
                  height: tpl.height !== undefined ? convertLength(tpl.height, 'm', unit) : tpl.height,
                }
                return (
                  <PresetTemplateChip
                    key={i}
                    template={converted}
                    unitLabel={UNIT_LABEL[unit]}
                    color={color}
                    active={active}
                    // A real pipe штабель is built below via PipeNestBuilder
                    // (real per-tier layout, correct weight/VCG) — this chip
                    // still places a single loose pipe on click (useful on
                    // its own), but shouldn't read as the way to build a
                    // stack, or a user clicking it repeatedly would expect
                    // the same nested pile the old generic pipe presets in
                    // "Смешанный" give, which this vessel's real stowage
                    // doesn't match (see maxLayers: 1 on every item here).
                    hint={activePresetCategory === 'pipes' ? 'через конструктор штабеля ниже' : undefined}
                    onSelect={() => setPendingPresetStamp(active ? null : { ...converted, color })}
                  />
                )
              })}
              {activePresetCategory === 'objects' && (
                <>
                  <button
                    onClick={() => setDrawingCustomShape(!drawingCustomShape)}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border p-2 text-left transition-all shrink-0',
                      drawingCustomShape
                        ? 'border-slate-400 bg-slate-100 ring-1 ring-slate-300 dark:bg-slate-800/40 dark:ring-slate-600'
                        : 'border-border hover:bg-accent'
                    )}
                  >
                    <span className="h-7 w-7 shrink-0 flex items-center justify-center rounded-md border border-dashed border-black/20 text-muted-foreground">
                      <Pencil className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-medium truncate">Нарисовать</span>
                      <span className="block text-[10px] text-muted-foreground">свой контур по точкам</span>
                    </span>
                  </button>
                  <button
                    onClick={() => setPlacingPowerSocket(!placingPowerSocket)}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border p-2 text-left transition-all shrink-0',
                      placingPowerSocket
                        ? 'border-amber-400 bg-amber-50 ring-1 ring-amber-300 dark:bg-amber-950/30 dark:ring-amber-700'
                        : 'border-border hover:bg-accent'
                    )}
                  >
                    <span className="h-7 w-7 shrink-0 flex items-center justify-center rounded-md border border-dashed border-black/20 text-amber-600">
                      <Plug className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-medium truncate">Розетка</span>
                      <span className="block text-[10px] text-muted-foreground">по контуру палубы</span>
                    </span>
                    {sockets.length > 0 && (
                      <Badge variant="secondary" className="shrink-0 text-[10px]">{sockets.length}</Badge>
                    )}
                  </button>
                  {sockets.length > 0 && (
                    <>
                      {/* Forces the flex-wrap row to break here regardless of
                          how much space is left in the current line — placed
                          sockets always start their own new row, never
                          trailing after whatever preset/Нарисовать/Розетка
                          chips happened to fit before them. */}
                      <div className="basis-full w-0" aria-hidden="true" />
                      {sockets.map((s, i) => (
                        <div key={s.id} className="flex shrink-0 items-center gap-1 rounded-lg border px-1.5 py-1 text-xs">
                          <Plug className="h-3 w-3 text-amber-600" />
                          <span>{i + 1}</span>
                          <button
                            onClick={() => removePowerSocket(s.id)}
                            className="inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:text-destructive shrink-0"
                            title="Удалить розетку"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </>
                  )}
                </>
              )}
              {activePresetCategory === 'pipes' && (
                <>
                  <div className="basis-full w-0" aria-hidden="true" />
                  <PipeNestBuilder />
                </>
              )}
            </div>
          )}
          {activePresetCategory === RESTRICTION_ZONE_CATEGORY_KEY && (
            <div className="thin-scrollbar flex flex-wrap gap-1.5 max-h-40 overflow-y-auto pr-0.5">
              <div className="flex shrink-0 items-center gap-1 rounded-lg border p-1.5">
                <span className="px-0.5 text-[10px] text-muted-foreground">Фигура:</span>
                {RESTRICTION_ZONE_SHAPES.map(({ shapeType, label, Icon }) => (
                  <button
                    key={shapeType}
                    title={label}
                    onClick={() => setDrawingRestrictionShape(drawingRestrictionShape === shapeType ? null : shapeType)}
                    className={cn(
                      'h-6 w-6 flex items-center justify-center rounded-md border',
                      drawingRestrictionShape === shapeType
                        ? 'border-red-400 bg-red-50 text-red-700 ring-1 ring-red-300 dark:bg-red-950/30 dark:text-red-400 dark:ring-red-700'
                        : 'border-border hover:bg-accent'
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </button>
                ))}
              </div>
              <button
                onClick={() => setDrawingRestrictionZoneFreeform(!drawingRestrictionZoneFreeform)}
                title="Произвольная область"
                className={cn(
                  'flex items-center gap-2 rounded-lg border p-2 text-left transition-all shrink-0',
                  drawingRestrictionZoneFreeform
                    ? 'border-red-400 bg-red-50 ring-1 ring-red-300 dark:bg-red-950/30 dark:ring-red-700'
                    : 'border-border hover:bg-accent'
                )}
              >
                <span className="h-7 w-7 shrink-0 flex items-center justify-center rounded-md border border-dashed border-black/20 text-red-600">
                  <Pencil className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-medium truncate">Нарисовать</span>
                  <span className="block text-[10px] text-muted-foreground">произвольная область по точкам</span>
                </span>
              </button>
              {restrictionZones.length > 0 && (
                <>
                  <div className="basis-full w-0" aria-hidden="true" />
                  {restrictionZones.map((z) => (
                    <ZoneChip
                      key={z.id}
                      name={z.name}
                      width={z.width}
                      length={z.length}
                      editableSize={z.shapeType !== 'custom'}
                      unitLabel={UNIT_LABEL[unit]}
                      onResize={(patch) => updateRestrictionZone(z.id, patch)}
                      onRemove={() => removeRestrictionZone(z.id)}
                    />
                  ))}
                </>
              )}
            </div>
          )}
          {activePresetCategory === ANNOTATIONS_CATEGORY_KEY && (
            <div className="thin-scrollbar flex flex-wrap gap-1.5 max-h-40 overflow-y-auto pr-0.5">
              <div className="flex shrink-0 items-center gap-1 rounded-lg border p-1.5">
                <span className="px-0.5 text-[10px] text-muted-foreground">Метка:</span>
                {ANNOTATION_STAMPS.map(({ kind, label }) => (
                  <button
                    key={kind}
                    onClick={() => setPlacingAnnotation(placingAnnotation?.kind === kind ? null : { kind, withLeader: false })}
                    className={cn(
                      'h-6 px-2 flex items-center justify-center rounded-md border text-[10px]',
                      placingAnnotation?.kind === kind
                        ? 'border-slate-400 bg-slate-100 text-slate-700 ring-1 ring-slate-300 dark:bg-slate-800/40 dark:text-slate-200 dark:ring-slate-600'
                        : 'border-border hover:bg-accent'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setPlacingAnnotation(placingAnnotation?.kind === 'note' ? null : { kind: 'note', withLeader })}
                className={cn(
                  'flex items-center gap-2 rounded-lg border p-2 text-left transition-all shrink-0',
                  placingAnnotation?.kind === 'note'
                    ? 'border-sky-400 bg-sky-50 ring-1 ring-sky-300 dark:bg-sky-950/30 dark:ring-sky-700'
                    : 'border-border hover:bg-accent'
                )}
              >
                <span className="h-7 w-7 shrink-0 flex items-center justify-center rounded-md border border-dashed border-black/20 text-sky-600">
                  <MessageSquare className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-medium truncate">Заметка</span>
                  <span className="block text-[10px] text-muted-foreground">свободный текст</span>
                </span>
              </button>
              <button
                onClick={toggleWithLeader}
                title="Со сноской — клик 1: точка, на которую указывает (можно на груз); клик 2: где встанет текст"
                className={cn(
                  'h-7 px-2 flex items-center gap-1 rounded-md border text-[10px] shrink-0 self-center',
                  withLeader
                    ? 'border-sky-400 bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300'
                    : 'border-border hover:bg-accent text-muted-foreground'
                )}
              >
                Со сноской
              </button>
              {annotations.length > 0 && (
                <>
                  <div className="basis-full w-0" aria-hidden="true" />
                  {annotations.map((a) => (
                    <AnnotationChip
                      key={a.id}
                      text={a.text}
                      hasLeader={a.leaderX !== undefined}
                      onTextChange={(text) => updateAnnotation(a.id, { text })}
                      onRemoveLeader={() => updateAnnotation(a.id, { leaderX: undefined, leaderY: undefined })}
                      onRemove={() => removeAnnotation(a.id)}
                    />
                  ))}
                </>
              )}
            </div>
          )}
          {placingAnnotation && (
            <p className="text-[10px] text-muted-foreground leading-tight">
              {placingAnnotation.withLeader
                ? 'Клик 1 — точка, на которую указывает сноска (можно на груз). Клик 2 — где встанет текст.'
                : placingAnnotation.kind === 'note'
                  ? 'Кликните по палубе — текст встанет в этой точке. Текст задайте после, в списке ниже.'
                  : 'Кликните по палубе — метка встанет в этой точке.'}
            </p>
          )}
          {pendingPresetStamp && (
            <p className="text-[10px] text-muted-foreground leading-tight">
              «{pendingPresetStamp.name}» готов — кликните по палубе, чтобы разместить.
            </p>
          )}
          {drawingCustomShape && (
            <p className="text-[10px] text-muted-foreground leading-tight">
              Кликайте по палубе, чтобы поставить точки контура (минимум 3), затем кликните рядом с первой точкой, чтобы замкнуть. Backspace — убрать последнюю точку, Esc — отменить.
            </p>
          )}
          {placingPowerSocket && (
            <p className="text-[10px] text-muted-foreground leading-tight">
              Кликните у края палубы — розетка встанет на ближайшую точку контура. Только визуальная метка,
              груз можно ставить рядом.
            </p>
          )}
          {drawingRestrictionShape && (
            <p className="text-[10px] text-muted-foreground leading-tight">
              Потяните на палубе, чтобы задать размер зоны. Груз нельзя будет поставить/перетащить туда — ни
              вручную, ни автоматически.
            </p>
          )}
          {drawingRestrictionZoneFreeform && (
            <p className="text-[10px] text-muted-foreground leading-tight">
              Кликайте по палубе, чтобы поставить точки контура зоны (минимум 3), затем кликните рядом с первой
              точкой, чтобы замкнуть. Backspace — убрать последнюю точку, Esc — отменить.
            </p>
          )}
          {pendingCustomShape && (
            <div className="max-w-xs space-y-1.5 rounded-lg border p-2">
              <p className="text-[10px] text-muted-foreground leading-tight">
                Контур готов — задайте имя, затем разместите.
              </p>
              <Input
                value={drawName}
                onChange={(e) => setDrawName(e.target.value)}
                placeholder="Название груза"
                className="h-7 text-xs"
              />
              <Input
                value={drawWeight}
                onChange={(e) => setDrawWeight(e.target.value)}
                placeholder="Вес, кг (необязательно)"
                inputMode="decimal"
                className="h-7 text-xs"
              />
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  className="h-7 text-xs flex-1"
                  disabled={!drawName.trim()}
                  onClick={() => {
                    const w = parseFloat(drawWeight)
                    onPlaceCustomShape(drawName.trim(), Number.isFinite(w) && w > 0 ? w : undefined)
                  }}
                >
                  Разместить
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => setPendingCustomShape(null)}
                >
                  Отмена
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PresetTemplateChip({
  template,
  unitLabel,
  color,
  active,
  hint,
  onSelect,
}: {
  template: { name?: string; width?: number; length?: number; shape?: CargoShape }
  unitLabel: string
  color: string
  active: boolean
  hint?: string
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'flex shrink-0 items-center gap-2 rounded-lg border p-1.5 pr-2.5 text-left transition-all',
        active
          ? 'border-slate-400 bg-slate-100 ring-1 ring-slate-300 dark:bg-slate-800/40 dark:ring-slate-600'
          : 'border-border hover:bg-accent'
      )}
    >
      <span
        className={cn(
          'h-6 w-6 shrink-0 border border-black/10',
          template.shape === 'circle' || template.shape === 'oval' ? 'rounded-full' : 'rounded-md',
          template.shape === 'diamond' && 'rotate-45'
        )}
        style={{
          backgroundColor: color,
          clipPath: template.shape === 'triangle' ? 'polygon(50% 0%, 0% 100%, 100% 100%)' : undefined,
        }}
      />
      <div className="min-w-0">
        <div className="text-xs font-medium truncate">{template.name}</div>
        <div className="text-[10px] text-muted-foreground">
          {fmtNumber(template.width ?? 0)}×{fmtNumber(template.length ?? 0)} {unitLabel}
        </div>
        {hint && <div className="text-[9px] italic text-muted-foreground/80">{hint}</div>}
      </div>
      {active && <Badge variant="default" className="shrink-0 text-[10px]">активен</Badge>}
    </button>
  )
}

// A placed annotation's chip — editable text (text entry happens here, not
// on the SVG canvas itself, since an inline-editable SVG label would need a
// foreignObject, which taints the PDF export's canvas rasterization — see
// the comment on PowerSocketGlyph in DeckVisualization.tsx), an optional
// "убрать линию" control (keeps the text, drops just the leader), and the
// same delete control every other chip in this file uses.
function AnnotationChip({
  text,
  hasLeader,
  onTextChange,
  onRemoveLeader,
  onRemove,
}: {
  text: string
  hasLeader: boolean
  onTextChange: (text: string) => void
  onRemoveLeader: () => void
  onRemove: () => void
}) {
  const [draft, setDraft] = useState(text)
  const [prevText, setPrevText] = useState(text)
  if (text !== prevText) {
    setPrevText(text)
    setDraft(text)
  }
  const commit = () => {
    if (draft !== text) onTextChange(draft)
  }
  return (
    <div className="flex shrink-0 items-center gap-1.5 rounded-lg border px-1.5 py-1 text-xs">
      <MessageSquare className="h-3 w-3 text-sky-600 shrink-0" />
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
        placeholder="Текст"
        className="h-5 w-24 rounded border bg-background px-1 text-[10px]"
      />
      {hasLeader && (
        <button
          onClick={onRemoveLeader}
          title="Убрать сноску (текст останется)"
          className="text-[9px] text-muted-foreground hover:text-foreground underline shrink-0"
        >
          без линии
        </button>
      )}
      <button
        onClick={onRemove}
        className="inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:text-destructive shrink-0"
        title="Удалить"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  )
}

// A placed restriction zone's chip — name, editable width/length (so the
// user can type exact dimensions instead of only eyeballing a drag-resize
// on the tiny deck view), and the same round red delete control used
// on-deck. 'custom' (freehand-outline) zones show their bbox as read-only
// text instead of editable fields — scaling a hand-drawn outline from two
// numbers isn't a well-defined operation, same reasoning as hiding their
// corner-resize handles on the deck.
function ZoneChip({
  name,
  width,
  length,
  editableSize,
  unitLabel,
  onResize,
  onRemove,
}: {
  name: string
  width: number
  length: number
  editableSize: boolean
  unitLabel: string
  onResize: (patch: { width?: number; length?: number }) => void
  onRemove: () => void
}) {
  const [widthText, setWidthText] = useState(fmtNumber(width))
  const [lengthText, setLengthText] = useState(fmtNumber(length))
  // Keep the text buffers in sync when the size changes from OUTSIDE this
  // input (drag-resize on the deck) — same "compare against previous prop"
  // render-time pattern used throughout this file, not a useEffect.
  const [prevWidth, setPrevWidth] = useState(width)
  const [prevLength, setPrevLength] = useState(length)
  if (width !== prevWidth) {
    setPrevWidth(width)
    setWidthText(fmtNumber(width))
  }
  if (length !== prevLength) {
    setPrevLength(length)
    setLengthText(fmtNumber(length))
  }
  const commitWidth = () => {
    const v = parseFloat(widthText.replace(',', '.'))
    if (Number.isFinite(v) && v > 0) onResize({ width: v })
    else setWidthText(fmtNumber(width))
  }
  const commitLength = () => {
    const v = parseFloat(lengthText.replace(',', '.'))
    if (Number.isFinite(v) && v > 0) onResize({ length: v })
    else setLengthText(fmtNumber(length))
  }
  return (
    <div className="flex shrink-0 items-center gap-1.5 rounded-lg border px-1.5 py-1 text-xs">
      <Ban className="h-3 w-3 text-red-600 shrink-0" />
      <span className="max-w-[70px] truncate">{name}</span>
      {editableSize ? (
        <>
          <input
            type="text"
            inputMode="decimal"
            value={widthText}
            onChange={(e) => setWidthText(e.target.value)}
            onBlur={commitWidth}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
            className="h-5 w-10 rounded border bg-background px-1 text-[10px]"
            title={`Ширина, ${unitLabel}`}
          />
          <span className="text-muted-foreground">×</span>
          <input
            type="text"
            inputMode="decimal"
            value={lengthText}
            onChange={(e) => setLengthText(e.target.value)}
            onBlur={commitLength}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
            className="h-5 w-10 rounded border bg-background px-1 text-[10px]"
            title={`Длина, ${unitLabel}`}
          />
          <span className="text-[10px] text-muted-foreground">{unitLabel}</span>
        </>
      ) : (
        <span className="text-[10px] text-muted-foreground">своя форма</span>
      )}
      <button
        onClick={onRemove}
        className="inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:text-destructive shrink-0"
        title="Удалить зону"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  )
}

// Builds a real pipe штабель as ONE cargo item (shape 'pipe-nest') from a
// chosen pipe type — see src/lib/pipeNest.ts for the geometry (straight,
// equal-count tiers on a timber crib, ДВТК/638.362241.023 п. 2.1.2/2.1.3).
// A pipe preset's own width/length/height describe a SINGLE pipe
// (width = pipe length, length = height = outer diameter, per the pipes
// category's own comment) — this builder reuses those three numbers as the
// nest's pipeLengthM/pipeOuterDiameterM inputs, it does not duplicate them.
function PipeNestBuilder() {
  const deckWidth = useCalculator((s) => s.deck.width)
  const deckClearance = useCalculator((s) => s.deck.clearance)
  const unit = useCalculator((s) => s.deck.unit)
  const addOrIncrementCargoFromTemplate = useCalculator((s) => s.addOrIncrementCargoFromTemplate)
  const pipeItems = PRESETS.pipes?.items ?? []
  const [pipeIndex, setPipeIndex] = useState(0)
  // Usable width and pipe count are entered in the deck's OWN current unit
  // (matching every other field in this bar), converted to metres only for
  // the geometry call — computePipeNest works in real metres throughout.
  const [widthText, setWidthText] = useState(() => fmtNumber(deckWidth))
  const [countText, setCountText] = useState('')
  // Optional cargo-in-cargo weight (e.g. water left in pipes during
  // transport — a real line item for some projects, ~4% of stack weight in
  // the one source document seen so far). Left EMPTY by default, never 0 —
  // an empty field means "not accounted for", a 0 would falsely claim it
  // was checked and found to be none. Added to the stack's total weight;
  // the water is assumed to ride at the same VCG as the pipes themselves
  // (it's distributed along their full length), so no separate VCG term is
  // needed — computePipeNest's own geometric VCG already covers it.
  const [waterText, setWaterText] = useState('')
  const [prevDeckWidth, setPrevDeckWidth] = useState(deckWidth)
  if (deckWidth !== prevDeckWidth) {
    setPrevDeckWidth(deckWidth)
    setWidthText(fmtNumber(deckWidth))
  }

  const tpl = pipeItems[pipeIndex]
  if (!tpl) return null
  const pipeOuterDiameterM = tpl.length ?? tpl.height ?? 0
  const pipeLengthM = tpl.width ?? 0
  const pipeWeightKg = tpl.weight
  const usableWidthM = convertLength(parseFloat(widthText.replace(',', '.')) || deckWidth, unit, 'm')
  const pipeCount = countText.trim() ? Math.max(1, Math.round(parseFloat(countText.replace(',', '.')))) : undefined
  const maxStackHeightM = deckClearance > 0 ? convertLength(deckClearance, unit, 'm') : undefined

  const nest =
    pipeOuterDiameterM > 0 && pipeLengthM > 0 && usableWidthM > 0
      ? computePipeNest({ pipeOuterDiameterM, pipeLengthM, pipeWeightKg: pipeWeightKg ?? 0, usableWidthM, pipeCount, maxStackHeightM })
      : null
  const color = PRESET_TEMPLATE_COLORS[tpl.name ?? ''] ?? PALETTE[pipeIndex % PALETTE.length]
  const waterWeightKg = waterText.trim()
    ? Math.max(0, (parseFloat(waterText.replace(',', '.')) || 0) * 1000)
    : undefined

  const handleAdd = () => {
    if (!nest || nest.pipeCount <= 0) return
    const pipesWeightKg = pipeWeightKg !== undefined ? nest.pipeCount * pipeWeightKg : undefined
    const totalWeightKg =
      pipesWeightKg !== undefined || waterWeightKg !== undefined
        ? (pipesWeightKg ?? 0) + (waterWeightKg ?? 0)
        : undefined
    addOrIncrementCargoFromTemplate({
      name: `${tpl.name} — штабель ${nest.pipeCount} шт`,
      width: nest.usableWidthM,
      length: nest.pipeLengthM,
      height: nest.heightM,
      weight: totalWeightKg,
      allowRotation: false,
      shape: 'pipe-nest',
      // A штабель already IS every tier of the nest (nest.tierCounts has
      // one entry per real tier) — its own `layers`/`maxLayers` must stay
      // 1, or the deck packer can stack whole штабели on top of each other
      // when clearance allows it. That would multiply weight correctly
      // (packDeck always does) but NOT scale computeItemVCG's
      // nestVcgAboveDeckM, which stays pinned to one штабель's own VCG
      // regardless of `layers` — silently understating KG under a
      // multi-штабель stack. The hand-authored pipe presets in
      // calculator.ts already set this; the builder-generated штабель here
      // did not.
      maxLayers: 1,
      color,
      nest:
        waterWeightKg !== undefined
          ? { ...nest, sourceNote: `${nest.sourceNote ? nest.sourceNote + ' ' : ''}Вода в трубах: ${fmtNumber(waterWeightKg / 1000)} т добавлена к весу штабеля (VCG принят равным VCG труб).` }
          : nest,
    })
  }

  return (
    <div className="flex w-full flex-wrap items-end gap-2 rounded-lg border p-2">
      <div className="flex flex-col gap-0.5">
        <label className="text-[10px] text-muted-foreground">Тип трубы</label>
        <select
          value={pipeIndex}
          onChange={(e) => setPipeIndex(Number(e.target.value))}
          className="h-7 rounded border bg-background px-1.5 text-xs"
        >
          {pipeItems.map((it, i) => (
            <option key={i} value={i}>{it.name}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-0.5">
        <label className="text-[10px] text-muted-foreground">Ширина палубы, {UNIT_LABEL[unit]}</label>
        <input
          type="text"
          inputMode="decimal"
          value={widthText}
          onChange={(e) => setWidthText(e.target.value)}
          className="h-7 w-20 rounded border bg-background px-1.5 text-xs"
        />
      </div>
      <div className="flex flex-col gap-0.5">
        <label className="text-[10px] text-muted-foreground">Труб (пусто = 2 яруса)</label>
        <input
          type="text"
          inputMode="numeric"
          placeholder={nest ? String(nest.pipesPerRow * 2) : ''}
          value={countText}
          onChange={(e) => setCountText(e.target.value)}
          className="h-7 w-24 rounded border bg-background px-1.5 text-xs"
        />
      </div>
      <div className="flex flex-col gap-0.5">
        <label className="text-[10px] text-muted-foreground">Вода в трубах, т (если есть)</label>
        <input
          type="text"
          inputMode="decimal"
          placeholder="нет данных"
          value={waterText}
          onChange={(e) => setWaterText(e.target.value)}
          className="h-7 w-24 rounded border bg-background px-1.5 text-xs"
        />
      </div>
      <Button size="sm" className="h-7 text-xs" disabled={!nest || nest.pipeCount <= 0} onClick={handleAdd}>
        Добавить штабель
      </Button>
      {nest && (
        <div className="basis-full text-[10px] text-muted-foreground">
          {nest.pipesPerRow} труб/ряд × {nest.tierCounts.length} яр. = {nest.pipeCount} шт ·
          {' '}высота {fmtNumber(nest.heightM)} м
          {pipeWeightKg !== undefined && <> · вес труб {fmtNumber((nest.pipeCount * pipeWeightKg) / 1000)} т</>}
          {waterWeightKg !== undefined && <> · + вода {fmtNumber(waterWeightKg / 1000)} т</>}
          {nest.crateHeightM !== REAL_CRATE_HEIGHT_M_OD1073M && (
            <> · высота клети {fmtNumber(nest.crateHeightM)} м — ОЦЕНКА, не измерена по чертежу для этого диаметра</>
          )}
          {nest.limited && (
            <span className="text-red-600"> · превышен лимит высоты штабеля — уложено {nest.pipeCount} из {nest.requestedPipeCount} труб</span>
          )}
        </div>
      )}
    </div>
  )
}
