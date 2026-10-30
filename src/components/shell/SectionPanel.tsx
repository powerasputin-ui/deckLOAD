'use client'

import { createContext, useContext, useId } from 'react'
import { ChevronRight, CircleCheck, CircleX, ClipboardCheck, FileText, LayoutGrid, Package, PanelLeftClose, PanelLeftOpen, Ship, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SECTION_ORDER, SECTION_TITLE, type SectionId } from '@/lib/workflow'
import { cn } from '@/lib/utils'

export const SECTION_ICON: Record<SectionId, React.ComponentType<{ className?: string }>> = {
  vessel: Ship,
  cargo: Package,
  placement: LayoutGrid,
  checks: ClipboardCheck,
  report: FileText,
}

// The left panel (spec 5.4): the open section's content, 360 px wide, or a
// 48 px strip of section icons when collapsed. Opening and closing it never
// rescales the deck.
export function SectionPanel({
  active,
  collapsed,
  onCollapsedChange,
  onSelect,
  children,
}: {
  active: SectionId
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  onSelect: (id: SectionId) => void
  children: React.ReactNode
}) {
  if (collapsed) {
    return (
      <aside aria-label="Панель разделов" className="flex w-12 shrink-0 flex-col items-center gap-1 border-r bg-surface py-2">
        <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Развернуть панель" title="Развернуть панель" onClick={() => onCollapsedChange(false)}>
          <PanelLeftOpen className="h-4 w-4" />
        </Button>
        <div className="my-1 h-px w-6 bg-line" />
        {SECTION_ORDER.map((id) => {
          const Icon = SECTION_ICON[id]
          return (
            <Button
              key={id}
              variant="ghost"
              size="icon"
              aria-label={SECTION_TITLE[id]}
              title={SECTION_TITLE[id]}
              className={cn('h-9 w-9', id === active && 'bg-accent text-foreground')}
              onClick={() => {
                onSelect(id)
                onCollapsedChange(false)
              }}
            >
              <Icon className="h-4 w-4" />
            </Button>
          )
        })}
      </aside>
    )
  }

  const Icon = SECTION_ICON[active]
  return (
    <aside aria-labelledby="section-panel-title" className="flex w-[360px] shrink-0 flex-col border-r bg-surface">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <Icon className="h-4 w-4 text-ink-2" />
        <h2 id="section-panel-title" className="flex-1 text-base font-semibold">
          {SECTION_TITLE[active]}
        </h2>
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Свернуть панель" title="Свернуть панель" onClick={() => onCollapsedChange(true)}>
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>
      <div className="section-content thin-scrollbar min-h-0 flex-1 overflow-y-auto">{children}</div>
    </aside>
  )
}

// Blocks that fold (spec 8.1, revision 2026-10-30): the section holding
// them says which are open, and what a folded one shows — a line of what it
// holds, its step number when it is one of the steps to fill in, and a mark
// when something in it needs looking at.
export interface FoldingBlocks {
  isOpen: (id: string) => boolean
  toggle: (id: string) => void
  line: (id: string) => { summary: string; status?: 'ok' | 'warn' | 'error'; step?: number } | undefined
}

export const FoldingBlocksContext = createContext<FoldingBlocks | null>(null)

const STATUS_WORD = { ok: 'в порядке', warn: 'нужна проверка', error: 'ошибка' } as const

function StatusMark({ status }: { status: 'ok' | 'warn' | 'error' }) {
  const cls = 'mt-0.5 h-4 w-4 shrink-0'
  return status === 'ok' ? (
    <CircleCheck className={cn(cls, 'text-ok')} aria-hidden="true" />
  ) : status === 'warn' ? (
    <TriangleAlert className={cn(cls, 'text-warn')} aria-hidden="true" />
  ) : (
    <CircleX className={cn(cls, 'text-danger')} aria-hidden="true" />
  )
}

// One block of a section: a heading and its content, divided from the next
// block by a line rather than boxed in a card (spec 9.4). With `fold`, in a
// section that folds its blocks, the heading opens and folds it.
export function PanelBlock({ title, children, className, fold }: { title?: string; children: React.ReactNode; className?: string; fold?: string }) {
  const folding = useContext(FoldingBlocksContext)
  const uid = useId()
  if (!fold || !folding || !title) {
    return (
      <section className={cn('panel-block space-y-3 px-4 py-4', className)}>
        {title && <h3 className="text-sm font-semibold">{title}</h3>}
        {children}
      </section>
    )
  }
  const open = folding.isOpen(fold)
  const line = folding.line(fold)
  return (
    <section className={cn('panel-block', className)} data-fold={fold} data-open={open}>
      {/* The heading is named by the title alone; the folded line and the
          mark are its description. */}
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${uid}-body`}
          aria-describedby={line ? `${uid}-line` : undefined}
          onClick={() => folding.toggle(fold)}
          className="flex w-full items-start gap-2 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <ChevronRight className={cn('mt-0.5 h-4 w-4 shrink-0 text-ink-2 transition-transform', open && 'rotate-90')} aria-hidden="true" />
          {line?.step !== undefined && (
            <span
              aria-hidden="true"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line-strong text-xs font-medium tabular-nums text-ink-2"
            >
              {line.step}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{title}</span>
            {line && !open && (
              <span aria-hidden="true" className="block truncate text-xs text-ink-2" data-fold-line>
                {line.summary}
              </span>
            )}
          </span>
          {line?.status && <StatusMark status={line.status} />}
        </button>
      </h3>
      {line && (
        <span id={`${uid}-line`} hidden>
          {line.step !== undefined && `Шаг ${line.step}. `}
          {line.summary}
          {line.status && line.status !== 'ok' && `. ${STATUS_WORD[line.status]}`}
        </span>
      )}
      {open && (
        <div id={`${uid}-body`} className="space-y-3 px-4 pb-4">
          {children}
        </div>
      )}
    </section>
  )
}
