'use client'

import { Box, Check, CircleX, Download, MousePointerClick, Redo2, Square, TriangleAlert, Undo2, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { SECTION_ORDER, SECTION_TITLE, type SectionId, type SectionMark } from '@/lib/workflow'
import { cn, pluralRu } from '@/lib/utils'

// The 52 px bar on top (spec 5.2): the project on the left, the five
// sections in the middle, then undo, the two modes, the one orange action
// and help on the right.
export function TopBar({
  projectMenu,
  helpMenu,
  activeSection,
  marks,
  onSelectSection,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  mode,
  onModeChange,
  viewMode,
  onViewModeChange,
  onExportPdf,
}: {
  projectMenu: React.ReactNode
  helpMenu: React.ReactNode
  activeSection: SectionId
  marks: Record<SectionId, SectionMark>
  onSelectSection: (id: SectionId) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  mode: 'auto' | 'manual'
  onModeChange: (mode: 'auto' | 'manual') => void
  viewMode: '2d' | '3d'
  onViewModeChange: (mode: '2d' | '3d') => void
  onExportPdf: () => void
}) {
  return (
    <header className="z-30 flex h-[52px] shrink-0 items-center gap-2 border-b bg-surface px-2">
      <div className="flex min-w-0 shrink items-center">{projectMenu}</div>

      <nav aria-label="Разделы" className="mx-auto flex h-full items-stretch">
        {SECTION_ORDER.map((id) => (
          <SectionTab key={id} id={id} active={id === activeSection} mark={marks[id]} onSelect={() => onSelectSection(id)} />
        ))}
      </nav>

      <div className="flex shrink-0 items-center gap-1.5">
        <Button variant="ghost" size="icon" className="h-9 w-9" title="Отменить (Ctrl+Z)" disabled={!canUndo} onClick={onUndo}>
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-9 w-9" title="Повторить (Ctrl+Y)" disabled={!canRedo} onClick={onRedo}>
          <Redo2 className="h-4 w-4" />
        </Button>

        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(v) => v && onModeChange(v as 'auto' | 'manual')}
          aria-label="Режим расстановки"
          className="ml-1 rounded-md border bg-surface"
          data-tour="mode"
        >
          <ToggleGroupItem value="auto" className="h-8 px-2.5 data-[state=on]:bg-accent data-[state=on]:text-foreground" title="Авто: грузы расставляются сами, перетаскивание закрепляет">
            <Wand2 className="h-4 w-4 xl:mr-1" aria-hidden="true" />
            <span className="sr-only xl:not-sr-only text-sm">Авто</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="manual" className="h-8 px-2.5 data-[state=on]:bg-accent data-[state=on]:text-foreground" title="Ручной: каждый груз ставите вы">
            <MousePointerClick className="h-4 w-4 xl:mr-1" aria-hidden="true" />
            <span className="sr-only xl:not-sr-only text-sm">Ручной</span>
          </ToggleGroupItem>
        </ToggleGroup>

        <ToggleGroup
          type="single"
          value={viewMode}
          onValueChange={(v) => v && onViewModeChange(v as '2d' | '3d')}
          aria-label="Вид палубы"
          className="rounded-md border bg-surface"
          data-tour="view-mode"
        >
          <ToggleGroupItem value="2d" className="h-8 px-2.5 data-[state=on]:bg-accent data-[state=on]:text-foreground">
            <Square className="h-4 w-4 xl:mr-1" aria-hidden="true" />
            <span className="sr-only xl:not-sr-only text-sm">2D</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="3d" className="h-8 px-2.5 data-[state=on]:bg-accent data-[state=on]:text-foreground">
            <Box className="h-4 w-4 xl:mr-1" aria-hidden="true" />
            <span className="sr-only xl:not-sr-only text-sm">3D</span>
          </ToggleGroupItem>
        </ToggleGroup>

        <Button className="ml-1 h-9 bg-primary text-primary-foreground hover:bg-primary-hover" onClick={onExportPdf} data-tour="export-pdf">
          <Download className="h-4 w-4 xl:mr-1.5" aria-hidden="true" />
          <span className="sr-only xl:not-sr-only">Скачать PDF</span>
        </Button>
        {helpMenu}
      </div>
    </header>
  )
}

function SectionTab({ id, active, mark, onSelect }: { id: SectionId; active: boolean; mark: SectionMark; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'page' : undefined}
      data-tour={`section-${id}`}
      className={cn(
        'relative flex items-center gap-1.5 px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        active ? 'text-foreground' : 'text-ink-2 hover:text-foreground',
        active && 'after:absolute after:inset-x-2 after:bottom-0 after:h-[3px] after:rounded-t after:bg-primary'
      )}
    >
      {SECTION_TITLE[id]}
      <MarkBadge mark={mark} />
    </button>
  )
}

function MarkBadge({ mark }: { mark: SectionMark }) {
  if (mark.kind === 'done') {
    return (
      <>
        <Check className="h-4 w-4 text-ok" aria-hidden="true" />
        <span className="sr-only">— готово</span>
      </>
    )
  }
  if (mark.kind === 'errors') {
    return (
      <span className="flex items-center gap-0.5 text-danger">
        <CircleX className="h-4 w-4" aria-hidden="true" />
        <span aria-hidden="true">{mark.count}</span>
        <span className="sr-only">
          — {mark.count} {pluralRu(mark.count, 'ошибка', 'ошибки', 'ошибок')}
        </span>
      </span>
    )
  }
  if (mark.kind === 'warnings') {
    return (
      <span className="flex items-center gap-0.5 text-warn">
        <TriangleAlert className="h-4 w-4" aria-hidden="true" />
        <span aria-hidden="true">{mark.count}</span>
        <span className="sr-only">
          — {mark.count} {pluralRu(mark.count, 'предупреждение', 'предупреждения', 'предупреждений')}
        </span>
      </span>
    )
  }
  return null
}
