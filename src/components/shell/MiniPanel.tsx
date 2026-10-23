'use client'

import { useState } from 'react'
import { Lock, Minus, MoreHorizontal, Plus, RotateCw, Trash2, Unlock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { MENU_CLOSES_AT_ONCE, MenuItem } from './menu'
import { RotateCwOff, type InspectedStack, type StackActions } from './Inspector'

const ICON_BUTTON = 'h-8 w-8 pointer-coarse:h-11 pointer-coarse:w-11'

// The buttons next to the selected stack (spec 6.6): rotate, layers, and the
// rest under «⋯» — the same actions as the inspector, the right-click menu
// and the keys. DeckVisualization places it over the stack.
export function MiniPanel({ stack, actions }: { stack: InspectedStack; actions: StackActions }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const pick = (action: () => void) => () => {
    setMoreOpen(false)
    action()
  }
  const auto = stack.kind !== 'manual'
  return (
    <div
      role="toolbar"
      aria-label="Действия со штабелем"
      className="flex items-center gap-0.5 rounded-lg border bg-surface p-0.5 shadow-md"
    >
      {/* A disabled button gets no hover, so its reason sits on the wrapper. */}
      <span title={stack.rotate.ok ? 'Повернуть (Пробел)' : stack.rotate.reason}>
        <Button
          variant="ghost"
          size="icon"
          className={ICON_BUTTON}
          aria-label="Повернуть"
          disabled={!stack.rotate.ok}
          onClick={actions.rotate}
        >
          {stack.rotate.ok ? <RotateCw className="h-4 w-4" /> : <RotateCwOff className="h-4 w-4" />}
        </Button>
      </span>
      <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-line" />
      <span title={stack.removeLayer.ok ? 'Убрать ярус' : stack.removeLayer.reason}>
        <Button
          variant="ghost"
          size="icon"
          className={ICON_BUTTON}
          aria-label="Убрать ярус"
          disabled={!stack.removeLayer.ok}
          onClick={actions.removeLayer}
        >
          <Minus className="h-4 w-4" />
        </Button>
      </span>
      <span
        className="min-w-7 text-center text-sm font-semibold tabular-nums"
        title={`Ярусов: ${stack.layers}, макс. ${stack.maxLayers} по высоте`}
      >
        {stack.layers}
      </span>
      <span title={stack.addLayer.ok ? 'Добавить ярус' : stack.addLayer.reason}>
        <Button
          variant="ghost"
          size="icon"
          className={ICON_BUTTON}
          aria-label="Добавить ярус"
          disabled={!stack.addLayer.ok}
          onClick={actions.addLayer}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </span>
      <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-line" />
      <Popover open={moreOpen} onOpenChange={setMoreOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className={ICON_BUTTON} aria-label="Ещё действия" title="Ещё действия">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className={cn('w-56 p-1', MENU_CLOSES_AT_ONCE)}>
          {auto && stack.state === 'locked' && actions.unpin && (
            <MenuItem icon={<Unlock />} onSelect={pick(actions.unpin)}>
              Вернуть в авто
            </MenuItem>
          )}
          {auto && stack.state !== 'locked' && actions.pin && (
            <MenuItem icon={<Lock />} onSelect={pick(actions.pin)}>
              Закрепить
            </MenuItem>
          )}
          <MenuItem icon={<Trash2 />} destructive onSelect={pick(actions.remove)}>
            {auto ? `Удалить (−${stack.units} ед.)` : 'Убрать с палубы'}
          </MenuItem>
        </PopoverContent>
      </Popover>
    </div>
  )
}

// The right-click menu of a stack: the inspector's actions (spec 6.6).
export function StackMenuItems({ stack, actions }: { stack: InspectedStack; actions: StackActions }) {
  const auto = stack.kind !== 'manual'
  return (
    <>
      <MenuItem icon={stack.rotate.ok ? <RotateCw /> : <RotateCwOff />} disabled={!stack.rotate.ok} onSelect={actions.rotate}>
        Повернуть
      </MenuItem>
      {auto && stack.state === 'locked' && actions.unpin && (
        <MenuItem icon={<Unlock />} onSelect={actions.unpin}>
          Вернуть в авто
        </MenuItem>
      )}
      {auto && stack.state !== 'locked' && actions.pin && (
        <MenuItem icon={<Lock />} onSelect={actions.pin}>
          Закрепить
        </MenuItem>
      )}
      <MenuItem icon={<Trash2 />} destructive onSelect={actions.remove}>
        {auto ? `Удалить (−${stack.units} ед.)` : 'Убрать с палубы'}
      </MenuItem>
    </>
  )
}
