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
  onOpenStability,
  stats,
  lashing,
}: {
  checks: readonly Check[]
  onOpenSection: (id: SectionId) => void
  onOpenStability: () => void
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
                {c.lines ? (
                  <ul className="mt-0.5 space-y-0.5" aria-label={`${c.title}: причины`}>
                    {c.lines.map((line) => (
                      <li key={line.text} className={cn('flex items-start gap-1 text-xs', line.status === 'error' ? 'text-danger' : 'text-ink-2')}>
                        <StatusIcon status={line.status} small />
                        <span>{line.text}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className={cn('text-xs', c.status === 'error' ? 'text-danger' : 'text-ink-2')}>{c.detail}</div>
                )}
              </div>
              <TargetLink check={c} onOpenSection={onOpenSection} onOpenStability={onOpenStability} />
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

// Where a check's settings are: another section, or the stability
// workspace. None for the checks whose settings are here.
function TargetLink({ check, onOpenSection, onOpenStability }: { check: Check; onOpenSection: (id: SectionId) => void; onOpenStability: () => void }) {
  const { target } = check
  if (target === 'checks') return null
  const [label, text, open] =
    target === 'stability'
      ? [`${check.title}: открыть панель остойчивости`, 'Открыть', onOpenStability]
      : [`${check.title}: открыть раздел «${SECTION_TITLE[target]}»`, SECTION_TITLE[target], () => onOpenSection(target)]
  return (
    <button
      type="button"
      onClick={open}
      aria-label={label}
      className="flex shrink-0 items-center gap-0.5 rounded px-1 text-xs text-ink-2 hover:bg-accent hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {text}
      <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  )
}

const STATUS_WORD: Record<CheckStatus, string> = {
  ok: 'норма',
  warn: 'предупреждение',
  error: 'ошибка',
  none: 'не проверяется',
}

function StatusIcon({ status, small }: { status: CheckStatus; small?: boolean }) {
  const size = small ? 'h-3.5 w-3.5' : 'h-4 w-4'
  const icon =
    status === 'ok' ? (
      <CircleCheck className={cn(size, 'text-ok')} />
    ) : status === 'warn' ? (
      <TriangleAlert className={cn(size, 'text-warn')} />
    ) : status === 'error' ? (
      <CircleX className={cn(size, 'text-danger')} />
    ) : (
      <Minus className={cn(size, 'text-ink-2')} />
    )
  return (
    <span className={cn('shrink-0', small ? 'mt-px' : 'mt-0.5')}>
      <span aria-hidden="true">{icon}</span>
      <span className="sr-only">{STATUS_WORD[status]}: </span>
    </span>
  )
}
