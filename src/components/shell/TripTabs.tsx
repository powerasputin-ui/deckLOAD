'use client'

import { cn } from '@/lib/utils'

// Tabs over the deck when the cargo takes more than one trip (spec 6.9):
// «Рейс 1 · 17 ед. · 81%».
export function TripTabs({
  trips,
  activeIndex,
  onSelect,
}: {
  trips: readonly { placedCount: number; utilization: number }[]
  activeIndex: number
  onSelect: (index: number) => void
}) {
  if (trips.length < 2) return null
  return (
    <div role="tablist" aria-label="Рейсы" className="flex min-w-0 items-center gap-1 overflow-x-auto">
      {trips.map((t, i) => {
        const active = i === activeIndex
        return (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(i)}
            className={cn(
              'h-8 shrink-0 whitespace-nowrap rounded-md border px-2.5 text-sm tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active ? 'border-line-strong bg-surface font-medium text-foreground' : 'border-transparent text-ink-2 hover:bg-accent hover:text-foreground'
            )}
          >
            Рейс {i + 1} · {t.placedCount} ед. · {Math.round(t.utilization * 100)}%
          </button>
        )
      })}
    </div>
  )
}
