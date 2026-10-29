'use client'

import { ClipboardCheck, FileText, LayoutGrid, Package, PanelLeftClose, PanelLeftOpen, Ship } from 'lucide-react'
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

// One block of a section: a heading and its content, divided from the next
// block by a line rather than boxed in a card (spec 9.4).
export function PanelBlock({ title, children, className }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('panel-block space-y-3 px-4 py-4', className)}>
      {title && <h3 className="text-sm font-semibold">{title}</h3>}
      {children}
    </section>
  )
}
