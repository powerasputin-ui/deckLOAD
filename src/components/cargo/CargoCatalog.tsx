'use client'

import { useId, useMemo, useState } from 'react'
import { Pencil, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCalculator, PRESETS, PALETTE, PRESET_TEMPLATE_COLORS, UNIT_LABEL, convertLength } from '@/store/calculator'
import { polygonArea, type CargoItem, type CargoShape } from '@/lib/packing'
import { computePipeNest, REAL_CRATE_HEIGHT_M_OD1073M } from '@/lib/pipeNest'
import { ownSize, searchCatalog, templateInUnit, type CatalogGroup } from '@/lib/cargoCatalog'
import { parseNumberInput } from '@/lib/numberInput'
import { cn, fmtNumber, fmtTonnes } from '@/lib/utils'

// The catalogue (spec 7.2) in the order of the spec: cargo only — the
// obstacles, marks and sockets moved to «Судно».
const GROUPS: CatalogGroup[] = [
  { key: 'containers', label: PRESETS.containers.label, items: PRESETS.containers.items },
  { key: 'pallets', label: PRESETS.pallets.label, items: PRESETS.pallets.items },
  { key: 'mixed', label: PRESETS.mixed.label, items: PRESETS.mixed.items },
  { key: 'pipes', label: PRESETS.pipes.label, items: PRESETS.pipes.items, tool: 'Конструктор штабеля' },
  { key: 'objects', label: PRESETS.objects.label, items: PRESETS.objects.items, tool: 'Нарисовать форму' },
]

// A choice adds the cargo with quantity 1, or 1 more of the same one. In
// manual mode it's armed for a click on the deck; in auto mode the packer
// puts it on the deck by itself.
export function CargoCatalog() {
  const unit = useCalculator((s) => s.deck.unit)
  const mode = useCalculator((s) => s.mode)
  const items = useCalculator((s) => s.items)
  const addOrIncrementCargoFromTemplate = useCalculator((s) => s.addOrIncrementCargoFromTemplate)
  const setActiveStamp = useCalculator((s) => s.setActiveStamp)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  // What the last choice did, for a screen reader; the template's own «в
  // списке N» shows it on screen.
  const [announcement, setAnnouncement] = useState('')
  const headingId = useId()
  const u = UNIT_LABEL[unit]

  const shown = useMemo(() => searchCatalog(category ? GROUPS.filter((g) => g.key === category) : GROUPS, query), [category, query])
  const inList = (name: string | undefined) => items.find((it) => it.name === name)?.quantity ?? 0

  const choose = (template: Partial<CargoItem>, index: number) => {
    const color = PRESET_TEMPLATE_COLORS[template.name ?? ''] ?? PALETTE[index % PALETTE.length]
    const id = addOrIncrementCargoFromTemplate({ ...templateInUnit(template, unit), color })
    if (mode === 'manual') setActiveStamp(id)
    const quantity = useCalculator.getState().items.find((it) => it.id === id)?.quantity ?? 1
    setAnnouncement(`«${template.name}» в списке: ${quantity} ед.${mode === 'manual' ? ' Кликните по палубе, чтобы поставить.' : ''}`)
  }

  return (
    <section aria-label="Каталог грузов" id="cargo-catalog" className="space-y-3 border-y border-line px-4 py-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-2" aria-hidden="true" />
        <Input
          type="search"
          aria-label="Поиск по каталогу"
          placeholder="Поиск: контейнер, труба…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-8 pl-8 text-sm"
        />
      </div>
      <div role="group" aria-label="Категории каталога" className="flex flex-wrap gap-1.5">
        {GROUPS.map((g) => (
          <button
            key={g.key}
            type="button"
            aria-pressed={category === g.key}
            onClick={() => setCategory(category === g.key ? null : g.key)}
            className={cn(
              'h-7 rounded-md border px-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              category === g.key ? 'border-line-strong bg-accent font-medium' : 'border-line hover:bg-accent'
            )}
          >
            {g.label}
          </button>
        ))}
      </div>
      <p role="status" className="sr-only">
        {announcement}
      </p>

      <div className="thin-scrollbar -mx-2 max-h-96 space-y-3 overflow-y-auto px-2">
        {shown.length === 0 && <p className="py-2 text-sm text-ink-2">Ничего не найдено. Задайте груз сами — «Свой груз».</p>}
        {shown.map((g) => (
          <section key={g.key} aria-labelledby={`${headingId}-${g.key}`} className="space-y-1">
            <h4 id={`${headingId}-${g.key}`} className="text-xs font-semibold text-ink-2">
              {g.label}
            </h4>
            {/* A stack on a timber crib is how pipes go on deck: its builder
                comes first, single pipes after it. */}
            {g.key === 'pipes' && <PipeNestBuilder />}
            {g.key === 'pipes' && g.items.length > 0 && <p className="pt-1 text-xs text-ink-2">Одна труба, без штабеля:</p>}
            {g.items.length > 0 && (
              <ul className="-mx-2">
                {g.items.map((tpl) => {
                  const inUnit = templateInUnit(tpl, unit)
                  const count = inList(tpl.name)
                  // The index in the group's full list: the same fallback
                  // colour whatever the search leaves.
                  const index = PRESETS[g.key].items.indexOf(tpl)
                  const size = `${ownSize(inUnit).map(fmtNumber).join('×')} ${u}`
                  const weight = tpl.weight ? `${fmtTonnes(tpl.weight)} т` : 'вес не задан'
                  return (
                    <li key={tpl.name}>
                      <button
                        type="button"
                        // The name first, then what the line under it says.
                        aria-label={[tpl.name, size, weight, count > 0 && `в списке ${count}`].filter(Boolean).join(', ')}
                        onClick={() => choose(tpl, index)}
                        className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <ShapeGlyph shape={tpl.shape} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{tpl.name}</span>
                          <span className="block text-xs text-ink-2 tabular-nums">
                            {size} · {weight}
                          </span>
                        </span>
                        {count > 0 && <span className="shrink-0 text-xs text-ink-2 tabular-nums">в списке {count}</span>}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            {g.key === 'objects' && <DrawShapeTool />}
          </section>
        ))}
      </div>
    </section>
  )
}

// The template's outline in the list — not its colour: on the deck a cargo
// takes the tone of its number.
function ShapeGlyph({ shape }: { shape?: CargoShape }) {
  const common = 'h-5 w-5 shrink-0 text-ink-2'
  return (
    <svg viewBox="0 0 20 20" className={common} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.5}>
      {shape === 'circle' ? (
        <circle cx={10} cy={10} r={7} />
      ) : shape === 'oval' ? (
        <ellipse cx={10} cy={10} rx={8} ry={5.5} />
      ) : shape === 'triangle' ? (
        <path d="M10 3 L17.5 16.5 H2.5 Z" />
      ) : shape === 'diamond' ? (
        <path d="M10 2.5 L17.5 10 L10 17.5 L2.5 10 Z" />
      ) : shape === 'cylinder' || shape === 'pipe-nest' ? (
        <>
          <rect x={2.5} y={6.5} width={15} height={7} rx={3.5} />
          <ellipse cx={14} cy={10} rx={2} ry={3.5} />
        </>
      ) : (
        <rect x={3} y={5} width={14} height={10} rx={1} />
      )}
    </svg>
  )
}

// «Нарисовать форму»: a cargo with an outline of its own, drawn by points.
function DrawShapeTool() {
  const drawing = useCalculator((s) => s.drawingCustomShape)
  const setDrawing = useCalculator((s) => s.setDrawingCustomShape)
  return (
    <div className="space-y-1.5 pt-1">
      <button
        type="button"
        aria-pressed={drawing}
        onClick={() => setDrawing(!drawing)}
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          drawing ? 'border-line-strong bg-accent font-medium' : 'border-line hover:bg-accent'
        )}
      >
        <Pencil className="h-4 w-4" aria-hidden="true" />
        Нарисовать форму
      </button>
      {drawing && (
        <p className="text-xs text-ink-2">
          Кликайте по палубе, ставя точки контура (не меньше 3), и замкните его кликом у первой точки. Backspace — убрать точку, Esc — отмена.
        </p>
      )}
    </div>
  )
}

// The drawn outline's second step: its name and weight, then it's placed
// where it was drawn. The outline stays on the deck meanwhile (spec 7.2).
export function CustomShapeForm({ onPlace }: { onPlace: (name: string, weightKg?: number) => void }) {
  const pending = useCalculator((s) => s.pendingCustomShape)
  const setPending = useCalculator((s) => s.setPendingCustomShape)
  const unit = useCalculator((s) => s.deck.unit)
  const [name, setName] = useState('')
  const [weight, setWeight] = useState('')
  const nameId = useId()
  const weightId = useId()
  if (!pending) return null
  const u = UNIT_LABEL[unit]
  const parsedWeight = parseNumberInput(weight, { min: 0 })
  const weightBad = parsedWeight.kind === 'invalid'
  return (
    <form
      aria-label="Своя форма"
      className="mx-4 mt-3 space-y-2 rounded-md border border-line-strong p-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim() || weightBad) return
        onPlace(name.trim(), parsedWeight.kind === 'ok' && parsedWeight.value > 0 ? parsedWeight.value * 1000 : undefined)
        setName('')
        setWeight('')
      }}
    >
      <p className="text-sm">
        Контур готов: {fmtNumber(pending.width)}×{fmtNumber(pending.length)} {u}, S {fmtNumber(polygonArea(pending.outline))} {u}². Назовите груз — он встанет там, где нарисован.
      </p>
      <div className="grid grid-cols-[1fr_7rem] gap-2">
        <div className="space-y-0.5">
          <label htmlFor={nameId} className="block text-xs text-ink-2">
            Название
          </label>
          <Input id={nameId} autoFocus value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-sm" />
        </div>
        <div className="space-y-0.5">
          <label htmlFor={weightId} className="block text-xs text-ink-2">
            Вес, т
          </label>
          <Input
            id={weightId}
            inputMode="decimal"
            placeholder="не задан"
            value={weight}
            aria-invalid={weightBad || undefined}
            onChange={(e) => setWeight(e.target.value)}
            className="h-8 text-right text-sm tabular-nums"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="outline" className="h-8 flex-1" disabled={!name.trim() || weightBad}>
          Поставить на палубу
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setPending(null)}>
          Отмена
        </Button>
      </div>
    </form>
  )
}

// Builds a real pipe stack as ONE cargo item (shape 'pipe-nest') from a
// chosen pipe type — see src/lib/pipeNest.ts for the geometry (straight,
// equal-count tiers on a timber crib, ДВТК/638.362241.023 п. 2.1.2/2.1.3).
// A pipe template's own width/length/height describe a SINGLE pipe
// (width = pipe length, length = height = outer diameter) — reused here as
// the nest's pipeLengthM/pipeOuterDiameterM inputs, not duplicated.
function PipeNestBuilder() {
  const deckWidth = useCalculator((s) => s.deck.width)
  const deckClearance = useCalculator((s) => s.deck.clearance)
  const unit = useCalculator((s) => s.deck.unit)
  const addOrIncrementCargoFromTemplate = useCalculator((s) => s.addOrIncrementCargoFromTemplate)
  const pipeItems = PRESETS.pipes.items
  const [pipeIndex, setPipeIndex] = useState(0)
  // The stack's width and pipe count are entered in the deck's own unit,
  // converted to metres only for the geometry — computePipeNest works in
  // metres throughout.
  const [widthText, setWidthText] = useState(() => fmtNumber(deckWidth))
  const [countText, setCountText] = useState('')
  // Water trapped in the stack, when the transport project states it. Left
  // empty, the stability check estimates it by the IS Code rule. Kept apart
  // from the pipes' weight (CargoItem.trappedWaterT).
  const [waterText, setWaterText] = useState('')
  const [prevDeckWidth, setPrevDeckWidth] = useState(deckWidth)
  if (deckWidth !== prevDeckWidth) {
    setPrevDeckWidth(deckWidth)
    setWidthText(fmtNumber(deckWidth))
  }
  const ids = { type: useId(), width: useId(), count: useId(), water: useId() }

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
  const waterWeightKg = waterText.trim() ? Math.max(0, (parseFloat(waterText.replace(',', '.')) || 0) * 1000) : undefined

  const handleAdd = () => {
    if (!nest || nest.pipeCount <= 0) return
    const pipesWeightKg = pipeWeightKg !== undefined ? nest.pipeCount * pipeWeightKg : undefined
    // The stack's sides go to the cargo in the deck's unit, like every
    // cargo's; the nest itself stays in metres for the stability.
    const toUnit = (m: number) => convertLength(m, 'm', unit)
    addOrIncrementCargoFromTemplate({
      name: `${tpl.name} — штабель ${nest.pipeCount} шт`,
      width: toUnit(nest.usableWidthM),
      length: toUnit(nest.pipeLengthM),
      height: toUnit(nest.heightM),
      weight: pipesWeightKg,
      pipeInnerDiameterMm: tpl.pipeInnerDiameterMm,
      trappedWaterT: waterWeightKg !== undefined ? waterWeightKg / 1000 : undefined,
      allowRotation: false,
      shape: 'pipe-nest',
      // A stack already IS every tier of the nest — its own layers must stay
      // 1, or the packer could stack whole stacks on each other while the
      // stability keeps one stack's VCG (nest.vcgAboveDeckM).
      maxLayers: 1,
      color,
      nest,
    })
  }

  const field = 'h-8 w-full rounded-md border border-input bg-background px-2 text-sm tabular-nums'
  return (
    <div className="space-y-2 rounded-md border border-line p-2.5" role="group" aria-label="Конструктор штабеля">
      <p className="text-xs font-semibold text-ink-2">Конструктор штабеля</p>
      <div className="space-y-0.5">
        <label htmlFor={ids.type} className="block text-xs text-ink-2">
          Тип трубы
        </label>
        <select id={ids.type} value={pipeIndex} onChange={(e) => setPipeIndex(Number(e.target.value))} className={field}>
          {pipeItems.map((it, i) => (
            <option key={i} value={i}>
              {it.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-0.5">
          <label htmlFor={ids.width} className="block text-xs text-ink-2">
            Ширина, {UNIT_LABEL[unit]}
          </label>
          <input id={ids.width} type="text" inputMode="decimal" value={widthText} onChange={(e) => setWidthText(e.target.value)} className={field} />
        </div>
        <div className="space-y-0.5">
          <label htmlFor={ids.count} className="block text-xs text-ink-2">
            Труб
          </label>
          <input
            id={ids.count}
            type="text"
            inputMode="numeric"
            placeholder={nest ? String(nest.pipesPerRow * 2) : ''}
            value={countText}
            onChange={(e) => setCountText(e.target.value)}
            className={field}
          />
        </div>
        <div className="space-y-0.5">
          <label htmlFor={ids.water} className="block text-xs text-ink-2">
            Вода, т
          </label>
          <input
            id={ids.water}
            type="text"
            inputMode="decimal"
            placeholder="нет"
            value={waterText}
            onChange={(e) => setWaterText(e.target.value)}
            className={field}
          />
        </div>
      </div>
      <p className="text-xs text-ink-2">Пусто в «Труб» — два яруса. «Вода» — если её вес дан в проекте перевозки, иначе она оценивается.</p>
      {nest && (
        <p className="text-xs text-ink-2">
          {nest.pipesPerRow} труб в ряд × {nest.tierCounts.length} яр. = {nest.pipeCount} шт · высота {fmtNumber(nest.heightM)} м
          {pipeWeightKg !== undefined && <> · вес труб {fmtNumber((nest.pipeCount * pipeWeightKg) / 1000)} т</>}
          {waterWeightKg !== undefined && <> · вода {fmtNumber(waterWeightKg / 1000)} т</>}
          {nest.crateHeightM !== REAL_CRATE_HEIGHT_M_OD1073M && <> · высота клети {fmtNumber(nest.crateHeightM)} м — оценка, не по чертежу для этого диаметра</>}
          {nest.limited && (
            <span className="text-danger"> · выше предельной высоты: уложено {nest.pipeCount} из {nest.requestedPipeCount} труб</span>
          )}
        </p>
      )}
      <Button type="button" size="sm" variant="outline" className="h-8 w-full" disabled={!nest || nest.pipeCount <= 0} onClick={handleAdd}>
        Добавить штабель
      </Button>
    </div>
  )
}
