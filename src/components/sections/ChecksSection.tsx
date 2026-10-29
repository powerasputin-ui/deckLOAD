'use client'

import { ChevronDown, ChevronRight, CircleCheck, CircleX, Info, Minus, TriangleAlert } from 'lucide-react'
import { LashingPointsSection, SeparationRulesSection } from '@/components/calculator/Sidebar'
import { PanelBlock } from '@/components/shell/SectionPanel'
import type { Check, CheckDetailLine, CheckDetails, CheckId, CheckStatus } from '@/lib/checks'
import { SECTION_TITLE, type SectionId } from '@/lib/workflow'
import { cn } from '@/lib/utils'

// «Проверки» (spec 8.4): one list. A click opens a check: what it found,
// line by line, with the trip named when there are several — and the
// stacks at fault light up on the open trip's deck (the page dims the
// rest). Separation and lashing keep their sidebar blocks below until they
// move into their checks and the inspector.
export function ChecksSection({
  checks,
  openCheck,
  openDetails,
  onToggleCheck,
  tripIndex,
  onSelectTrip,
  onOpenSection,
  onOpenStability,
  lashing,
}: {
  checks: readonly Check[]
  openCheck: CheckId | null
  openDetails: CheckDetails | null
  onToggleCheck: (id: CheckId) => void
  // The open trip, and opening another.
  tripIndex: number
  onSelectTrip: (index: number) => void
  onOpenSection: (id: SectionId) => void
  onOpenStability: () => void
  lashing: React.ComponentProps<typeof LashingPointsSection>
}) {
  return (
    <>
      <PanelBlock>
        <ul className="-mx-2 space-y-0.5" aria-label="Список проверок">
          {checks.map((c) => {
            const open = c.id === openCheck
            const detailsId = `check-details-${c.id}`
            return (
              <li key={c.id} data-check={c.id} data-check-status={c.status}>
                <button
                  type="button"
                  onClick={() => onToggleCheck(c.id)}
                  aria-expanded={open}
                  aria-controls={open ? detailsId : undefined}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    open && 'bg-accent'
                  )}
                >
                  <StatusIcon status={c.status} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{c.title}</span>
                    <span className={cn('block text-xs', c.status === 'error' ? 'text-danger' : 'text-ink-2')}>{c.detail}</span>
                  </span>
                  {open ? (
                    <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-ink-2" aria-hidden="true" />
                  ) : (
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-ink-2" aria-hidden="true" />
                  )}
                </button>
                {open && (
                  <div id={detailsId} className="space-y-2 px-2 pt-1 pb-2 pl-8">
                    <DetailLines
                      check={c}
                      details={openDetails}
                      tripIndex={tripIndex}
                      onSelectTrip={onSelectTrip}
                    />
                    <TargetLink check={c} onOpenSection={onOpenSection} onOpenStability={onOpenStability} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </PanelBlock>
      <div className="px-4 py-3">
        <SeparationRulesSection />
      </div>
      <div className="px-4 py-3">
        <LashingPointsSection {...lashing} />
      </div>
    </>
  )
}

// What an open check found. Stability's reasons come with the check; the
// rest from checkDetails. A line about another trip offers to open it.
function DetailLines({
  check,
  details,
  tripIndex,
  onSelectTrip,
}: {
  check: Check
  details: CheckDetails | null
  tripIndex: number
  onSelectTrip: (index: number) => void
}) {
  const lines: CheckDetailLine[] = check.lines ?? details?.lines ?? []
  if (lines.length === 0) return null
  return (
    <ul className="space-y-1" aria-label={`${check.title}: подробности`}>
      {lines.map((line, i) => (
        <li key={i} className={cn('flex items-start gap-1 text-xs', line.status === 'error' ? 'text-danger' : 'text-ink-2')}>
          <StatusIcon status={line.status} small />
          <span className="min-w-0">
            {line.trip !== undefined &&
              (line.trip === tripIndex ? (
                <span className="font-medium">Рейс {line.trip + 1}: </span>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onSelectTrip(line.trip!)}
                    className="font-medium underline underline-offset-2 hover:text-ink"
                  >
                    Рейс {line.trip + 1}
                  </button>
                  {': '}
                </>
              ))}
            {line.text}
          </span>
        </li>
      ))}
    </ul>
  )
}

// Where a check's settings are: another section, or the stability
// workspace. None for the checks whose settings are here.
function TargetLink({ check, onOpenSection, onOpenStability }: { check: Check; onOpenSection: (id: SectionId) => void; onOpenStability: () => void }) {
  const { target } = check
  if (target === 'checks') return null
  const [label, text, open] =
    target === 'stability'
      ? [`${check.title}: открыть панель остойчивости`, 'Открыть остойчивость', onOpenStability]
      : [`${check.title}: открыть раздел «${SECTION_TITLE[target]}»`, `Настроить в разделе «${SECTION_TITLE[target]}»`, () => onOpenSection(target)]
  return (
    <button
      type="button"
      onClick={open}
      aria-label={label}
      className="flex items-center gap-0.5 rounded text-xs text-ink-2 underline underline-offset-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {text}
      <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  )
}

const STATUS_WORD: Record<CheckStatus | 'info', string> = {
  ok: 'норма',
  warn: 'предупреждение',
  error: 'ошибка',
  none: 'не проверяется',
  info: 'сведения',
}

function StatusIcon({ status, small }: { status: CheckStatus | 'info'; small?: boolean }) {
  const size = small ? 'h-3.5 w-3.5' : 'h-4 w-4'
  const icon =
    status === 'ok' ? (
      <CircleCheck className={cn(size, 'text-ok')} />
    ) : status === 'warn' ? (
      <TriangleAlert className={cn(size, 'text-warn')} />
    ) : status === 'error' ? (
      <CircleX className={cn(size, 'text-danger')} />
    ) : status === 'info' ? (
      <Info className={cn(size, 'text-ink-2')} />
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
