// The five sections of the app (spec 5.3) and the mark beside each in the
// top bar. A section is a tab and a step of the job at once: the mark hints
// that the step is done, it never locks anything.
import { toMeters, type Unit } from './units'

export type SectionId = 'vessel' | 'cargo' | 'placement' | 'checks' | 'report'

export const SECTION_ORDER: SectionId[] = ['vessel', 'cargo', 'placement', 'checks', 'report']

export const SECTION_TITLE: Record<SectionId, string> = {
  vessel: 'Судно',
  cargo: 'Грузы',
  placement: 'Размещение',
  checks: 'Проверки',
  report: 'Отчёт',
}

export type SectionMark =
  | { kind: 'none' }
  | { kind: 'done' }
  | { kind: 'errors'; count: number }
  | { kind: 'warnings'; count: number }

export interface WorkflowState {
  vesselTemplateId?: string
  deck: { width: number; length: number; unit: Unit }
  items: readonly { quantity: number }[]
  // Units on the deck, every trip counted.
  placedUnits: number
  // ✕ and ⚠ from the checks; undefined while they aren't counted.
  checks?: { errors: number; warnings: number }
  // A PDF was downloaded in this tab after the last change.
  pdfUpToDate: boolean
}

// A new calculation's deck (DEMO_DECK in the store): 8 m across, 20 m fore
// and aft.
const NEW_DECK_M = { width: 8, length: 20 }

function sameLength(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6
}

export function sectionMarks(s: WorkflowState): Record<SectionId, SectionMark> {
  const done: SectionMark = { kind: 'done' }
  const none: SectionMark = { kind: 'none' }
  const totalUnits = s.items.reduce((sum, it) => sum + Math.max(0, it.quantity), 0)
  const hasCargo = s.items.some((it) => it.quantity >= 1)
  const deckChanged =
    !sameLength(toMeters(s.deck.width, s.deck.unit), NEW_DECK_M.width) ||
    !sameLength(toMeters(s.deck.length, s.deck.unit), NEW_DECK_M.length)

  // ✕ and ⚠ show whatever the cargo (a deck-strength limit not chosen is a
  // warning before any cargo); «done» needs cargo to have been checked.
  let checks: SectionMark = none
  if (s.checks) {
    if (s.checks.errors > 0) checks = { kind: 'errors', count: s.checks.errors }
    else if (s.checks.warnings > 0) checks = { kind: 'warnings', count: s.checks.warnings }
    else if (hasCargo) checks = done
  }

  return {
    vessel: s.vesselTemplateId || deckChanged || s.placedUnits > 0 ? done : none,
    cargo: hasCargo ? done : none,
    placement: hasCargo && s.placedUnits >= totalUnits ? done : none,
    checks,
    report: s.pdfUpToDate ? done : none,
  }
}
