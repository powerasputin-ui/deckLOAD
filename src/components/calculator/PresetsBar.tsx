'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, Pencil, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useCalculator, PRESETS, PALETTE, PRESET_TEMPLATE_COLORS, UNIT_LABEL, convertLength } from '@/store/calculator'
import { type CargoShape } from '@/lib/packing'
import { computePipeNest, REAL_CRATE_HEIGHT_M_OD1073M } from '@/lib/pipeNest'
import { cn, fmtNumber } from '@/lib/utils'

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
  const unit = useCalculator((s) => s.deck.unit)
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
          <p className="text-xs text-muted-foreground leading-tight">
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
          </div>
          {activePresetCategory && PRESETS[activePresetCategory] && (
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
                      <span className="block text-xs text-muted-foreground">свой контур по точкам</span>
                    </span>
                  </button>
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
          {pendingPresetStamp && (
            <p className="text-xs text-muted-foreground leading-tight">
              «{pendingPresetStamp.name}» готов — кликните по палубе, чтобы разместить.
            </p>
          )}
          {drawingCustomShape && (
            <p className="text-xs text-muted-foreground leading-tight">
              Кликайте по палубе, чтобы поставить точки контура (минимум 3), затем кликните рядом с первой точкой, чтобы замкнуть. Backspace — убрать последнюю точку, Esc — отменить.
            </p>
          )}
          {pendingCustomShape && (
            <div className="max-w-xs space-y-1.5 rounded-lg border p-2">
              <p className="text-xs text-muted-foreground leading-tight">
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
        <div className="text-xs text-muted-foreground">
          {fmtNumber(template.width ?? 0)}×{fmtNumber(template.length ?? 0)} {unitLabel}
        </div>
        {hint && <div className="text-xs italic text-muted-foreground/80">{hint}</div>}
      </div>
      {active && <Badge variant="default" className="shrink-0 text-xs">активен</Badge>}
    </button>
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
  // Water trapped in the stack, when the transport project states it (a
  // real line item for some projects, ~4% of stack weight in the one source
  // document seen so far). Left EMPTY by default: then the stability check
  // estimates it by the IS Code rule. Kept apart from the pipes' weight
  // (CargoItem.trappedWaterT), at the stack's own VCG — it's spread along
  // the pipes' full length.
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
    addOrIncrementCargoFromTemplate({
      name: `${tpl.name} — штабель ${nest.pipeCount} шт`,
      width: nest.usableWidthM,
      length: nest.pipeLengthM,
      height: nest.heightM,
      weight: pipesWeightKg,
      pipeInnerDiameterMm: tpl.pipeInnerDiameterMm,
      trappedWaterT: waterWeightKg !== undefined ? waterWeightKg / 1000 : undefined,
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
      nest,
    })
  }

  return (
    <div className="flex w-full flex-wrap items-end gap-2 rounded-lg border p-2">
      <div className="flex flex-col gap-0.5">
        <label className="text-xs text-muted-foreground">Тип трубы</label>
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
        <label className="text-xs text-muted-foreground">Ширина палубы, {UNIT_LABEL[unit]}</label>
        <input
          type="text"
          inputMode="decimal"
          value={widthText}
          onChange={(e) => setWidthText(e.target.value)}
          className="h-7 w-20 rounded border bg-background px-1.5 text-xs"
        />
      </div>
      <div className="flex flex-col gap-0.5">
        <label className="text-xs text-muted-foreground">Труб (пусто = 2 яруса)</label>
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
        <label className="text-xs text-muted-foreground">Вода в трубах, т (если есть)</label>
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
        <div className="basis-full text-xs text-muted-foreground">
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
