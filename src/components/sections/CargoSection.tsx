'use client'

import { useState } from 'react'
import { BookOpen, Plus, Table2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CargoList } from '@/components/cargo/CargoList'
import { CargoCatalog, CustomShapeForm } from '@/components/cargo/CargoCatalog'
import { OwnCargoForm } from '@/components/cargo/OwnCargoForm'
import { useCalculator } from '@/store/calculator'
import { cargoTotals } from '@/lib/cargoTable'
import type { PlacedItem } from '@/lib/packing'
import { cn, fmtTonnes, pluralRu } from '@/lib/utils'

// «Грузы» (spec 7.1): what's on the list in one line, the catalogue, the
// short form for a cargo of one's own, the cargo table, and the compact list.
// One of the catalogue and the form is open at a time, above the list.
export function CargoSection({
  onOpenTable,
  placedAcrossTrips,
  hoveredItemId,
  onHover,
  onPlaceCustomShape,
}: {
  // Opens the cargo table across the bottom (spec 5.4).
  onOpenTable: () => void
  placedAcrossTrips: PlacedItem[]
  hoveredItemId: string | null
  onHover: (id: string | null) => void
  // A drawn outline, once named, placed where it was drawn.
  onPlaceCustomShape: (name: string, weightKg?: number) => void
}) {
  const items = useCalculator((s) => s.items)
  const pendingCustomShape = useCalculator((s) => s.pendingCustomShape)
  const [open, setOpen] = useState<'catalog' | 'own' | null>(null)
  const toggle = (panel: 'catalog' | 'own') => setOpen((current) => (current === panel ? null : panel))
  const totals = cargoTotals(items)
  const empty = items.length === 0

  const toolButton = (panel: 'catalog' | 'own', label: string, Icon: typeof Plus) => (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-expanded={open === panel}
      aria-controls={open === panel ? (panel === 'catalog' ? 'cargo-catalog' : 'own-cargo') : undefined}
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
          <p className="text-sm text-ink-2">Добавьте груз из каталога или задайте свой</p>
          <div className="flex justify-center gap-2">
            {toolButton('catalog', 'Каталог', BookOpen)}
            {toolButton('own', 'Свой груз', Plus)}
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
          <div className="grid grid-cols-3 gap-2">
            {toolButton('catalog', 'Каталог', BookOpen)}
            {toolButton('own', 'Свой груз', Plus)}
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
      {!empty && (
        <div className="pt-2">
          <CargoList placedAcrossTrips={placedAcrossTrips} hoveredItemId={hoveredItemId} onHover={onHover} />
        </div>
      )}
    </>
  )
}
