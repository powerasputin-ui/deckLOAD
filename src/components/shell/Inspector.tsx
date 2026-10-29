'use client'

import { useState } from 'react'
import { ChevronRight, createLucideIcon, Lock, Minus, Plus, RotateCw, Trash2, Unlock, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { CargoNumberTile } from '@/components/calculator/CargoNumberTile'
import { pluralRu } from '@/lib/utils'

// The selected stack as the inspector and the mini-panel show it (spec 6.5,
// 6.6). page.tsx builds it from the selection.
export interface InspectedStack {
  // A pin (auto mode), a stack the auto-packer placed, or a manual stack.
  kind: 'pin' | 'auto' | 'manual'
  name: string
  number?: number
  // «6.06 × 2.44 × 2.59 м», the cargo's own width × length × height.
  size: string
  // The cargo's category, «Смешанный груз» for a stack of different ones.
  category?: string
  unitWeight?: string
  stackWeight: string
  layers: number
  maxLayers: number
  // A cargo in it doesn't allow rotation (spec 6.3).
  rotate: { ok: boolean; reason?: string }
  addLayer: { ok: boolean; reason?: string }
  removeLayer: { ok: boolean; reason?: string }
  // A stack holding more than one cargo.
  composition?: { number?: number; name: string; layers: number }[]
  // Locked by the user, a layout pin left by a variant, placed by the
  // auto-packer, or placed by hand.
  state: 'locked' | 'layout' | 'auto' | 'manual'
  // Units the stack holds: what «Удалить» takes off the cargo's quantity.
  units: number
  // What is wrong with this stack, in a line each.
  problems: string[]
}

// What can be done with the selected stack. «Закрепить» and «Вернуть в
// авто» exist in auto mode only.
export interface StackActions {
  rotate: () => void
  addLayer: () => void
  removeLayer: () => void
  pin?: () => void
  unpin?: () => void
  remove: () => void
}

// Several stacks selected (Shift or Ctrl + click).
export interface InspectedSelection {
  count: number
  mode: 'auto' | 'manual'
  // Auto mode: units «Удалить…» takes off the cargo; manual mode: units
  // that become unplaced.
  units: number
  pinAll?: () => void
  unpinAll?: () => void
  removeAll: () => void
}

export const INSPECTOR_WIDTH_PX = 320

// «Нельзя повернуть» (spec 6.3). lucide has no crossed-out rotation arrow:
// RotateCw with the slash of its «…Off» icons.
export const RotateCwOff = createLucideIcon('rotate-cw-off', [
  ['path', { d: 'M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8', key: 'arc' }],
  ['path', { d: 'M21 3v5h-5', key: 'head' }],
  ['path', { d: 'm2 2 20 20', key: 'slash' }],
])

const STATE_TEXT: Record<InspectedStack['state'], string> = {
  locked: 'Закреплён: авторасстановка его не двигает',
  layout: 'Раскладка варианта',
  auto: 'Расставлен автоматически',
  manual: 'Поставлен вручную',
}

// The panel over the right edge of the deck while stacks are selected
// (spec 5.4, 6.5). Esc or a click on the empty deck closes it, like the ✕.
export function Inspector({
  stack,
  selection,
  actions,
  lashing,
  onShowChecks,
  onClose,
}: {
  stack?: InspectedStack
  selection?: InspectedSelection
  actions?: StackActions
  // The stack's «Крепление» (StackLashing).
  lashing?: React.ReactNode
  // Opens «Проверки», where the problems are.
  onShowChecks: () => void
  onClose: () => void
}) {
  return (
    <aside
      aria-label="Инспектор"
      className="absolute inset-y-0 right-0 z-20 flex flex-col border-l bg-surface shadow-lg"
      style={{ width: INSPECTOR_WIDTH_PX }}
    >
      {stack && actions ? (
        <StackDetails stack={stack} actions={actions} lashing={lashing} onShowChecks={onShowChecks} onClose={onClose} />
      ) : selection ? (
        <SelectionDetails selection={selection} onClose={onClose} />
      ) : null}
    </aside>
  )
}

function Header({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="flex items-start gap-2 border-b px-4 py-3">
      <div className="min-w-0 flex-1">{children}</div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0 pointer-coarse:h-11 pointer-coarse:w-11"
        aria-label="Закрыть инспектор"
        title="Закрыть (Esc)"
        onClick={onClose}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}

function StackDetails({
  stack,
  actions,
  lashing,
  onShowChecks,
  onClose,
}: {
  stack: InspectedStack
  actions: StackActions
  lashing?: React.ReactNode
  onShowChecks: () => void
  onClose: () => void
}) {
  const auto = stack.kind !== 'manual'
  return (
    <>
      <Header onClose={onClose}>
        <h2 className="flex items-center gap-2 text-base font-semibold">
          {stack.number !== undefined && <CargoNumberTile number={stack.number} className="h-6 min-w-6 px-1 text-sm" />}
          <span className="truncate">{stack.name}</span>
        </h2>
        <p className="mt-1 flex items-center gap-1 text-xs text-ink-2">
          {stack.state === 'locked' && <Lock className="h-3.5 w-3.5" aria-hidden="true" />}
          {STATE_TEXT[stack.state]}
        </p>
      </Header>

      <div className="thin-scrollbar flex-1 overflow-y-auto">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-b px-4 py-3 text-sm">
          <dt className="text-ink-2">Ш × Д × В</dt>
          <dd className="tabular-nums">{stack.size}</dd>
          {stack.category && (
            <>
              <dt className="text-ink-2">Категория</dt>
              <dd>{stack.category}</dd>
            </>
          )}
          {stack.unitWeight && (
            <>
              <dt className="text-ink-2">Вес единицы</dt>
              <dd className="tabular-nums">{stack.unitWeight}</dd>
            </>
          )}
          <dt className="text-ink-2">Вес штабеля</dt>
          <dd className="tabular-nums">{stack.stackWeight}</dd>
        </dl>

        <section className="space-y-1.5 border-b px-4 py-3" aria-label="Ярусы">
          <div className="flex items-center gap-2">
            <span className="flex-1 text-sm font-medium">Ярусы</span>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 pointer-coarse:h-11 pointer-coarse:w-11"
              aria-label="Убрать ярус"
              disabled={!stack.removeLayer.ok}
              onClick={actions.removeLayer}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <span className="min-w-8 text-center text-base font-semibold tabular-nums" aria-live="polite">
              {stack.layers}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 pointer-coarse:h-11 pointer-coarse:w-11"
              aria-label="Добавить ярус"
              disabled={!stack.addLayer.ok}
              onClick={actions.addLayer}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-ink-2">макс. {stack.maxLayers} по высоте</p>
          {!stack.addLayer.ok && stack.addLayer.reason && <p className="text-xs text-ink-2">{stack.addLayer.reason}</p>}
        </section>

        {stack.composition && (
          <section className="space-y-1.5 border-b px-4 py-3">
            <h3 className="text-sm font-medium">Состав</h3>
            <ul className="space-y-1 text-sm">
              {stack.composition.map((c, i) => (
                <li key={i} className="flex items-center gap-2">
                  {c.number !== undefined && <CargoNumberTile number={c.number} className="h-5 min-w-5 px-1 text-xs" />}
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className="tabular-nums text-ink-2">
                    {c.layers} {pluralRu(c.layers, 'ярус', 'яруса', 'ярусов')}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="grid grid-cols-2 gap-2 border-b px-4 py-3" aria-label="Действия">
          <Button
            variant="outline"
            size="sm"
            className="pointer-coarse:h-11"
            disabled={!stack.rotate.ok}
            aria-describedby={stack.rotate.ok ? undefined : 'inspector-rotate-reason'}
            onClick={actions.rotate}
          >
            {stack.rotate.ok ? <RotateCw className="mr-1.5 h-4 w-4" /> : <RotateCwOff className="mr-1.5 h-4 w-4" />}
            Повернуть
          </Button>
          {auto && stack.state === 'locked' && actions.unpin && (
            <Button variant="outline" size="sm" className="pointer-coarse:h-11" onClick={actions.unpin}>
              <Unlock className="mr-1.5 h-4 w-4" />
              Вернуть в авто
            </Button>
          )}
          {auto && stack.state !== 'locked' && actions.pin && (
            <Button variant="outline" size="sm" className="pointer-coarse:h-11" onClick={actions.pin}>
              <Lock className="mr-1.5 h-4 w-4" />
              Закрепить
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="col-span-2 text-danger hover:text-danger pointer-coarse:h-11"
            onClick={actions.remove}
          >
            <Trash2 className="mr-1.5 h-4 w-4" />
            {auto ? `Удалить (−${stack.units} ед.)` : 'Убрать с палубы'}
          </Button>
          {!stack.rotate.ok && stack.rotate.reason && (
            <p id="inspector-rotate-reason" className="col-span-2 flex items-start gap-1.5 text-xs text-ink-2">
              <RotateCwOff className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {stack.rotate.reason}
            </p>
          )}
        </section>

        {stack.problems.length > 0 && (
          <section className="space-y-1.5 border-b px-4 py-3" aria-label="Проблемы штабеля">
            <h3 className="text-sm font-medium">Проблемы</h3>
            <ul className="space-y-1 text-sm text-danger">
              {stack.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <Button variant="link" size="sm" className="h-auto px-0" onClick={onShowChecks}>
              Показать в проверках
            </Button>
          </section>
        )}

        {lashing && (
          <details className="group px-4 py-3" data-testid="inspector-lashing">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md text-sm font-medium hover:text-ink [&::-webkit-details-marker]:hidden">
              <ChevronRight className="h-4 w-4 shrink-0 text-ink-2 transition-transform group-open:rotate-90" aria-hidden="true" />
              Крепление
            </summary>
            <div className="pt-2.5">{lashing}</div>
          </details>
        )}
      </div>
    </>
  )
}

function SelectionDetails({ selection, onClose }: { selection: InspectedSelection; onClose: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const { count, mode, units } = selection
  const stacks = `${count} ${pluralRu(count, 'штабель', 'штабеля', 'штабелей')}`
  return (
    <>
      <Header onClose={onClose}>
        <h2 className="text-base font-semibold">Выбрано {stacks}</h2>
        <p className="mt-1 text-xs text-ink-2">Shift или Ctrl + клик добавляет штабель к выбору и убирает из него.</p>
      </Header>
      <section className="grid gap-2 px-4 py-3" aria-label="Действия">
        {selection.pinAll && (
          <Button variant="outline" size="sm" className="pointer-coarse:h-11" onClick={selection.pinAll}>
            <Lock className="mr-1.5 h-4 w-4" />
            Закрепить все
          </Button>
        )}
        {selection.unpinAll && (
          <Button variant="outline" size="sm" className="pointer-coarse:h-11" onClick={selection.unpinAll}>
            <Unlock className="mr-1.5 h-4 w-4" />
            Вернуть в авто
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="text-danger hover:text-danger pointer-coarse:h-11"
          onClick={() => setConfirming(true)}
        >
          <Trash2 className="mr-1.5 h-4 w-4" />
          Удалить…
        </Button>
      </section>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить {stacks}?</AlertDialogTitle>
            <AlertDialogDescription>
              {mode === 'auto'
                ? `Количество груза уменьшится на ${units} ед. Отменить можно через Ctrl+Z.`
                : `${units} ед. станут неразмещёнными, количество груза не изменится.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                selection.removeAll()
                setConfirming(false)
              }}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
