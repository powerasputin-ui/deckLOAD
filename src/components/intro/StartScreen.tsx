'use client'

import { useEffect, useId, useMemo, useRef } from 'react'
import { Ship } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ShaderBackground } from '@/components/ui/neuro-noise'
import { PlanShapes } from '@/components/report/PlanDrawingSvg'
import { buildPlanDrawing } from '@/lib/planDrawing'
import { cargoNumbers } from '@/lib/cargoPalette'
import { packMultiTrip } from '@/lib/packing'
import { createDemoItems, DEMO_DECK } from '@/store/calculator'

// The start screen (spec 10.1), in place of the intro video: what DeckLoad
// is, a finished plan to show it, and three ways in — from a vessel, from
// the example, or from an empty deck. It lies over the calculator, which
// stays as it was under it; Esc closes it.
export function StartScreen({
  onStartWithVessel,
  onOpenExample,
  onEmptyDeck,
  onClose,
}: {
  onStartWithVessel: () => void
  onOpenExample: () => void
  onEmptyDeck: () => void
  onClose: () => void
}) {
  const titleId = useId()
  const startRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    startRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="fixed inset-0 z-50 overflow-y-auto bg-[#0C1724]">
      <ShaderBackground className="fixed inset-0 h-full w-full" />
      <div className="relative flex min-h-full flex-col items-center justify-center gap-8 px-6 py-10">
        <div className="space-y-2 text-center">
          <h1 id={titleId} className="text-[40px] font-semibold leading-tight tracking-tight text-white drop-shadow">
            DeckLoad
          </h1>
          <p className="text-lg text-white/90 drop-shadow">План палубы, вес и остойчивость за 5 минут</p>
        </div>
        <DemoPlan />
        <div className="flex flex-col items-center gap-3">
          <div className="flex flex-wrap justify-center gap-3">
            <Button ref={startRef} size="lg" className="h-11 bg-primary px-6 text-base text-primary-foreground hover:bg-primary-hover" onClick={onStartWithVessel}>
              <Ship className="mr-2 h-5 w-5" aria-hidden="true" />
              Начать с судна
            </Button>
            <Button size="lg" variant="outline" className="h-11 border-white/60 bg-white/10 px-6 text-base text-white hover:bg-white/20 hover:text-white" onClick={onOpenExample}>
              Открыть пример
            </Button>
          </div>
          <button
            type="button"
            onClick={onEmptyDeck}
            className="rounded px-2 py-1 text-sm text-white/90 underline underline-offset-4 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            Пустая палуба
          </button>
        </div>
      </div>
    </div>
  )
}

// The example's plan, drawn as the PDF draws it, on a sheet of paper.
const PICTURE = { w: 640, h: 300 }

function DemoPlan() {
  const drawing = useMemo(() => {
    let n = 0
    const items = createDemoItems(() => `demo-${++n}`)
    const deck = { ...DEMO_DECK }
    const [trip] = packMultiTrip(deck.width, deck.length, items, { gap: deck.gap, boardOffset: deck.boardOffset, clearance: deck.clearance, unit: deck.unit })
    return buildPlanDrawing({ deck, placed: trip?.placed ?? [], numbers: cargoNumbers(items), frame: { x: 8, y: 8, w: PICTURE.w - 16, h: PICTURE.h - 16 } })
  }, [])
  return (
    <svg
      viewBox={`0 0 ${PICTURE.w} ${PICTURE.h}`}
      role="img"
      aria-label="Готовый план палубы примера"
      className="w-full max-w-[640px] rounded-lg bg-white shadow-2xl"
    >
      <PlanShapes shapes={drawing.shapes} />
    </svg>
  )
}
