'use client'

import { BookOpen, Factory, PackagePlus, Ship } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { OBJECT_KIND_GENITIVE, type ObjectKind } from '@/lib/objectKind'

// An empty deck (spec 10.3): the next step from here — a vessel, the cargo
// or the example. A bar along the top of the deck view, like the stamp's
// hint, so the deck itself stays free for its outline, obstacles and photo.
export function EmptyDeck({
  vesselChosen = false,
  kind = 'vessel',
  onChooseVessel,
  onAddCargo,
  onOpenExample,
}: {
  // A vessel from the library is already on the deck: the step is to change
  // it, not to choose one.
  vesselChosen?: boolean
  // What the deck is of (spec 2026-11-06): a platform's step is its own data.
  kind?: ObjectKind
  onChooseVessel: () => void
  onAddCargo: () => void
  onOpenExample: () => void
}) {
  const platform = kind !== 'vessel'
  return (
    <div className="pointer-events-none absolute inset-x-0 top-2 z-20 flex justify-center px-4">
      <section
        aria-labelledby="empty-deck-title"
        className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-md border border-line-strong bg-surface py-1 pl-3 pr-2 text-sm shadow-sm"
      >
        <h2 id="empty-deck-title" className="mr-1 text-sm font-medium">
          На палубе пока нет груза
        </h2>
        <Button variant="outline" size="sm" className="h-7" onClick={onChooseVessel}>
          {platform ? <Factory className="mr-1 h-4 w-4" aria-hidden="true" /> : <Ship className="mr-1 h-4 w-4" aria-hidden="true" />}
          {platform ? `Данные ${OBJECT_KIND_GENITIVE[kind]}` : vesselChosen ? 'Сменить судно' : 'Выбрать судно'}
        </Button>
        <Button variant="outline" size="sm" className="h-7" onClick={onAddCargo}>
          <PackagePlus className="mr-1 h-4 w-4" aria-hidden="true" />
          Добавить груз
        </Button>
        <button
          type="button"
          onClick={onOpenExample}
          className="inline-flex h-7 items-center gap-1 rounded px-1 text-sm text-ink-2 underline underline-offset-4 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
          Открыть пример
        </button>
      </section>
    </div>
  )
}
