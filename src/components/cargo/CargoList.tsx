'use client'

import { useMemo } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { CargoNumberTile } from '@/components/calculator/CargoNumberTile'
import { NumberField } from '@/components/calculator/NumberField'
import { undoCalculator, useCalculator } from '@/store/calculator'
import { placedByItem } from '@/lib/cargoTable'
import { ownUnitsOfItem } from '@/lib/ownPlacements'
import type { CargoItem, PlacedItem } from '@/lib/packing'
import { cn, fmtTonnes } from '@/lib/utils'

// Why one more unit of a cargo can't go on the deck (page.tsx's
// stampRefusal): all of it stands there already, or the deck's cargo limit.
export interface PlaceRefusal {
  kind: 'all-placed' | 'limit'
  text: string
}

// The row's one button keeps one width whatever it says («Поставить»,
// «Убрать», «Открепить»): the buttons stand in one column down the list, and
// the names and weights beside them end on one edge.
const ROW_BUTTON = 'h-8 w-24 shrink-0 px-2'

// «Грузы» → the compact list (spec 7.1): the number on its tone, the name
// and the weight, «размещено из всего». «Всего» is edited where it stands,
// a hovered row lights up the cargo's stacks. Everything else is edited in
// the cargo table.
//
// One button follows the cargo's state (revision 2026-11-05: a «Поставить»
// that looked ready but put nothing on the deck read as broken).
// «Поставить» arms the cargo for a click on the deck, outlined in orange
// while armed. Once all of it stands on the deck by the user's hand, the
// button turns into «Убрать», which takes it off again (in auto mode
// «Открепить»: the packer lays those stacks out itself). When the deck's
// cargo limit stops another unit, «Поставить» is greyed with the reason.
export function CargoList({
  placedAcrossTrips,
  hoveredItemId,
  onHover,
  placeRefusal = () => null,
}: {
  // Every trip's placements: a unit on any trip counts as placed.
  placedAcrossTrips: PlacedItem[]
  hoveredItemId: string | null
  onHover: (id: string | null) => void
  placeRefusal?: (itemId: string) => PlaceRefusal | null
}) {
  const items = useCalculator((s) => s.items)
  const mode = useCalculator((s) => s.mode)
  const manualPlacements = useCalculator((s) => s.manualPlacements)
  const pinnedPlacementsByTrip = useCalculator((s) => s.pinnedPlacementsByTrip)
  const activeStampId = useCalculator((s) => s.activeStampId)
  const setActiveStamp = useCalculator((s) => s.setActiveStamp)
  const updateItem = useCalculator((s) => s.updateItem)
  const takeOffDeck = useCalculator((s) => s.takeOffDeck)
  const placed = useMemo(() => placedByItem(placedAcrossTrips), [placedAcrossTrips])
  const manual = mode === 'manual'

  const takeOff = (it: CargoItem) => {
    const units = takeOffDeck(it.id)
    if (units === 0) return
    toast.success(manual ? `«${it.name}» убран с палубы: ${units} ед.` : `«${it.name}» откреплён: ${units} ед. разложит программа`, {
      action: { label: 'Отменить', onClick: () => undoCalculator() },
    })
  }

  return (
    <ul aria-label="Список грузов" className="space-y-0.5 px-2 pb-4" data-tour="cargo-list">
      {items.map((it, index) => {
        const units = placed.get(it.id)?.units ?? 0
        const armed = activeStampId === it.id
        const refusal = armed ? null : placeRefusal(it.id)
        const own = ownUnitsOfItem(it.id, mode, manualPlacements, pinnedPlacementsByTrip)
        // All of it stands on the deck, some by the user's hand: the button
        // takes it off. Armed, it stays «Поставить», to be clicked off.
        const offer = refusal?.kind === 'all-placed' && own > 0 ? 'take-off' : 'place'
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
                  <span data-testid="cargo-list-weight" className="shrink-0 text-xs text-ink-2 tabular-nums">
                    {fmtTonnes(it.weight * it.quantity)} т
                  </span>
                ) : (
                  <span data-testid="cargo-list-weight" className="shrink-0 text-xs text-warn">
                    без веса
                  </span>
                )}
              </div>
              <p className="flex items-center gap-x-1 text-xs text-ink-2 tabular-nums">
                <PlacedCount item={it} units={units} />
                <span>из</span>
                <QuantityField item={it} onCommit={(quantity) => updateItem(it.id, { quantity })} />
              </p>
            </div>
            {offer === 'take-off' ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-label={manual ? `Убрать «${it.name}» с палубы` : `Открепить «${it.name}»`}
                title={manual ? `Убрать с палубы: ${own} ед.` : `Открепить: ${own} ед. разложит программа`}
                onClick={() => takeOff(it)}
                className={ROW_BUTTON}
              >
                {manual ? 'Убрать' : 'Открепить'}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-pressed={armed}
                aria-disabled={refusal ? true : undefined}
                aria-label={`Поставить «${it.name}»`}
                title={refusal ? refusal.text : armed ? 'Кликните по палубе — груз встанет туда. Ещё раз — отменить' : 'Поставить кликом по палубе'}
                onClick={() => {
                  if (refusal) (refusal.kind === 'limit' ? toast.error : toast.warning)(refusal.text)
                  else setActiveStamp(armed ? null : it.id)
                }}
                className={cn(
                  ROW_BUTTON,
                  armed && 'border-primary bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
                  refusal && 'cursor-not-allowed text-ink-2 opacity-60'
                )}
              >
                Поставить
              </Button>
            )}
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
