'use client'

import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'

// The cargo table's place (spec 5.4): it slides up from the bottom across
// the whole window, under the left panel and the deck, which get shorter —
// the deck keeps its scale. Its height is dragged by the bar on top, from
// 160 px to 80% of the window, 40% at first, and remembered in this browser
// as a share of the window. Esc inside it, outside a field, closes it.

const HEIGHT_KEY = 'deckload-cargo-table-height'
const MIN_PX = 160
const MAX_SHARE = 0.8
const DEFAULT_SHARE = 0.4

function readShare(): number {
  try {
    const v = Number(window.localStorage.getItem(HEIGHT_KEY))
    return v > 0 && v <= MAX_SHARE ? v : DEFAULT_SHARE
  } catch {
    return DEFAULT_SHARE
  }
}

function writeShare(share: number): void {
  try {
    window.localStorage.setItem(HEIGHT_KEY, String(Math.round(share * 1000) / 1000))
  } catch {
    // not remembered across visits
  }
}

export function CargoDrawer({ title, onClose, children }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  const [share, setShare] = useState(() => (typeof window === 'undefined' ? DEFAULT_SHARE : readShare()))
  const [windowHeight, setWindowHeight] = useState(() => (typeof window === 'undefined' ? 900 : window.innerHeight))
  useEffect(() => {
    const onResize = () => setWindowHeight(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const height = Math.round(Math.min(MAX_SHARE * windowHeight, Math.max(MIN_PX, share * windowHeight)))
  const clampShare = (px: number) => Math.min(MAX_SHARE, Math.max(MIN_PX / windowHeight, px / windowHeight))
  const resizeTo = (px: number, remember: boolean) => {
    const next = clampShare(px)
    setShare(next)
    if (remember) writeShare(next)
  }

  return (
    <section
      aria-label="Таблица грузов"
      className="relative flex shrink-0 flex-col border-t border-line-strong bg-surface"
      style={{ height }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || e.defaultPrevented) return
        const target = e.target instanceof Element ? e.target : null
        if (target?.closest('input, textarea, select, [role="dialog"], [role="listbox"]')) return
        e.stopPropagation()
        onClose()
      }}
      data-testid="cargo-drawer"
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Высота таблицы грузов"
        aria-valuemin={MIN_PX}
        aria-valuemax={Math.round(MAX_SHARE * windowHeight)}
        aria-valuenow={height}
        tabIndex={0}
        className="absolute inset-x-0 -top-1.5 z-20 h-3 cursor-row-resize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onPointerDown={(e) => {
          e.preventDefault()
          const startY = e.clientY
          const startHeight = height
          const target = e.currentTarget
          target.setPointerCapture(e.pointerId)
          const move = (ev: PointerEvent) => resizeTo(startHeight + (startY - ev.clientY), false)
          const up = (ev: PointerEvent) => {
            resizeTo(startHeight + (startY - ev.clientY), true)
            target.removeEventListener('pointermove', move)
            target.removeEventListener('pointerup', up)
          }
          target.addEventListener('pointermove', move)
          target.addEventListener('pointerup', up)
        }}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
          e.preventDefault()
          resizeTo(height + (e.key === 'ArrowUp' ? 40 : -40), true)
        }}
      >
        <span className="mx-auto mt-1 block h-1 w-12 rounded-full bg-line-strong" aria-hidden="true" />
      </div>
      <header className="flex items-center gap-2 px-4 pt-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Свернуть таблицу грузов"
          className="ml-auto inline-flex h-7 items-center gap-1 rounded px-2 text-sm text-ink-2 hover:bg-accent hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
          Свернуть
        </button>
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  )
}
