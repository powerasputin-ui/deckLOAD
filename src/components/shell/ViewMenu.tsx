'use client'

import { useId } from 'react'
import { ChevronDown, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useTheme } from '@/components/ThemeProvider'
import { useCalculator } from '@/store/calculator'
import type { ThemePreference } from '@/lib/theme'

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Тёмная' },
  { value: 'system', label: 'Как в системе' },
]

// How the deck is shown (spec 6.10, 8.7). These settings don't change the
// calculation; the theme is kept in this browser, the rest in the
// calculation, as before.
export function ViewMenu() {
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
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5" data-tour="view-menu">
          <Eye className="h-4 w-4" aria-hidden="true" />
          Вид
          <ChevronDown className="h-4 w-4 text-ink-2" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3 p-3">
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
