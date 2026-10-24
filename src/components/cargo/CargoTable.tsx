'use client'

import { Fragment, useId, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Copy, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NumberField } from '@/components/calculator/NumberField'
import { TextField } from '@/components/calculator/TextField'
import { CargoNumberTile } from '@/components/calculator/CargoNumberTile'
import { undoCalculator, useCalculator, UNIT_LABEL, type Unit } from '@/store/calculator'
import type { CargoItem, PlacedItem } from '@/lib/packing'
import { cargoTotals, DEFAULT_CATEGORIES, LAYERS_RULE, placedByItem, rangeOf, SIZE_AXES } from '@/lib/cargoTable'
import { isPipeCargo } from '@/lib/stabilityConditions'
import { cn, fmtNumber, fmtTonnes, pluralRu } from '@/lib/utils'

// The cargo table (spec 7.4): every cargo with all its fields, edited like a
// spreadsheet — Tab to the next cell, Enter to the same cell of the next
// row, Esc to undo the edit. Every field commits on Enter or on leaving it,
// as NumberField does everywhere. Rows are selected with their boxes, Shift
// for a range; the selection can be deleted or given one category.

// The cells Enter moves down through, by column.
type Column = 'name' | 'length' | 'width' | 'height' | 'weight' | 'quantity' | 'layers' | 'category' | 'contents'

const cellKey = (row: number, column: Column) => `${row}:${column}`


export function CargoTable({
  placedAcrossTrips,
  unit,
  hoveredItemId,
  onHover,
}: {
  // Every trip's placements: «Размещено» counts a unit on any trip.
  placedAcrossTrips: PlacedItem[]
  unit: Unit
  hoveredItemId: string | null
  onHover: (id: string | null) => void
}) {
  const items = useCalculator((s) => s.items)
  const addItem = useCalculator((s) => s.addItem)
  const updateItem = useCalculator((s) => s.updateItem)
  const removeItem = useCalculator((s) => s.removeItem)
  const duplicateItem = useCalculator((s) => s.duplicateItem)
  const setItemStabilityOverride = useCalculator((s) => s.setItemStabilityOverride)
  const globalRotation = useCalculator((s) => s.globalRotation)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [bulkCategory, setBulkCategory] = useState('')
  // A value pulled back to a bound, said in its cell until it's edited again.
  const [cellError, setCellError] = useState<{ cell: string; text: string } | null>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  const categoryListId = useId()

  const placed = useMemo(() => placedByItem(placedAcrossTrips), [placedAcrossTrips])
  const totals = cargoTotals(items)
  const ids = items.map((it) => it.id)
  const selectedIds = ids.filter((id) => selected.has(id))
  const categoryOptions = Array.from(new Set([...DEFAULT_CATEGORIES, ...items.map((it) => it.category).filter((c): c is string => !!c)]))
  const u = UNIT_LABEL[unit]

  const select = (id: string, shift: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (shift && anchor) {
        const on = !prev.has(id)
        for (const r of rangeOf(ids, anchor, id)) {
          if (on) next.add(r)
          else next.delete(r)
        }
      } else if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setAnchor(id)
  }

  const removeWithUndo = (targets: CargoItem[]) => {
    for (const it of targets) removeItem(it.id)
    setSelected((prev) => new Set([...prev].filter((id) => !targets.some((t) => t.id === id))))
    const what = targets.length === 1 ? `Груз «${targets[0].name}» удалён` : `Удалено грузов: ${targets.length}`
    toast.info(what, { action: { label: 'Отменить', onClick: () => undoCalculator() } })
  }

  // Enter: the same column one row down, once the cell has committed.
  const onKeyDownCapture = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return
    const cell = (e.target as HTMLElement).dataset?.cell
    if (!cell) return
    const [row, column] = cell.split(':')
    setTimeout(() => tableRef.current?.querySelector<HTMLInputElement>(`[data-cell="${Number(row) + 1}:${column}"]`)?.focus())
  }

  const clamped = (cell: string) => (info: { bound: 'min' | 'max'; limit: number }) =>
    setCellError({ cell, text: `${info.bound === 'min' ? 'Не меньше' : 'Не больше'} ${fmtNumber(info.limit)}` })
  const errorFor = (cell: string) =>
    cellError?.cell === cell ? (
      <p role="alert" className="mt-0.5 text-xs text-danger">
        {cellError.text}
      </p>
    ) : null
  const commit = (cell: string, apply: () => void) => {
    if (cellError?.cell === cell) setCellError(null)
    apply()
  }

  const numberCell = (
    row: number,
    column: Column,
    label: string,
    value: number | undefined,
    onCommit: (v: number) => void,
    options: { min?: number; integer?: boolean; onClear?: () => void; placeholder?: string } = {}
  ) => {
    const cell = cellKey(row, column)
    return (
      <>
        <NumberField
          data-cell={cell}
          aria-label={`${label}, ${items[row].name}`}
          value={value}
          min={options.min}
          integer={options.integer}
          placeholder={options.placeholder}
          selectOnFocus
          onClamp={clamped(cell)}
          onCommit={(v) => commit(cell, () => onCommit(v))}
          onClear={options.onClear && (() => commit(cell, options.onClear!))}
          className="h-7 w-full min-w-12 px-1.5 text-right text-xs tabular-nums"
        />
        {errorFor(cell)}
      </>
    )
  }

  const textCell = (row: number, column: Column, label: string, value: string, onCommit: (v: string) => void, options: { list?: string; placeholder?: string } = {}) => (
    <TextField
      data-cell={cellKey(row, column)}
      label={`${label}, ${items[row].name}`}
      value={value}
      list={options.list}
      placeholder={options.placeholder}
      onCommit={onCommit}
      className="h-7 w-full min-w-24 px-1.5 text-xs"
    />
  )

  const allSelected = items.length > 0 && selectedIds.length === items.length

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8"
          onClick={() => {
            addItem()
            setTimeout(() => tableRef.current?.querySelector<HTMLInputElement>(`[data-cell="${items.length}:name"]`)?.focus())
          }}
        >
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
          Добавить груз
        </Button>
        {selectedIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Выбранные грузы">
            <span className="text-ink-2">Выбрано: {selectedIds.length}</span>
            <Input
              aria-label="Новая категория выбранных грузов"
              list={categoryListId}
              value={bulkCategory}
              onChange={(e) => setBulkCategory(e.target.value)}
              placeholder="Категория"
              className="h-8 w-44 text-sm"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => {
                for (const id of selectedIds) updateItem(id, { category: bulkCategory.trim() || undefined })
                toast.success(`Категория «${bulkCategory.trim() || 'Обычный'}»: ${selectedIds.length} ${pluralRu(selectedIds.length, 'груз', 'груза', 'грузов')}`)
                setBulkCategory('')
              }}
            >
              Сменить категорию
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 hover:text-danger"
              onClick={() => removeWithUndo(items.filter((it) => selected.has(it.id)))}
            >
              <Trash2 className="mr-1 h-4 w-4" aria-hidden="true" />
              Удалить
            </Button>
            <button type="button" onClick={() => setSelected(new Set())} className="text-sm text-ink-2 underline hover:text-ink">
              Снять выделение
            </button>
          </div>
        )}
      </div>
      <datalist id={categoryListId}>
        {categoryOptions.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <div className="min-h-0 flex-1 overflow-auto">
        {items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-2">Грузов нет. Добавьте груз кнопкой выше или из каталога в разделе «Грузы».</p>
        ) : (
          <table ref={tableRef} className="w-full min-w-[1180px] border-collapse text-sm" aria-label="Таблица грузов" onKeyDownCapture={onKeyDownCapture}>
            <thead className="sticky top-0 z-10 bg-surface text-xs text-ink-2">
              <tr className="border-b border-line">
                <th scope="col" className="w-20 px-2 py-1.5 text-left font-medium">
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      aria-label="Выбрать все грузы"
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(ids))}
                      className="h-3.5 w-3.5 accent-primary"
                    />
                    №
                  </span>
                </th>
                <th scope="col" className="px-1 py-1.5 text-left font-medium">Название</th>
                <th scope="col" className="w-56 px-1 py-1.5 text-right font-medium">
                  <abbr title={SIZE_AXES} className="no-underline">
                    Д×Ш×В, {u}
                  </abbr>
                </th>
                <th scope="col" className="w-20 px-1 py-1.5 text-right font-medium">Вес ед., т</th>
                <th scope="col" className="w-16 px-1 py-1.5 text-right font-medium">Кол-во</th>
                <th scope="col" className="w-32 px-1 py-1.5 text-right font-medium">Размещено</th>
                <th scope="col" className="w-16 px-1 py-1.5 text-right font-medium">
                  <abbr title={LAYERS_RULE} className="no-underline">
                    Ярусов
                  </abbr>
                </th>
                <th scope="col" className="w-16 px-1 py-1.5 text-center font-medium">Поворот</th>
                <th scope="col" className="w-36 px-1 py-1.5 text-left font-medium">Категория</th>
                <th scope="col" className="w-44 px-1 py-1.5 text-left font-medium">Содержимое</th>
                <th scope="col" className="w-24 px-2 py-1.5 text-right font-medium">
                  <span className="sr-only">Действия</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, row) => {
                const p = placed.get(it.id) ?? { units: 0, stacks: 0 }
                const open = expanded.has(it.id)
                const over = p.units > it.quantity
                return (
                  <Fragment key={it.id}>
                    <tr
                      className={cn('border-b border-line align-top', selected.has(it.id) && 'bg-accent/60', hoveredItemId === it.id && 'bg-accent')}
                      onMouseEnter={() => onHover(it.id)}
                      onMouseLeave={() => onHover(null)}
                      data-testid="cargo-row"
                    >
                      <td className="px-2 py-1">
                        <span className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            aria-label={`Выбрать «${it.name}»`}
                            checked={selected.has(it.id)}
                            onChange={() => {}}
                            onClick={(e) => select(it.id, e.shiftKey)}
                            className="h-3.5 w-3.5 accent-primary"
                          />
                          <CargoNumberTile number={row + 1} className="h-7 w-7 text-xs" />
                        </span>
                      </td>
                      <td className="px-1 py-1">{textCell(row, 'name', 'Название', it.name, (v) => updateItem(it.id, { name: v.trim() || it.name }))}</td>
                      <td className="px-1 py-1">
                        <div className="flex items-start gap-1">
                          <div className="flex-1">
                            {numberCell(row, 'length', 'Длина', it.length, (v) => updateItem(it.id, { length: v }), { min: 0.01 })}
                          </div>
                          <span className="pt-1 text-ink-2" aria-hidden="true">
                            ×
                          </span>
                          <div className="flex-1">
                            {numberCell(row, 'width', 'Ширина', it.width, (v) => updateItem(it.id, { width: v }), { min: 0.01 })}
                          </div>
                          <span className="pt-1 text-ink-2" aria-hidden="true">
                            ×
                          </span>
                          <div className="flex-1">
                            {numberCell(row, 'height', 'Высота', it.height > 0 ? it.height : undefined, (v) => updateItem(it.id, { height: v }), {
                              min: 0,
                              placeholder: '—',
                              onClear: () => updateItem(it.id, { height: 0 }),
                            })}
                          </div>
                        </div>
                      </td>
                      <td className="px-1 py-1">
                        {numberCell(row, 'weight', 'Вес единицы, т', it.weight !== undefined ? it.weight / 1000 : undefined, (v) => updateItem(it.id, { weight: v * 1000 }), {
                          min: 0,
                          placeholder: '—',
                          onClear: () => updateItem(it.id, { weight: undefined }),
                        })}
                      </td>
                      <td className="px-1 py-1">
                        {numberCell(row, 'quantity', 'Количество', it.quantity, (v) => updateItem(it.id, { quantity: v }), { min: 1, integer: true })}
                      </td>
                      <td className={cn('whitespace-nowrap px-1 py-1.5 text-right tabular-nums', over && 'font-medium text-danger')} data-testid="cargo-placed">
                        {p.units} из {it.quantity}
                        {p.stacks > 0 && (
                          <span className="block text-xs text-ink-2">
                            {p.stacks} {pluralRu(p.stacks, 'штабель', 'штабеля', 'штабелей')}
                          </span>
                        )}
                      </td>
                      <td className="px-1 py-1">
                        {numberCell(row, 'layers', 'Ярусов', it.maxLayers, (v) => updateItem(it.id, { maxLayers: v > 0 ? v : undefined }), {
                          min: 0,
                          integer: true,
                          placeholder: 'авто',
                          onClear: () => updateItem(it.id, { maxLayers: undefined }),
                        })}
                      </td>
                      <td className="px-1 py-1.5 text-center">
                        <input
                          type="checkbox"
                          aria-label={`Поворот, ${it.name}`}
                          checked={it.allowRotation}
                          disabled={!globalRotation}
                          title={globalRotation ? 'Авторасстановка может поворачивать этот груз' : 'Поворот запрещён в разделе «Размещение»'}
                          onChange={() => updateItem(it.id, { allowRotation: !it.allowRotation })}
                          className="h-3.5 w-3.5 accent-primary disabled:opacity-50"
                        />
                      </td>
                      <td className="px-1 py-1">
                        {textCell(row, 'category', 'Категория', it.category ?? '', (v) => updateItem(it.id, { category: v.trim() || undefined }), {
                          list: categoryListId,
                          placeholder: 'Обычный',
                        })}
                      </td>
                      <td className="px-1 py-1">{textCell(row, 'contents', 'Содержимое', it.contents ?? '', (v) => updateItem(it.id, { contents: v.trim() || undefined }))}</td>
                      <td className="px-2 py-1">
                        <span className="flex items-center justify-end gap-0.5">
                          <IconButton
                            label={`${open ? 'Скрыть' : 'Дополнительно'}: ${it.name}`}
                            onClick={() =>
                              setExpanded((prev) => {
                                const next = new Set(prev)
                                if (next.has(it.id)) next.delete(it.id)
                                else next.add(it.id)
                                return next
                              })
                            }
                            expanded={open}
                          >
                            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </IconButton>
                          <IconButton
                            label={`Дублировать: ${it.name}`}
                            onClick={() => {
                              duplicateItem(it.id)
                              toast.success(`Груз «${it.name}» дублирован`)
                            }}
                          >
                            <Copy className="h-4 w-4" />
                          </IconButton>
                          <IconButton label={`Удалить: ${it.name}`} onClick={() => removeWithUndo([it])} danger>
                            <Trash2 className="h-4 w-4" />
                          </IconButton>
                        </span>
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-b border-line bg-paper">
                        <td />
                        <td colSpan={10} className="px-1 py-2">
                          <MoreFields item={it} unitLabel={u} onUpdate={(patch) => updateItem(it.id, patch)} onSetOverride={(o) => setItemStabilityOverride(it.id, o)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="text-sm text-ink-2" data-testid="cargo-totals">
                <td colSpan={11} className="px-2 py-2">
                  Итого: {totals.units} {pluralRu(totals.units, 'единица', 'единицы', 'единиц')} · {fmtTonnes(totals.weightKg)} т
                  {totals.unweighed > 0 && ` (без веса: ${totals.unweighed})`} · {fmtNumber(totals.area)} {u}²
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  )
}

function IconButton({
  label,
  onClick,
  danger,
  expanded,
  children,
}: {
  label: string
  onClick: () => void
  danger?: boolean
  expanded?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded text-ink-2 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        danger ? 'hover:text-danger' : 'hover:text-ink'
      )}
    >
      <span aria-hidden="true">{children}</span>
    </button>
  )
}

// «Дополнительно» (spec 7.4): the centre-of-gravity corrections for the
// stability, the cargo's own stack-height limit, and for pipes the inside
// diameter and the water in them (stage 2a). All empty by default — empty
// is «automatic», not 0. The corrections are kept in the deck's unit, like
// every other length of the cargo (stability.ts converts them to metres);
// the stack-height limit alone is in metres whatever the unit.
function MoreFields({
  item,
  unitLabel,
  onUpdate,
  onSetOverride,
}: {
  item: CargoItem
  unitLabel: string
  onUpdate: (patch: Partial<CargoItem>) => void
  onSetOverride: (o: CargoItem['stabilityOverride']) => void
}) {
  const o = item.stabilityOverride
  const set = (patch: Partial<NonNullable<CargoItem['stabilityOverride']>>) => {
    const next = { ...o, ...patch }
    const empty = next.vcgAboveDeckM === undefined && next.tcgOffsetM === undefined && next.lcgOffsetM === undefined
    onSetOverride(empty ? undefined : next)
  }
  const hasOverride = o?.vcgAboveDeckM !== undefined || o?.tcgOffsetM !== undefined || o?.lcgOffsetM !== undefined
  const pipe = isPipeCargo(item)
  return (
    <div className="flex flex-wrap items-end gap-3">
      <MoreNumber label={`VCG над палубой, ${unitLabel}`} value={o?.vcgAboveDeckM} placeholder="авто" onChange={(v) => set({ vcgAboveDeckM: v })} />
      <MoreNumber label={`Сдвиг TCG, ${unitLabel} (+ правый борт)`} value={o?.tcgOffsetM} placeholder="0" signed onChange={(v) => set({ tcgOffsetM: v })} />
      <MoreNumber label={`Сдвиг LCG, ${unitLabel} (+ к носу)`} value={o?.lcgOffsetM} placeholder="0" signed onChange={(v) => set({ lcgOffsetM: v })} />
      <MoreNumber label="Предельная высота штабеля, м" value={item.maxStackHeightM} placeholder="как у палубы" onChange={(v) => onUpdate({ maxStackHeightM: v })} />
      {pipe && (
        <>
          <MoreNumber label="Внутренний диаметр, мм" value={item.pipeInnerDiameterMm} placeholder="не задан" onChange={(v) => onUpdate({ pipeInnerDiameterMm: v })} />
          <MoreNumber label="Вода в трубах, т (на 1 шт.)" value={item.trappedWaterT} placeholder="по расчёту" onChange={(v) => onUpdate({ trappedWaterT: v })} />
        </>
      )}
      <Button type="button" variant="ghost" size="sm" className="h-8 text-ink-2" disabled={!hasOverride} onClick={() => onSetOverride(undefined)}>
        Сбросить поправки
      </Button>
      {pipe && (
        <p className={cn('basis-full text-xs', item.trappedWaterT === undefined && !item.pipeInnerDiameterMm ? 'text-warn' : 'text-ink-2')}>
          {item.trappedWaterT !== undefined
            ? `Вода: ${fmtNumber(item.trappedWaterT)} × ${item.quantity} = ${fmtNumber(item.trappedWaterT * item.quantity)} т — вместо расчёта`
            : item.pipeInnerDiameterMm
              ? 'Вода в трубах считается по внутреннему диаметру и укладке'
              : 'Без внутреннего диаметра вода в трубах не считается'}
        </p>
      )}
    </div>
  )
}

function MoreNumber({
  label,
  value,
  placeholder,
  signed,
  onChange,
}: {
  label: string
  value: number | undefined
  placeholder: string
  signed?: boolean
  onChange: (v: number | undefined) => void
}) {
  const id = useId()
  return (
    <div className="w-40 space-y-0.5">
      <label htmlFor={id} className="block text-xs text-ink-2">
        {label}
      </label>
      <NumberField
        id={id}
        value={value}
        min={signed ? undefined : 0}
        placeholder={placeholder}
        onCommit={onChange}
        onClear={() => onChange(undefined)}
        className="h-7 text-right text-xs tabular-nums"
      />
    </div>
  )
}
