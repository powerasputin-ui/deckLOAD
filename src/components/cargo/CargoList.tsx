'use client'

import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { CargoNumberTile } from '@/components/calculator/CargoNumberTile'
import { NumberField } from '@/components/calculator/NumberField'
import { useCalculator } from '@/store/calculator'
import { placedByItem } from '@/lib/cargoTable'
import type { CargoItem, PlacedItem } from '@/lib/packing'
import { cn, fmtTonnes } from '@/lib/utils'

// «Грузы» → the compact list (spec 7.1): the number on its tone, the name
// and the weight, «размещено из всего». «Всего» is edited where it stands,
// «Поставить» arms the cargo for a click on the deck, a hovered row lights
// up the cargo's stacks. Everything else is edited in the cargo table.
export function CargoList({
  placedAcrossTrips,
  hoveredItemId,
  onHover,
}: {
  // Every trip's placements: a unit on any trip counts as placed.
  placedAcrossTrips: PlacedItem[]
  hoveredItemId: string | null
  onHover: (id: string | null) => void
}) {
  const items = useCalculator((s) => s.items)
  const activeStampId = useCalculator((s) => s.activeStampId)
  const setActiveStamp = useCalculator((s) => s.setActiveStamp)
  const updateItem = useCalculator((s) => s.updateItem)
  const placed = useMemo(() => placedByItem(placedAcrossTrips), [placedAcrossTrips])

  return (
    <ul aria-label="Список грузов" className="space-y-0.5 px-2 pb-4" data-tour="cargo-list">
      {items.map((it, index) => {
        const units = placed.get(it.id)?.units ?? 0
        const armed = activeStampId === it.id
        return (
          <li
            key={it.id}
            data-testid="cargo-list-row"
            onMouseEnter={() => onHover(it.id)}
            onMouseLeave={() => onHover(null)}
            className={cn('flex items-center gap-2.5 rounded-md px-2 py-1.5', hoveredItemId === it.id && 'bg-accent')}
          >
            <CargoNumberTile number={index + 1} className="h-7 w-7 text-xs" />
            {/* The name and the weight on one line, «размещено из всего»
                under them: both fit the 360 px panel without wrapping. */}
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <p className="min-w-0 flex-1 truncate text-sm font-medium" title={it.name}>
                  {it.name}
                </p>
                {it.weight !== undefined && it.weight > 0 ? (
                  <span className="shrink-0 text-xs text-ink-2 tabular-nums">{fmtTonnes(it.weight * it.quantity)} т</span>
                ) : (
                  <span className="shrink-0 text-xs text-warn">без веса</span>
                )}
              </div>
              <p className="flex items-center gap-x-1 text-xs text-ink-2 tabular-nums">
                <PlacedCount item={it} units={units} />
                <span>из</span>
                <QuantityField item={it} onCommit={(quantity) => updateItem(it.id, { quantity })} />
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-pressed={armed}
              aria-label={`Поставить «${it.name}»`}
              title="Поставить кликом по палубе"
              onClick={() => setActiveStamp(armed ? null : it.id)}
              className={cn('h-8 shrink-0 px-2.5', armed && 'border-line-strong bg-accent font-medium')}
            >
              Поставить
            </Button>
          </li>
        )
      })}
    </ul>
  )
}

// «Размещено N»: amber while some of it is off the deck, red with a reason
// when more stands on the deck than the list asks for.
function PlacedCount({ item, units }: { item: CargoItem; units: number }) {
  const over = units > item.quantity
  return (
    <span
      className={cn(over ? 'font-medium text-danger' : units < item.quantity && 'text-warn')}
      title={over ? 'На палубе больше, чем всего в списке: уберите лишнее или увеличьте «всего»' : undefined}
    >
      {/* Two digits wide, so «из» and the field line up row to row. */}
      Размещено <span className="inline-block min-w-[2ch] text-right">{units}</span>
      {over && ' ⚠'}
    </span>
  )
}

// «Всего»: a small field — a click selects the number, so typing replaces
// it, and Enter or leaving the field applies it (spec 2.3: two actions).
function QuantityField({ item, onCommit }: { item: CargoItem; onCommit: (quantity: number) => void }) {
  return (
    <NumberField
      aria-label={`Всего, ${item.name}`}
      title="Всего — изменить"
      value={item.quantity}
      min={1}
      integer
      selectOnFocus
      onCommit={onCommit}
      className="h-6 w-12 px-1 text-right text-xs font-medium text-ink tabular-nums"
    />
  )
}
