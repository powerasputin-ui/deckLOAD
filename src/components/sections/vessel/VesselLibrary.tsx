'use client'

import { useEffect, useRef, useState } from 'react'
import { Copy, Download, MoreHorizontal, Pencil, RefreshCw, Save, Ship, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { PanelBlock } from '@/components/shell/SectionPanel'
import { MENU_CLOSES_AT_ONCE, MenuItem, MenuSeparator } from '@/components/shell/menu'
import { DeleteVesselDialog, SaveVesselDialog } from '@/components/sections/vessel/VesselLibraryDialogs'
import { useCalculator } from '@/store/calculator'
import { readLibraryFile, useVesselLibrary } from '@/store/vesselLibrary'
import { VESSEL_TEMPLATES, type VesselTemplate } from '@/lib/vesselTemplates'
import { appliedVessel, appliedVesselOf, libraryFile, newUserVesselId, vesselDataLine, vesselFromDeck } from '@/lib/vesselLibrary'
import { resolveShipFrame } from '@/lib/stabilityConditions'
import { deckForVesselDrops } from '@/lib/vesselDeck'
import { cn, fmtNumber } from '@/lib/utils'

// «Судно из библиотеки» (spec 8.1): the built-in vessels and the user's own.
// Without cargo the vessel goes onto the open calculation; with cargo the
// user chooses a new calculation for it or the open one with its deck
// replaced, the cargo kept. What the old deck loses is said before it goes.
//
// The user's own vessels (revision 2026-10-30) are saved from the open
// calculation — its deck, limits and stability data — renamed, updated from
// it, copied and deleted; a built-in vessel is copied to be changed. The
// library lives in this browser and goes to a colleague as a file. A
// calculation keeps its own copy of the vessel: nothing done here changes
// one made before.
export function VesselLibrary({
  onNewCalculation,
  onApplyToCurrent,
}: {
  onNewCalculation: (tpl: VesselTemplate) => void
  onApplyToCurrent: (tpl: VesselTemplate) => void
}) {
  const vesselTemplateId = useCalculator((s) => s.deck.vesselTemplateId)
  const own = useVesselLibrary((s) => s.vessels)
  const broken = useVesselLibrary((s) => s.broken)
  const hydrate = useVesselLibrary((s) => s.hydrate)
  useEffect(() => hydrate(), [hydrate])
  const fileRef = useRef<HTMLInputElement>(null)
  const [asking, setAsking] = useState<{ tpl: VesselTemplate; hasCargo: boolean; drops: string[] } | null>(null)
  // Saving the open deck as a new vessel, updating a vessel from it, or
  // renaming one.
  const [editing, setEditing] = useState<{ kind: 'new' } | { kind: 'update' | 'rename'; vessel: VesselTemplate } | null>(null)
  const [deleting, setDeleting] = useState<VesselTemplate | null>(null)

  const choose = (tpl: VesselTemplate) => {
    const s = useCalculator.getState()
    const hasCargo = s.items.some((it) => it.quantity >= 1)
    const positions =
      s.mode === 'manual' ? s.manualPlacements.length : Object.values(s.pinnedPlacementsByTrip).reduce((n, pins) => n + pins.length, 0)
    const drops = deckForVesselDrops(s.deck, { mode: s.mode, count: positions })
    if (!hasCargo && drops.length === 0) onApplyToCurrent(tpl)
    else setAsking({ tpl, hasCargo, drops })
  }

  // The open calculation is now the saved vessel's.
  const linkCalculation = (vessel: VesselTemplate) => useCalculator.getState().setDeck({ vesselTemplateId: vessel.id, vesselInfo: appliedVesselOf(vessel) })

  const save = (entry: { label: string; note: string }) => {
    if (!editing) return
    const library = useVesselLibrary.getState()
    if (editing.kind === 'rename') {
      library.update({ ...editing.vessel, label: entry.label })
      // The open calculation made with it takes the new name; others keep theirs.
      const deck = useCalculator.getState().deck
      if (deck.vesselTemplateId === editing.vessel.id && deck.vesselInfo)
        useCalculator.getState().setDeck({ vesselInfo: { ...deck.vesselInfo, label: entry.label } })
      toast.success(`Судно переименовано: «${entry.label}»`)
    } else {
      const id = editing.kind === 'update' ? editing.vessel.id : newUserVesselId()
      const vessel = vesselFromDeck(useCalculator.getState().deck, { id, ...entry })
      if (editing.kind === 'update') library.update(vessel)
      else library.add(vessel)
      linkCalculation(vessel)
      toast.success(editing.kind === 'update' ? `Судно «${entry.label}» обновлено из расчёта` : `Судно «${entry.label}» сохранено в библиотеку`)
    }
    setEditing(null)
  }

  const duplicate = (vessel: VesselTemplate) => {
    const copy: VesselTemplate = { ...structuredClone(vessel), id: newUserVesselId(), label: `${vessel.label} — копия`, savedAt: new Date().toISOString() }
    useVesselLibrary.getState().add(copy)
    toast.success(`Создана копия «${copy.label}» — её можно менять`)
  }

  const remove = (vessel: VesselTemplate) => {
    const removed = useVesselLibrary.getState().remove(vessel.id)
    setDeleting(null)
    if (!removed) return
    toast.info(`Судно «${vessel.label}» удалено из библиотеки`, {
      action: { label: 'Вернуть', onClick: () => useVesselLibrary.getState().restore(removed.vessel, removed.index) },
    })
  }

  const exportLibrary = () => {
    const blob = new Blob([libraryFile(own)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `deckload-vessels-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    toast.success(`Библиотека скачана: ${own.length} ${own.length === 1 ? 'судно' : own.length < 5 ? 'судна' : 'судов'}`)
  }

  const importLibrary = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    file.text().then(
      (text) => {
        const read = readLibraryFile(text)
        if ('error' in read) {
          toast.error(read.error)
          return
        }
        const { added, updated } = useVesselLibrary.getState().importMany(read.vessels)
        toast.success(['Импортировано', added > 0 && `новых: ${added}`, updated > 0 && `обновлено: ${updated}`].filter(Boolean).join(' · '))
      },
      () => toast.error('Не удалось прочитать файл')
    )
  }

  // The open deck, as the save dialog describes it.
  const deck = useCalculator((s) => s.deck)
  const applied = appliedVessel(deck)
  const deckData = { vessel: deck.vessel, shipFrame: deck.shipFrame }

  return (
    <PanelBlock title="Судно из библиотеки" fold="library">
      <ul className="space-y-1" aria-label="Суда из библиотеки">
        {[...VESSEL_TEMPLATES, ...own].map((tpl) => {
          const builtIn = VESSEL_TEMPLATES.includes(tpl)
          const isApplied = tpl.id === vesselTemplateId
          return (
            <li key={tpl.id} className={cn('flex items-stretch rounded-md border transition-colors', isApplied ? 'border-line-strong bg-accent' : 'border-line')}>
              <button
                type="button"
                onClick={() => choose(tpl)}
                aria-current={isApplied ? 'true' : undefined}
                className="flex min-w-0 flex-1 items-start gap-2.5 rounded-l-md px-2.5 py-2 text-left hover:bg-accent"
              >
                <Ship className="mt-0.5 h-4 w-4 shrink-0 text-ink-2" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-baseline gap-x-1.5">
                    <span className="text-sm font-medium">{tpl.label}</span>
                    {!builtIn && <span className="text-xs text-ink-2">своё</span>}
                    {isApplied && <span className="text-xs text-ink-2">применено</span>}
                  </span>
                  <span className="block text-xs text-ink-2">{vesselSummary(tpl)}</span>
                  <span className="block text-xs text-ink-2">{vesselDataLine(tpl)}</span>
                  {/* The vessel's data doesn't say which end of the deck is
                      the bow, so +y is assumed (spec 6.1). */}
                  {tpl.deckForwardIsPositiveY === undefined && (
                    <span className="block text-xs text-warn">Направление носа по умолчанию — проверьте</span>
                  )}
                </span>
              </button>
              <VesselMenu
                label={tpl.label}
                builtIn={builtIn}
                onRename={() => setEditing({ kind: 'rename', vessel: tpl })}
                onUpdate={() => setEditing({ kind: 'update', vessel: tpl })}
                onDuplicate={() => duplicate(tpl)}
                onDelete={() => setDeleting(tpl)}
              />
            </li>
          )
        })}
      </ul>
      {own.length === 0 && !broken && (
        <p className="text-xs text-ink-2">Своих судов пока нет. Задайте палубу и данные судна и сохраните их сюда — следующий расчёт начнётся с них.</p>
      )}
      {broken && (
        <div className="space-y-1.5 rounded-md border border-warn bg-warn-bg p-2 text-xs">
          <p>Свои суда в этом браузере не читаются — изменения библиотеки не сохраняются.</p>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => useVesselLibrary.getState().startAfresh()}>
            Начать библиотеку заново
          </Button>
        </div>
      )}
      <div className="space-y-1.5">
        <Button variant="outline" size="sm" className="w-full" onClick={() => setEditing({ kind: 'new' })}>
          <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Сохранить палубу как судно
        </Button>
        <div className="flex gap-1.5">
          <Button variant="ghost" size="sm" className="flex-1" disabled={own.length === 0} onClick={exportLibrary}>
            <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Экспорт
          </Button>
          <Button variant="ghost" size="sm" className="flex-1" onClick={() => fileRef.current?.click()}>
            <Upload className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Импорт
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={importLibrary}
            data-testid="vessel-library-input"
            aria-label="Файл библиотеки судов"
          />
        </div>
      </div>

      {editing && (
        <SaveVesselDialog
          title={editing.kind === 'new' ? 'Сохранить палубу как судно' : editing.kind === 'update' ? 'Обновить судно из расчёта' : 'Переименовать судно'}
          label={
            editing.kind === 'new'
              ? deck.vessel?.particulars.name?.trim() || (applied ? `${applied.label} — копия` : '')
              : editing.vessel.label
          }
          note={editing.kind === 'rename' ? undefined : editing.kind === 'update' ? editing.vessel.note : ''}
          dataLine={editing.kind === 'rename' ? undefined : vesselDataLine(deckData)}
          heightMissing={editing.kind !== 'rename' && !!deck.vessel && resolveShipFrame(deck.shipFrame).heightMissing}
          submit={editing.kind === 'update' ? 'Обновить' : 'Сохранить'}
          onCancel={() => setEditing(null)}
          onSave={save}
        />
      )}
      {deleting && <DeleteVesselDialog label={deleting.label} onCancel={() => setDeleting(null)} onConfirm={() => remove(deleting)} />}

      <AlertDialog open={!!asking} onOpenChange={(open) => !open && setAsking(null)}>
        {asking && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{asking.hasCargo ? `Судно «${asking.tpl.label}»` : `Применить «${asking.tpl.label}» к расчёту?`}</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-sm text-ink-2">
                  {asking.hasCargo && <p>В расчёте есть груз. Начать новый расчёт с этим судном или заменить палубу в этом?</p>}
                  {asking.drops.length > 0 && (
                    <div>
                      <p>{asking.hasCargo ? 'При замене палубы будет удалено' : 'Будет удалено'} — это привязано к старой палубе:</p>
                      <ul className="mt-1 list-disc pl-5" aria-label="Будет удалено">
                        {asking.drops.map((d) => (
                          <li key={d}>{d}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {asking.hasCargo && <p>Груз останется и встанет на новую палубу заново; что не встанет — появится в «Проверках».</p>}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
              {asking.hasCargo && (
                <Button
                  onClick={() => {
                    onNewCalculation(asking.tpl)
                    setAsking(null)
                  }}
                >
                  Новый расчёт с этим судном
                </Button>
              )}
              <Button
                variant={asking.hasCargo ? 'outline' : 'default'}
                onClick={() => {
                  onApplyToCurrent(asking.tpl)
                  setAsking(null)
                }}
              >
                {asking.hasCargo ? 'Заменить палубу в текущем (груз останется)' : 'Применить'}
              </Button>
              <AlertDialogCancel>Отмена</AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </PanelBlock>
  )
}

// A vessel's actions: a built-in one is copied to be changed; the user's own
// is renamed, updated from the open calculation, copied or deleted.
function VesselMenu({
  label,
  builtIn,
  onRename,
  onUpdate,
  onDuplicate,
  onDelete,
}: {
  label: string
  builtIn: boolean
  onRename: () => void
  onUpdate: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const pick = (action: () => void) => () => {
    setOpen(false)
    action()
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Действия с судном «${label}»`}
          className="flex w-8 shrink-0 items-start justify-center rounded-r-md pt-2 text-ink-2 hover:bg-accent hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className={cn('w-72 p-1', MENU_CLOSES_AT_ONCE)}>
        {builtIn ? (
          <MenuItem icon={<Copy />} onSelect={pick(onDuplicate)}>
            Сделать копию для правки
          </MenuItem>
        ) : (
          <>
            <MenuItem icon={<Pencil />} onSelect={pick(onRename)}>
              Переименовать…
            </MenuItem>
            <MenuItem icon={<RefreshCw />} onSelect={pick(onUpdate)}>
              Обновить из текущего расчёта…
            </MenuItem>
            <MenuItem icon={<Copy />} onSelect={pick(onDuplicate)}>
              Сделать копию
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Trash2 />} destructive onSelect={pick(onDelete)}>
              Удалить…
            </MenuItem>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

// «Палуба 16.9×49.1 м · до 2550 т · 5–10 т/м²»
function vesselSummary(tpl: VesselTemplate): string {
  const parts = [`Палуба ${fmtNumber(tpl.deck.width)}×${fmtNumber(tpl.deck.length)} м`]
  if (tpl.limits?.maxDeckCargoT) parts.push(`до ${fmtNumber(tpl.limits.maxDeckCargoT)} т`)
  const strength = tpl.limits?.deckStrengthTPerM2
  if (strength) {
    parts.push(strength.min === strength.max ? `${fmtNumber(strength.min)} т/м²` : `${fmtNumber(strength.min)}–${fmtNumber(strength.max)} т/м²`)
  }
  return parts.join(' · ')
}
