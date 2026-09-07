'use client'

// First-time-user product tour: a full-screen spotlight overlay that walks
// through the app's own real DOM elements (found via `data-tour="..."`
// attributes sprinkled through Sidebar/DeckVisualization/PlacementPanel/
// StatsPanel/StabilityPanel/page.tsx's header), one step at a time — "show
// and explain, click Далее" throughout (confirmed with the user: no
// forced "perform this action to continue" steps, to keep the state
// machine simple and predictable). See src/app/page.tsx for the step list,
// the localStorage "seen" flag, and how this is wired to both the
// automatic first-run trigger and the manual "show again" entry point.
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'

export interface TourStep {
  id: string
  // CSS selector matching a `data-tour="..."` attribute somewhere in the
  // app — NOT a component prop, so the tour never needs to know anything
  // about how each target is actually built.
  selector: string
  title: string
  body: string
}

interface ProductTourProps {
  steps: TourStep[]
  active: boolean
  onClose: () => void
}

// Gap between the highlighted element and both the spotlight ring and the
// tooltip card — purely visual breathing room.
const SPOTLIGHT_PADDING = 8
const CARD_GAP = 12
const CARD_WIDTH = 320
const CARD_MARGIN = 16

export function ProductTour({ steps, active, onClose }: ProductTourProps) {
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [missingTarget, setMissingTarget] = useState(false)

  // Reset to the first step every time the tour is (re)armed — covers both
  // the automatic first-run trigger and a manual "show again" restart.
  const [prevActive, setPrevActive] = useState(active)
  if (active !== prevActive) {
    setPrevActive(active)
    if (active) setIndex(0)
  }

  const step = active ? steps[index] : undefined

  useEffect(() => {
    if (!step) return
    const update = () => {
      const el = document.querySelector(step.selector)
      const box = el?.getBoundingClientRect()
      // A target can be present in the DOM but squeezed unusably thin — on
      // narrow viewports the sidebar doesn't collapse, so the main content
      // grid it shares a flex row with gets crushed to a sliver rather than
      // stacking. Spotlighting that sliver would be worse than no spotlight.
      // This only happens below the sidebar's own collapse breakpoint —
      // gating it on viewport width keeps it from misfiring on ordinary
      // small controls (a toolbar button, a card action) that are legitimately
      // narrower than a quarter of a normal desktop window.
      const isNarrowViewport = window.innerWidth < 768
      const looksCrushed = isNarrowViewport && box ? box.width < window.innerWidth * 0.25 : false
      if (box && box.width > 4 && box.height > 4 && !looksCrushed) {
        setRect(box)
        setMissingTarget(false)
      } else {
        setRect(null)
        setMissingTarget(true)
      }
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [step])

  if (!step) return null

  const isLast = index === steps.length - 1
  const goNext = () => (isLast ? onClose() : setIndex((i) => i + 1))

  // Simple placement heuristic: prefer below the target, then above, then
  // beside it, then just centered — good enough for a handful of fixed
  // layout anchors, not meant to handle arbitrary future targets perfectly.
  const cardStyle: React.CSSProperties = { position: 'fixed', width: CARD_WIDTH }
  if (rect) {
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top
    const left = Math.min(Math.max(rect.left, CARD_MARGIN), window.innerWidth - CARD_WIDTH - CARD_MARGIN)
    if (spaceBelow > 180) {
      cardStyle.top = rect.bottom + CARD_GAP
      cardStyle.left = left
    } else if (spaceAbove > 180) {
      cardStyle.bottom = window.innerHeight - rect.top + CARD_GAP
      cardStyle.left = left
    } else if (window.innerWidth - rect.right > CARD_WIDTH + CARD_GAP + CARD_MARGIN) {
      cardStyle.top = Math.min(Math.max(rect.top, CARD_MARGIN), window.innerHeight - 220)
      cardStyle.left = rect.right + CARD_GAP
    } else {
      cardStyle.top = '50%'
      cardStyle.left = '50%'
      cardStyle.transform = 'translate(-50%, -50%)'
    }
  } else {
    cardStyle.top = '50%'
    cardStyle.left = '50%'
    cardStyle.transform = 'translate(-50%, -50%)'
  }

  return (
    <div className="fixed inset-0 z-[100]">
      {/* Dimmed backdrop with a cut-out around the target, built from one
          box-shadow instead of an SVG mask — simpler, and plenty for a
          plain rounded rectangle. Blocks clicks to the app underneath on
          purpose: this tour is "show and explain", not "click through it"
          (confirmed with the user), so nothing should be reachable except
          the card's own buttons while it's up. */}
      {rect && !missingTarget ? (
        <div
          className="absolute rounded-lg transition-all duration-200 ease-out"
          style={{
            top: rect.top - SPOTLIGHT_PADDING,
            left: rect.left - SPOTLIGHT_PADDING,
            width: rect.width + SPOTLIGHT_PADDING * 2,
            height: rect.height + SPOTLIGHT_PADDING * 2,
            boxShadow: '0 0 0 9999px rgba(15,23,42,0.65)',
            outline: '2px solid rgba(59,130,246,0.9)',
            outlineOffset: 2,
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-slate-900/65" />
      )}

      <div
        style={cardStyle}
        className="rounded-lg border bg-card text-card-foreground shadow-xl p-4 space-y-3"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Шаг {index + 1} из {steps.length}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть обучение"
            className="text-muted-foreground hover:text-foreground -mt-1 -mr-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-1">
          <div className="text-sm font-semibold">{step.title}</div>
          <p className="text-xs text-muted-foreground leading-relaxed">{step.body}</p>
        </div>
        <div className="flex items-center justify-between gap-2 pt-1">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClose}>
            Пропустить тур
          </Button>
          <Button size="sm" className="h-7 text-xs" onClick={goNext}>
            {isLast ? 'Готово' : 'Далее'}
          </Button>
        </div>
      </div>
    </div>
  )
}
