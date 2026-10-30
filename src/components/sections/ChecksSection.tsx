'use client'

import { ChevronDown, ChevronRight, CircleCheck, CircleX, Info, Minus, TriangleAlert } from 'lucide-react'
import { PanelBlock } from '@/components/shell/SectionPanel'
import { SeparationRulesEditor, VesselMotionPicker } from '@/components/sections/checks/CheckSettings'
import type { Check, CheckAction, CheckDetailLine, CheckDetails, CheckId, CheckStatus } from '@/lib/checks'
import { SECTION_TITLE, type SectionId } from '@/lib/workflow'
import type { VesselStepId } from '@/lib/vesselSteps'
import { cn } from '@/lib/utils'

// «Проверки» (spec 8.4): one list. A click opens a check: what it found,
// line by line, with the trip named when there are several — and the
// stacks at fault light up on the open trip's deck (the page dims the
// rest). The separation rules and the voyage's conditions are set in their
// checks; «Требуют внимания» offers what can be done about each case. A
// stack's lashing points are its inspector's.
export function ChecksSection({
  checks,
  hasCargo,
  openCheck,
  openDetails,
  onToggleCheck,
  tripIndex,
  onSelectTrip,
  onOpenSection,
  onOpenStability,
  onCheckAction,
}: {
  checks: readonly Check[]
  // Without cargo there is little to check (spec 10.3): the section says
  // so and leaves out the checks with nothing to say («—»). What a vessel
  // already has to say stays — its strength limit, its stability.
  hasCargo: boolean
  openCheck: CheckId | null
  openDetails: CheckDetails | null
  onToggleCheck: (id: CheckId) => void
  // The open trip, and opening another.
  tripIndex: number
  onSelectTrip: (index: number) => void
  onOpenSection: (id: SectionId, step?: VesselStepId) => void
  onOpenStability: () => void
  onCheckAction: (action: CheckAction) => void
}) {
  const shown = hasCargo ? checks : checks.filter((c) => c.status !== 'none')
  return (
    <>
      <PanelBlock>
        {!hasCargo && <p className="text-sm text-ink-2">Добавьте груз — здесь появятся проверки</p>}
        {shown.length > 0 && (
        <ul className="-mx-2 space-y-0.5" aria-label="Список проверок">
          {shown.map((c) => {
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
                      onAction={onCheckAction}
                    />
                    {c.id === 'separation' && <SeparationRulesEditor />}
                    {c.id === 'lashing' && (
                      <>
                        <VesselMotionPicker />
                        <p className="text-xs text-ink-2">Точки крепления штабеля — в его инспекторе: выделите штабель на палубе</p>
                      </>
                    )}
                    <TargetLink check={c} onOpenSection={onOpenSection} onOpenStability={onOpenStability} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        )}
      </PanelBlock>
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
  onAction,
}: {
  check: Check
  details: CheckDetails | null
  tripIndex: number
  onSelectTrip: (index: number) => void
  onAction: (action: CheckAction) => void
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
            {line.actions && (
              <span className="mt-1 flex flex-wrap gap-1.5">
                {line.actions.map((a) => (
                  <button
                    key={a.kind}
                    type="button"
                    onClick={() => onAction(a)}
                    aria-label={`${ACTION_LABEL[a.kind]}: ${line.text}`}
                    className="rounded border border-line px-1.5 py-0.5 text-xs text-ink hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {ACTION_LABEL[a.kind]}
                  </button>
                ))}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}

const ACTION_LABEL: Record<CheckAction['kind'], string> = {
  delete: 'Удалить',
  'keep-makeup': 'Оставить как есть',
  unpin: 'Снять закрепление',
  show: 'Показать',
}

// Where a check's settings are: another section, or the stability
// workspace. None for the checks whose settings are here.
function TargetLink({
  check,
  onOpenSection,
  onOpenStability,
}: {
  check: Check
  onOpenSection: (id: SectionId, step?: VesselStepId) => void
  onOpenStability: () => void
}) {
  const { target } = check
  if (target === 'checks') return null
  const [label, text, open] =
    target === 'stability'
      ? [`${check.title}: открыть панель остойчивости`, 'Открыть остойчивость', onOpenStability]
      : [`${check.title}: открыть раздел «${SECTION_TITLE[target]}»`, `Настроить в разделе «${SECTION_TITLE[target]}»`, () => onOpenSection(target, check.targetStep)]
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
