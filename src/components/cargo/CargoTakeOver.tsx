'use client'

import { useId, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { v4 as uuid } from 'uuid'
import { Button } from '@/components/ui/button'
import { closeCalculatorHistoryStep, useCalculator } from '@/store/calculator'
import { useProjects } from '@/store/projects'
import { linesWeightKg, takenBefore, takenOverItems, vesselSources, vesselTrips, type TripCargoLine } from '@/lib/cargoTransfer'
import { fmtTonnes } from '@/lib/utils'

const unitsOf = (lines: readonly TripCargoLine[]) => lines.reduce((sum, l) => sum + l.units, 0)
const amount = (lines: readonly TripCargoLine[]) => {
  const kg = linesWeightKg(lines)
  return `${unitsOf(lines)} ед.${kg > 0 ? `, ${fmtTonnes(kg)} т` : ''}`
}

// «С судна» (spec 2026-11-06, 13): a saved vessel calculation's trip, its
// cargo onto this platform as «приход». The cargo for other installations
// on the same run is unticked; the trip taken again replaces what it
// brought.
export function CargoTakeOver({ onDone }: { onDone: () => void }) {
  const projects = useProjects((s) => s.projects)
  const openId = useProjects((s) => s.activeId)
  const unit = useCalculator((s) => s.deck.unit)
  const items = useCalculator((s) => s.items)
  const takeOverCargo = useCalculator((s) => s.takeOverCargo)
  const sources = useMemo(() => vesselSources(projects, openId), [projects, openId])
  const [sourceId, setSourceId] = useState<string | undefined>(undefined)
  const source = sources.find((p) => p.id === sourceId) ?? sources[0]
  const trips = useMemo(() => (source ? vesselTrips(source) : []), [source])
  const [tripIndex, setTripIndex] = useState(0)
  const trip = trips[Math.min(tripIndex, trips.length - 1)]
  // Cargo of the trip left out: for another installation on the run.
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set())
  // What the trip brought before stays beside the new cargo.
  const [keepBefore, setKeepBefore] = useState(false)
  const id = useId()

  if (!source) {
    return (
      <div id="cargo-take-over" className="space-y-2 border-y border-line px-4 py-3" role="region" aria-label="Груз с судна">
        <p className="text-sm text-ink-2">
          Здесь нет расчётов судов. Откройте расчёт судна файлом («Открыть файл…» в меню расчёта) — и груз его рейса можно будет взять как приход.
        </p>
      </div>
    )
  }

  const lines = trip?.lines ?? []
  const ticked = lines.filter((l) => !unticked.has(l.item.id))
  const before = trip ? takenBefore(items, source, trip.trip) : []
  const take = () => {
    if (!trip || ticked.length === 0) return
    closeCalculatorHistoryStep()
    const from = { projectId: source.id, projectName: source.name, trip: trip.trip }
    takeOverCargo(takenOverItems(ticked, source.deck.unit, unit, from, uuid), keepBefore ? [] : before.map((it) => it.id))
    toast.success(`С «${source.name}», рейс ${trip.trip + 1}: ${amount(ticked)} — приход`)
    onDone()
  }

  return (
    <div id="cargo-take-over" className="space-y-3 border-y border-line px-4 py-3" role="region" aria-label="Груз с судна">
      <div className="space-y-0.5">
        <label htmlFor={`${id}-source`} className="block text-xs text-ink-2">
          Расчёт судна
        </label>
        <select
          id={`${id}-source`}
          value={source.id}
          onChange={(e) => {
            setSourceId(e.target.value)
            setTripIndex(0)
            setUnticked(new Set())
            setKeepBefore(false)
          }}
          className="h-8 w-full rounded border border-input bg-background px-2 text-sm text-ink"
        >
          {sources.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      {trips.length > 1 && (
        <div className="space-y-0.5">
          <label htmlFor={`${id}-trip`} className="block text-xs text-ink-2">
            Рейс
          </label>
          <select
            id={`${id}-trip`}
            value={trip?.trip ?? 0}
            onChange={(e) => {
              setTripIndex(Number(e.target.value))
              setUnticked(new Set())
              setKeepBefore(false)
            }}
            className="h-8 w-full rounded border border-input bg-background px-2 text-sm text-ink"
          >
            {trips.map((t) => (
              <option key={t.trip} value={t.trip}>
                Рейс {t.trip + 1} · {amount(t.lines)}
              </option>
            ))}
          </select>
        </div>
      )}
      {lines.length === 0 ? (
        <p className="text-sm text-ink-2">В этом рейсе груза на палубе нет.</p>
      ) : (
        <fieldset className="space-y-1">
          <legend className="text-xs text-ink-2">Груз рейса — снимите отметку с груза других установок</legend>
          <ul className="space-y-1">
            {lines.map((l) => (
              <li key={l.item.id}>
                <label className="flex items-baseline gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!unticked.has(l.item.id)}
                    onChange={(e) =>
                      setUnticked((prev) => {
                        const next = new Set(prev)
                        if (e.target.checked) next.delete(l.item.id)
                        else next.add(l.item.id)
                        return next
                      })
                    }
                    className="h-4 w-4 shrink-0 translate-y-0.5"
                  />
                  <span className="min-w-0 flex-1 truncate">{l.item.name}</span>
                  <span className="shrink-0 tabular-nums text-ink-2">{amount([l])}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      {before.length > 0 && (
        <label className="flex items-baseline gap-2 text-xs text-ink-2">
          <input type="checkbox" checked={!keepBefore} onChange={(e) => setKeepBefore(!e.target.checked)} className="h-4 w-4 shrink-0 translate-y-0.5" />
          <span>
            Заменить взятое раньше с «{before[0].from!.projectName}», рейс {trip!.trip + 1}: {before.reduce((sum, it) => sum + it.quantity, 0)} ед.
          </span>
        </label>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Отмена
        </Button>
        <Button type="button" size="sm" onClick={take} disabled={ticked.length === 0}>
          Взять как приход{ticked.length > 0 ? `: ${amount(ticked)}` : ''}
        </Button>
      </div>
    </div>
  )
}
