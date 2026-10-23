'use client'

import { useId, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useTheme } from '@/components/ThemeProvider'
import { useCalculator } from '@/store/calculator'
import type { ThemePreference } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { Legend } from './Legend'

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Тёмная' },
  { value: 'system', label: 'Как в системе' },
]

// How the deck is shown (spec 6.10, 8.7). These settings don't change the
// calculation; the theme is kept in this browser, the rest in the
// calculation, as before. «Условные обозначения» open in the same panel.
export function ViewMenu() {
  const [page, setPage] = useState<'settings' | 'legend'>('settings')
  const { preference, setPreference } = useTheme()
  const showGrid = useCalculator((s) => s.showGrid)
  const showLabels = useCalculator((s) => s.showLabels)
  const showFreeSpace = useCalculator((s) => s.showFreeSpace)
  const showCargoContents = useCalculator((s) => s.showCargoContents)
  const toggleGrid = useCalculator((s) => s.toggleGrid)
  const toggleLabels = useCalculator((s) => s.toggleLabels)
  const toggleFreeSpace = useCalculator((s) => s.toggleFreeSpace)
  const toggleCargoContents = useCalculator((s) => s.toggleCargoContents)
  const themeLabelId = useId()

  return (
    <Popover onOpenChange={(open) => !open && setPage('settings')}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5" data-tour="view-menu">
          <Eye className="h-4 w-4" aria-hidden="true" />
          Вид
          <ChevronDown className="h-4 w-4 text-ink-2" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={12}
        className={cn('thin-scrollbar space-y-3 overflow-y-auto p-3', page === 'legend' ? 'w-80' : 'w-72')}
        style={{ maxHeight: 'var(--radix-popover-content-available-height)' }}
      >
        {page === 'legend' ? (
          <>
            <div className="-ml-1 flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label="Назад к настройкам вида"
                onClick={() => setPage('settings')}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <h2 className="text-sm font-semibold">Условные обозначения</h2>
            </div>
            <Legend />
          </>
        ) : (
          <>
            <div className="space-y-2.5">
              <ViewToggle label="Сетка" checked={showGrid} onToggle={toggleGrid} />
              <ViewToggle label="Названия грузов" checked={showLabels} onToggle={toggleLabels} />
              <ViewToggle label="Свободное место" checked={showFreeSpace} onToggle={toggleFreeSpace} />
              <ViewToggle label="Содержимое при наведении" checked={showCargoContents} onToggle={toggleCargoContents} />
            </div>
            <div role="separator" className="h-px bg-line" />
            <div className="space-y-1.5">
              <span id={themeLabelId} className="text-sm">
                Тема
              </span>
              <ToggleGroup
                type="single"
                value={preference}
                onValueChange={(v) => v && setPreference(v as ThemePreference)}
                aria-labelledby={themeLabelId}
                className="grid grid-cols-3 gap-1"
              >
                {THEME_OPTIONS.map((o) => (
                  <ToggleGroupItem
                    key={o.value}
                    value={o.value}
                    className="h-8 rounded-md border px-1 text-xs data-[state=on]:border-line-strong data-[state=on]:bg-accent data-[state=on]:font-medium"
                  >
                    {o.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            <div role="separator" className="h-px bg-line" />
            <button
              type="button"
              onClick={() => setPage('legend')}
              className="-mx-1 flex h-8 w-[calc(100%+0.5rem)] items-center rounded-md px-1 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
            >
              <span className="flex-1">Условные обозначения</span>
              <ChevronRight className="h-4 w-4 text-ink-2" aria-hidden="true" />
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

function ViewToggle({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
  const id = useId()
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="text-sm">
        {label}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onToggle} />
    </div>
  )
}
