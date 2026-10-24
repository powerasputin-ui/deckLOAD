'use client'

import { RotateCw, X } from 'lucide-react'

// Click placement (spec 7.1): a line over the deck while a cargo is armed —
// what a click does, R and Esc, and ↻ and ✕ for a touch screen. It floats
// over the deck's top margin, so arming a cargo never rescales the deck.
export function StampHint({ name, onRotate, onCancel }: { name: string; onRotate: () => void; onCancel: () => void }) {
  const text = `Кликните по палубе, чтобы поставить «${name}» · R — повернуть · Esc — отмена`
  return (
    <div className="pointer-events-none absolute inset-x-0 top-2 z-20 flex justify-center px-4">
      <div
        className="pointer-events-auto flex max-w-full items-center gap-1 rounded-md border border-line-strong bg-surface py-1 pl-3 pr-1 text-sm shadow-sm"
        data-testid="stamp-hint"
      >
        <p role="status" className="mr-1 min-w-0 truncate" title={text}>
          {text}
        </p>
        <button
          type="button"
          onClick={onRotate}
          aria-label="Повернуть груз"
          title="Повернуть груз (R)"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-2 hover:bg-accent hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RotateCw className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Отменить постановку"
          title="Отменить постановку (Esc)"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-2 hover:bg-accent hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
