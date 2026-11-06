'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { MenuItem } from '@/components/shell/menu'
import { PlatformStatusSelect } from '@/components/cargo/PlatformStatusSelect'
import { CargoNumberTile } from '@/components/calculator/CargoNumberTile'
import { NumberField } from '@/components/calculator/NumberField'
import { closeCalculatorHistoryStep, undoCalculator, useCalculator } from '@/store/calculator'
import { placedByItem } from '@/lib/cargoTable'
import { ownUnitsOfItem } from '@/lib/ownPlacements'
import { isPlatform, platformStatusOf } from '@/lib/objectKind'
import type { CargoItem, PlacedItem } from '@/lib/packing'
import { cn, fmtTonnes } from '@/lib/utils'

// Why one more unit of a cargo can't go on the deck (page.tsx's
// stampRefusal): all of it stands there already, or the deck's cargo limit.
export interface PlaceRefusal {
  kind: 'all-placed' | 'limit'
  text: string
}

// The row's one button keeps one width whatever it says («Поставить»,
// «Убрать», «Закрепить», «Открепить»): the buttons stand in one column down
// the list, and the names and weights beside them end on one edge.
const ROW_BUTTON = 'h-8 w-24 shrink-0 px-2'

// «Грузы» → the compact list (spec 7.1): the number on its tone, the name
// and the weight, «размещено из всего». «Всего» is edited where it stands,
// a hovered row lights up the cargo's stacks. Everything else is edited in
// the cargo table.
//
// One button follows the cargo's state (revision 2026-11-05: a «Поставить»
// that looked ready but put nothing on the deck read as broken).
// «Поставить» arms the cargo for a click on the deck, outlined in orange
// while armed; when the deck's cargo limit stops another unit, it is greyed
// with the reason.
// - Manual mode: once all of it stands on the deck, the button turns into
//   «Убрать», which takes it off again.
// - Auto mode (revision 2026-11-06): the packer puts cargo on the deck by
//   itself — from the catalogue too — so a «Поставить» beside cargo already
//   standing there read wrong. On the deck it is «Закрепить» (every stack
//   of it stays where it stands), then «Открепить» (the packer lays it out
//   again). «Поставить» only while none of it is on the deck.
// A right-click on a row (or Shift+F10 on its button) opens its menu:
// «Удалить груз», with an undo in the toast.
export function CargoList({
  placedAcrossTrips,
  placedByTrip = [placedAcrossTrips],
  hoveredItemId,
  onHover,
  placeRefusal = () => null,
}: {
  // Every trip's placements: a unit on any trip counts as placed.
  placedAcrossTrips: PlacedItem[]
  // The same, trip by trip: what «Закрепить» pins, each on its own trip.
  placedByTrip?: PlacedItem[][]
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
  const pinOnDeck = useCalculator((s) => s.pinOnDeck)
  const removeItem = useCalculator((s) => s.removeItem)
  // A platform's cargo has a status (spec 2026-11-06, 6); what leaves with
  // the vessel isn't on the plan and has nothing to place.
  const platform = useCalculator((s) => isPlatform(s.deck))
  // A row's right-click menu (revision 2026-11-06): a cargo that fits no
  // trip has no stack to right-click on the deck, and the list offered no
  // way to drop it short of the cargo table.
  const [menu, setMenu] = useState<{ itemId: string; x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    // Esc gives the focus back to where it was, as a menu opened from the
    // keyboard expects; a click elsewhere takes it there itself.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    menuRef.current?.querySelector('button')?.focus()
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      close()
      opener?.focus()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [menu])
  const remove = (it: CargoItem) => {
    if (activeStampId === it.id) setActiveStamp(null)
    closeCalculatorHistoryStep()
    removeItem(it.id)
    toast.success(`Груз «${it.name}» удалён`, {
      action: { label: 'Отменить', onClick: () => undoCalculator() },
    })
  }
  const menuItem = menu ? items.find((it) => it.id === menu.itemId) : undefined
  const placed = useMemo(() => placedByItem(placedAcrossTrips), [placedAcrossTrips])
  const manual = mode === 'manual'

  const takeOff = (it: CargoItem) => {
    closeCalculatorHistoryStep()
    const units = takeOffDeck(it.id)
    if (units === 0) return
    toast.success(manual ? `«${it.name}» убран с палубы: ${units} ед.` : `«${it.name}» откреплён: ${units} ед. разложит программа`, {
      action: { label: 'Отменить', onClick: () => undoCalculator() },
    })
  }
  const pin = (it: CargoItem) => {
    closeCalculatorHistoryStep()
    const units = pinOnDeck(it.id, placedByTrip)
    if (units === 0) return
    toast.success(`«${it.name}» закреплён на месте: ${units} ед.`, {
      action: { label: 'Отменить', onClick: () => undoCalculator() },
    })
  }

  return (
    <>
      <ul aria-label="Список грузов" className="space-y-0.5 px-2 pb-4" data-tour="cargo-list">
        {items.map((it, index) => {
          const units = placed.get(it.id)?.units ?? 0
          const armed = activeStampId === it.id
          const refusal = armed ? null : placeRefusal(it.id)
          const own = ownUnitsOfItem(it.id, mode, manualPlacements, pinnedPlacementsByTrip)
          const leaving = platform && platformStatusOf(it) === 'outgoing'
          // Armed, it stays «Поставить», to be clicked off.
          const offer: 'place' | 'take-off' | 'pin' = armed
            ? 'place'
            : manual
              ? refusal?.kind === 'all-placed' && own > 0
                ? 'take-off'
                : 'place'
              : own > 0
                ? 'take-off'
                : units > 0
                  ? 'pin'
                  : 'place'
          return (
            <li
              key={it.id}
              data-testid="cargo-list-row"
              onMouseEnter={() => onHover(it.id)}
              onMouseLeave={() => onHover(null)}
              onContextMenu={(e) => {
                // The quantity field keeps the browser's own menu (paste…).
                if ((e.target as HTMLElement).closest('input, textarea')) return
                e.preventDefault()
                // From the keyboard (Shift+F10, the menu key) there is no
                // pointer: the menu opens under the row.
                const row = e.currentTarget.getBoundingClientRect()
                const fromKeyboard = e.clientX === 0 && e.clientY === 0
                setMenu({ itemId: it.id, x: fromKeyboard ? row.left + 24 : e.clientX, y: fromKeyboard ? row.bottom : e.clientY })
              }}
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
                {leaving ? (
                  <p className="flex items-center gap-x-1 text-xs text-ink-2 tabular-nums">
                    <span>Увозят</span>
                    <QuantityField item={it} onCommit={(quantity) => updateItem(it.id, { quantity })} />
                    <span>ед.</span>
                  </p>
                ) : (
                  <p className="flex items-center gap-x-1 text-xs text-ink-2 tabular-nums">
                    <PlacedCount item={it} units={units} />
                    <span>из</span>
                    <QuantityField item={it} onCommit={(quantity) => updateItem(it.id, { quantity })} />
                  </p>
                )}
                {platform && (
                  <div className="mt-0.5 flex min-w-0 items-center gap-2">
                    <PlatformStatusSelect item={it} onChange={(platformStatus) => updateItem(it.id, { platformStatus })} />
                    {/* Taken over from a vessel's trip (spec 2026-11-06, 13). */}
                    {it.from && (
                      <span className="min-w-0 truncate text-xs text-ink-2" data-testid="cargo-source" title={`с «${it.from.projectName}», рейс ${it.from.trip + 1}`}>
                        с «{it.from.projectName}», рейс {it.from.trip + 1}
                      </span>
                    )}
                  </div>
                )}
              </div>
              {leaving ? (
                <span className={cn(ROW_BUTTON, 'inline-flex items-center justify-center text-center text-xs leading-tight text-ink-2')}>не на плане</span>
              ) : offer === 'pin' ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label={`Закрепить «${it.name}»`}
                  title={`Оставить на месте: ${units} ед. — авторасстановка их больше не двигает`}
                  onClick={() => pin(it)}
                  className={ROW_BUTTON}
                >
                  Закрепить
                </Button>
              ) : offer === 'take-off' ? (
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
      {menu && menuItem && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={`Действия с грузом «${menuItem.name}»`}
          className="fixed z-50 w-56 rounded-lg border bg-surface p-1 shadow-md"
          style={{ left: Math.min(menu.x, window.innerWidth - 232), top: Math.min(menu.y, window.innerHeight - 52) }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <MenuItem
            icon={<Trash2 />}
            destructive
            onSelect={() => {
              remove(menuItem)
              setMenu(null)
            }}
          >
            Удалить груз
          </MenuItem>
        </div>
      )}
    </>
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
