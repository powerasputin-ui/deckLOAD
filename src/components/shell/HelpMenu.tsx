'use client'

import { useState } from 'react'
import { CircleHelp, Keyboard, MapPinned, PlayCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { MENU_CLOSES_AT_ONCE, MenuItem } from './menu'

// The keys the app handles today. Stage 6 adds Tab between stacks, R, + / −,
// L and Delete (spec 6.8).
const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: 'Ctrl+Z', action: 'Отменить' },
  { keys: 'Ctrl+Y, Ctrl+Shift+Z', action: 'Повторить' },
  { keys: 'Стрелки', action: 'Сдвинуть выделенный штабель на четверть шага сетки' },
  { keys: 'Пробел', action: 'Повернуть выделенный штабель' },
  { keys: 'Esc', action: 'Снять инструмент или выбранный для постановки груз' },
]

export function HelpMenu({ onStartTour, onShowIntro }: { onStartTour: () => void; onShowIntro: () => void }) {
  const [open, setOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const pick = (action: () => void) => () => {
    setOpen(false)
    action()
  }
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Справка" title="Справка">
            <CircleHelp className="h-5 w-5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className={cn('w-60 p-1', MENU_CLOSES_AT_ONCE)}>
          <MenuItem icon={<MapPinned />} onSelect={pick(onStartTour)}>
            Пройти тур
          </MenuItem>
          <MenuItem icon={<Keyboard />} onSelect={pick(() => setShortcutsOpen(true))}>
            Горячие клавиши
          </MenuItem>
          <MenuItem icon={<PlayCircle />} onSelect={pick(onShowIntro)}>
            Показать вступление
          </MenuItem>
        </PopoverContent>
      </Popover>
      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Горячие клавиши</DialogTitle>
            <DialogDescription>Работают, когда курсор не в поле ввода.</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {SHORTCUTS.map((s) => (
              <div key={s.keys} className="contents">
                <dt className="font-mono text-ink">{s.keys}</dt>
                <dd className="text-ink-2">{s.action}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </>
  )
}
