'use client'

import { useId } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PanelBlock } from '@/components/shell/SectionPanel'
import { NumberField } from '@/components/calculator/NumberField'
import { isWholeDeckZone, useCalculator, UNIT_LABEL } from '@/store/calculator'
import type { ZoneLoadCheck } from '@/lib/packing'
import { cn, fmtNumber } from '@/lib/utils'

// Stable empty-array reference for the zustand selector — a fresh `[]` every
// call reads as "the snapshot changed" and re-renders forever.
const EMPTY_ZONES: never[] = []

// «Зоны нагрузки» (spec 8.1): the deck's rated zones — where, how big, the
// load they take per square metre — what each holds in all and holds now.
// Numbered as «Проверки» names them. The deck-strength choice of a library
// vessel is in its card.
export function LoadZonesBlock({ zoneLoads }: { zoneLoads?: ZoneLoadCheck[] }) {
  const zones = useCalculator((s) => s.deck.loadZones ?? EMPTY_ZONES)
  const unit = useCalculator((s) => s.deck.unit)
  const deckWidth = useCalculator((s) => s.deck.width)
  const deckLength = useCalculator((s) => s.deck.length)
  const addLoadZone = useCalculator((s) => s.addLoadZone)
  const updateLoadZone = useCalculator((s) => s.updateLoadZone)
  const removeLoadZone = useCalculator((s) => s.removeLoadZone)
  const u = UNIT_LABEL[unit]

  return (
    <PanelBlock title="Зоны нагрузки" fold="zones">
      <p className="text-xs text-ink-2">
        Лимит — плотность, тонн на квадратный метр зоны, а не общий вес: при лимите 2 т/м² зона 5 × 4 м держит до 40 т. Перегруз —
        предупреждение, груз не блокируется.
      </p>
      {zones.length > 0 && (
        <ul className="space-y-1.5" aria-label="Зоны нагрузки">
          {zones.map((z, i) => {
            const load = zoneLoads?.find((zl) => zl.zoneId === z.id)
            // What the zone takes at its limit, before anything stands on it
            // too — the sum people get wrong when they read the limit as tonnes.
            // The outline-clipped area once cargo is on the deck, the bare
            // rectangle before that.
            const areaM2 = load?.areaM2 ?? z.width * z.length
            const capacityT = z.maxLoadPerArea * areaM2
            const name = `Зона ${i + 1}`
            return (
              <li key={z.id} className="space-y-1.5 rounded-md border border-line p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium">
                    {name}
                    {isWholeDeckZone(z, deckWidth, deckLength) && ' (вся палуба)'}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeLoadZone(z.id)}
                    aria-label={`Удалить: ${name}`}
                    title="Удалить зону"
                    className="inline-flex h-6 w-6 items-center justify-center rounded text-ink-2 hover:bg-accent hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-1">
                  <ZoneField zone={name} label="X" unit={u} value={z.x} onCommit={(v) => updateLoadZone(z.id, { x: v })} />
                  <ZoneField zone={name} label="Y" unit={u} value={z.y} onCommit={(v) => updateLoadZone(z.id, { y: v })} />
                  <ZoneField zone={name} label="Шир." unit={u} value={z.width} min={0.01} onCommit={(v) => updateLoadZone(z.id, { width: v })} />
                  <ZoneField zone={name} label="Длин." unit={u} value={z.length} min={0.01} onCommit={(v) => updateLoadZone(z.id, { length: v })} />
                </div>
                <div className="w-1/2">
                  <ZoneField zone={name} label="Лимит, т/м²" value={z.maxLoadPerArea} min={0} onCommit={(v) => updateLoadZone(z.id, { maxLoadPerArea: v })} />
                </div>
                <p className="text-xs text-ink-2">
                  Держит до {fmtNumber(capacityT)} т ({fmtNumber(z.maxLoadPerArea)} т/м² × {fmtNumber(areaM2)} м²)
                </p>
                {load && (
                  <p className={cn('text-xs tabular-nums', load.exceeded ? 'font-medium text-danger' : 'text-ink-2')}>
                    Сейчас в зоне: {fmtNumber(load.totalWeightKg / 1000)} т ({fmtNumber(load.densityTPerM2)} т/м²)
                    {load.exceeded ? ' — превышен лимит' : ` из ${fmtNumber(capacityT)} т`}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <Button size="sm" variant="outline" className="h-8 w-full text-xs" onClick={() => addLoadZone()}>
        <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Добавить зону
      </Button>
    </PanelBlock>
  )
}

// A zone's figure, applied on Enter or leaving the field (spec 8.5): its
// label right before it, «X (м)».
function ZoneField({
  zone,
  label,
  unit,
  value,
  min,
  onCommit,
}: {
  zone: string
  label: string
  unit?: string
  value: number
  min?: number
  onCommit: (v: number) => void
}) {
  const id = useId()
  return (
    <div className="space-y-0.5">
      <label htmlFor={id} className="block text-xs leading-none text-ink-2">
        {label}
        {unit ? ` (${unit})` : ''}
      </label>
      <NumberField
        id={id}
        aria-label={`${zone}: ${label}${unit ? `, ${unit}` : ''}`}
        min={min}
        value={value}
        onCommit={onCommit}
        className="h-7 px-1.5 text-xs"
      />
    </div>
  )
}
