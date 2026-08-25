'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, Pencil, Plug, Sparkles, Trash2, Square, Triangle, Circle, Diamond, Ban } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useCalculator, PRESETS, PALETTE, PRESET_TEMPLATE_COLORS, UNIT_LABEL, convertLength } from '@/store/calculator'
import { type CargoShape, type RestrictionZoneShape } from '@/lib/packing'
import { cn, fmtNumber } from '@/lib/utils'

// Stable empty-array reference — see the same pattern's comment in
// Sidebar.tsx (a fresh `[] ` every selector call looks like "the snapshot
// changed" to useSyncExternalStore and re-renders forever).
const EMPTY_POWER_SOCKETS: never[] = []
const EMPTY_RESTRICTION_ZONES: never[] = []

// Restriction zones aren't a cargo-template category (no CargoItem-shaped
// entries), so they get their own pseudo-key alongside PRESETS' real
// category keys rather than living inside one of those categories' item
// lists — a separate top-level button, not nested under "Объекты".
const RESTRICTION_ZONE_CATEGORY_KEY = '__restriction_zones__'

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
          </div>
          {activePresetCategory && activePresetCategory !== RESTRICTION_ZONE_CATEGORY_KEY && (
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
  onSelect,
}: {
  template: { name?: string; width?: number; length?: number; shape?: CargoShape }
  unitLabel: string
  color: string
  active: boolean
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
      </div>
      {active && <Badge variant="default" className="shrink-0 text-[10px]">активен</Badge>}
    </button>
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
