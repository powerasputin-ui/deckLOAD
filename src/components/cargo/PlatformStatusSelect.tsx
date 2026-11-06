'use client'

import { isPlatformStatus, PLATFORM_STATUS_LABEL, PLATFORM_STATUSES, platformStatusOf, type PlatformStatus } from '@/lib/objectKind'
import type { CargoItem } from '@/lib/packing'
import { cn } from '@/lib/utils'

// A platform's cargo status (spec 2026-11-06, 6): on its deck already,
// arriving with the supply vessel, or leaving with it. A plain select: it
// reads in the list's narrow row, works from the keyboard and on a phone.
export function PlatformStatusSelect({
  item,
  onChange,
  className,
}: {
  item: Pick<CargoItem, 'name' | 'platformStatus'>
  onChange: (status: PlatformStatus) => void
  className?: string
}) {
  return (
    <select
      aria-label={`Статус «${item.name}»`}
      value={platformStatusOf(item)}
      onChange={(e) => {
        if (isPlatformStatus(e.target.value)) onChange(e.target.value)
      }}
      className={cn('h-6 rounded border border-input bg-background px-1 text-xs text-ink', className)}
    >
      {PLATFORM_STATUSES.map((s) => (
        <option key={s} value={s}>
          {PLATFORM_STATUS_LABEL[s]}
        </option>
      ))}
    </select>
  )
}
