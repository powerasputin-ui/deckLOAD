'use client'

import { ChevronRight, CircleCheck, CircleX, Minus, TriangleAlert } from 'lucide-react'
import { StatsPanel } from '@/components/calculator/StatsPanel'
import { LashingPointsSection, SeparationRulesSection } from '@/components/calculator/Sidebar'
import { PanelBlock } from '@/components/shell/SectionPanel'
import type { Check, CheckStatus } from '@/lib/checks'
import { SECTION_TITLE, type SectionId } from '@/lib/workflow'
import { cn } from '@/lib/utils'

// «Проверки» (spec 13, stage 2): the summary of the plan's checks (8.4) on
// top — what the ✕ and ⚠ in the status line count — then today's load
// statistics, separation and lashing. The stability result is in the
// stability workspace (spec 2026-10-24, 6.1). Stage 4 turns the whole
// section into the single list of checks.
export function ChecksSection({
  checks,
  onOpenSection,
  stats,
  lashing,
}: {
  checks: readonly Check[]
  onOpenSection: (id: SectionId) => void
  stats: React.ComponentProps<typeof StatsPanel>
  lashing: React.ComponentProps<typeof LashingPointsSection>
}) {
  return (
    <>
      <PanelBlock title="Сводка проверок">
        <ul className="space-y-2" aria-label="Сводка проверок">
          {checks.map((c) => (
            <li key={c.id} data-check={c.id} data-check-status={c.status} className="flex items-start gap-2">
              <StatusIcon status={c.status} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{c.title}</div>
                <div className={cn('text-xs', c.status === 'error' ? 'text-danger' : 'text-ink-2')}>{c.detail}</div>
              </div>
              {c.target !== 'checks' && (
                <button
                  type="button"
                  onClick={() => onOpenSection(c.target)}
                  aria-label={`${c.title}: открыть раздел «${SECTION_TITLE[c.target]}»`}
                  className="flex shrink-0 items-center gap-0.5 rounded px-1 text-xs text-ink-2 hover:bg-accent hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {SECTION_TITLE[c.target]}
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      </PanelBlock>
      <StatsPanel {...stats} />
      <div className="px-4 py-3">
        <SeparationRulesSection />
      </div>
      <div className="px-4 py-3">
        <LashingPointsSection {...lashing} />
      </div>
    </>
  )
}

const STATUS_WORD: Record<CheckStatus, string> = {
  ok: 'норма',
  warn: 'предупреждение',
  error: 'ошибка',
  none: 'не проверяется',
}

function StatusIcon({ status }: { status: CheckStatus }) {
  const icon =
    status === 'ok' ? (
      <CircleCheck className="h-4 w-4 text-ok" />
    ) : status === 'warn' ? (
      <TriangleAlert className="h-4 w-4 text-warn" />
    ) : status === 'error' ? (
      <CircleX className="h-4 w-4 text-danger" />
    ) : (
      <Minus className="h-4 w-4 text-ink-2" />
    )
  return (
    <span className="mt-0.5 shrink-0">
      <span aria-hidden="true">{icon}</span>
      <span className="sr-only">{STATUS_WORD[status]}: </span>
    </span>
  )
}
