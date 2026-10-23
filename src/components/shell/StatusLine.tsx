'use client'

import { statusItems, type StatusLineInput } from '@/lib/statusLine'
import type { SectionId } from '@/lib/workflow'
import { cn } from '@/lib/utils'

// The line under the deck (spec 8.3). Each number opens the section where it
// is set or explained.
export function StatusLine({ input, onOpenSection }: { input: StatusLineInput; onOpenSection: (id: SectionId) => void }) {
  const items = statusItems(input)
  return (
    <div
      role="status"
      aria-label="Итог расчёта"
      data-tour="status-line"
      className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-t bg-surface px-3 text-sm tabular-nums"
    >
      {items.map((item, i) => (
        <span key={item.id} className="flex items-center gap-1">
          {i > 0 && (
            <span aria-hidden="true" className="text-ink-2">
              ·
            </span>
          )}
          <button
            type="button"
            title={item.title}
            onClick={() => onOpenSection(item.target)}
            data-status-item={item.id}
            className={cn(
              'whitespace-nowrap rounded px-1.5 py-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              item.tone === 'danger' ? 'font-medium text-danger' : 'text-ink'
            )}
          >
            {item.text}
          </button>
        </span>
      ))}
    </div>
  )
}
