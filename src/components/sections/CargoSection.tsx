'use client'

import { useState } from 'react'
import { BookOpen, Plus, Ship, Table2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CargoList, type PlaceRefusal } from '@/components/cargo/CargoList'
import { CargoCatalog, CustomShapeForm } from '@/components/cargo/CargoCatalog'
import { OwnCargoForm } from '@/components/cargo/OwnCargoForm'
import { CargoTakeOver } from '@/components/cargo/CargoTakeOver'
import { useCalculator } from '@/store/calculator'
import { cargoTotals } from '@/lib/cargoTable'
import { isPlatform, platformStatusLine } from '@/lib/objectKind'
import type { PlacedItem } from '@/lib/packing'
import { cn, fmtTonnes, pluralRu } from '@/lib/utils'

// «Грузы» (spec 7.1): what's on the list in one line, the catalogue, the
// short form for a cargo of one's own, the cargo table, and the compact list.
// One of the catalogue and the form is open at a time, above the list. A
// platform also takes a vessel's trip as «приход» (spec 2026-11-06, 13).
type Panel = 'catalog' | 'own' | 'vessel'
const PANEL_ID: Record<Panel, string> = { catalog: 'cargo-catalog', own: 'own-cargo', vessel: 'cargo-take-over' }

export function CargoSection({
  onOpenTable,
  placedAcrossTrips,
  placedByTrip,
  hoveredItemId,
  onHover,
  onPlaceCustomShape,
  placeRefusal,
}: {
  // Opens the cargo table across the bottom (spec 5.4).
  onOpenTable: () => void
  placedAcrossTrips: PlacedItem[]
  // The same trip by trip, for «Закрепить» (auto mode).
  placedByTrip?: PlacedItem[][]
  hoveredItemId: string | null
  onHover: (id: string | null) => void
  // A drawn outline, once named, placed where it was drawn.
  onPlaceCustomShape: (name: string, weightKg?: number) => void
  // Why another unit of a cargo can't go on the deck, if it can't.
  placeRefusal?: (itemId: string) => PlaceRefusal | null
}) {
  const items = useCalculator((s) => s.items)
  const platform = useCalculator((s) => isPlatform(s.deck))
  const pendingCustomShape = useCalculator((s) => s.pendingCustomShape)
  const [open, setOpen] = useState<Panel | null>(null)
  const toggle = (panel: Panel) => setOpen((current) => (current === panel ? null : panel))
  const totals = cargoTotals(items)
  const empty = items.length === 0

  const toolButton = (panel: Panel, label: string, Icon: typeof Plus) => (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-expanded={open === panel}
      aria-controls={open === panel ? PANEL_ID[panel] : undefined}
      onClick={() => toggle(panel)}
      className={cn('h-8 px-2', open === panel && 'border-line-strong bg-accent font-medium')}
    >
      <Icon className="mr-1 h-4 w-4" aria-hidden="true" />
      {label}
    </Button>
  )

  return (
    <>
      {empty && open === null ? (
        <div className="space-y-3 px-4 py-6 text-center">
          <p className="text-sm text-ink-2">{platform ? 'Добавьте груз из каталога, свой или с судна' : 'Добавьте груз из каталога или задайте свой'}</p>
          <div className="flex flex-wrap justify-center gap-2">
            {toolButton('catalog', 'Каталог', BookOpen)}
            {toolButton('own', 'Свой груз', Plus)}
            {platform && toolButton('vessel', 'С судна', Ship)}
          </div>
        </div>
      ) : (
        <div className="space-y-3 px-4 py-3">
          {!empty && (
            <p className="text-sm text-ink-2 tabular-nums" data-testid="cargo-summary">
              {items.length} {pluralRu(items.length, 'тип', 'типа', 'типов')} · {totals.units} ед. · {fmtTonnes(totals.weightKg)} т
              {totals.unweighed > 0 && ` (без веса: ${totals.unweighed})`}
            </p>
          )}
          {!empty && platform && (
            <p className="text-xs text-ink-2 tabular-nums" data-testid="cargo-status-summary">
              {platformStatusLine(items)}
            </p>
          )}
          <div className={cn('grid gap-2', platform ? 'grid-cols-2' : 'grid-cols-3')}>
            {toolButton('catalog', 'Каталог', BookOpen)}
            {toolButton('own', 'Свой груз', Plus)}
            {platform && toolButton('vessel', 'С судна', Ship)}
            <Button type="button" variant="outline" size="sm" className="h-8 px-2" onClick={onOpenTable} disabled={empty}>
              <Table2 className="mr-1 h-4 w-4" aria-hidden="true" />
              Таблица
            </Button>
          </div>
        </div>
      )}
      {pendingCustomShape && <CustomShapeForm onPlace={onPlaceCustomShape} />}
      {open === 'catalog' && <CargoCatalog />}
      {open === 'own' && (
        <div id="own-cargo">
          <OwnCargoForm onDone={() => setOpen(null)} />
        </div>
      )}
      {open === 'vessel' && platform && <CargoTakeOver onDone={() => setOpen(null)} />}
      {!empty && (
        <div className="pt-2">
          <CargoList
            placedAcrossTrips={placedAcrossTrips}
            placedByTrip={placedByTrip}
            hoveredItemId={hoveredItemId}
            onHover={onHover}
            placeRefusal={placeRefusal}
          />
        </div>
      )}
    </>
  )
}
