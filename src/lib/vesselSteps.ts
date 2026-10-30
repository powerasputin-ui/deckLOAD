// «Судно» as steps (spec 8.1, revision 2026-10-30): each block folds to its
// title and one line of what it holds, so the section reads as an order of
// things to fill in — the vessel, its deck, its limits, the load zones, its
// stability — with what's optional below. A folded block still says when
// something in it needs looking at; that block, or the first step of a new
// calculation, is the one open on entering the section.
import type { CheckStatus } from './checks'
import { NO_DECK_HEIGHT, STATE_LABEL } from './stabilityConditions'
import { fmtNumber, pluralRu } from './utils'

export type VesselStepId = 'library' | 'deck' | 'card' | 'zones' | 'stability' | 'obstacles' | 'photo' | 'sockets' | 'lashing' | 'marks'

// The steps in the order they are filled in; the rest are optional.
export const REQUIRED_STEPS: readonly VesselStepId[] = ['library', 'deck', 'card', 'zones', 'stability']
export const OPTIONAL_STEPS: readonly VesselStepId[] = ['obstacles', 'photo', 'sockets', 'lashing', 'marks']

export interface VesselStep {
  // One line for the folded header.
  summary: string
  // Unset — nothing to say either way.
  status?: 'ok' | 'warn' | 'error'
}

export interface VesselStepsInput {
  // The library vessel applied; unset for the user's own deck.
  vesselLabel?: string
  // Nothing is chosen for the vessel yet: no library vessel, the new
  // calculation's deck, nothing placed (workflow.ts).
  fresh: boolean
  deck: {
    width: number
    length: number
    unitLabel: string
    // The drawing's edge the bow is at, in words («справа»).
    bow: string
    // The library vessel's data doesn't say which end is the bow.
    bowAssumed: boolean
    maxDeckCargoT?: number
    // The library vessel's deck strength: the value chosen, or pending
    // while its sources disagree and none is.
    strength?: { chosenTPerM2?: number; pending: boolean }
    zones: number
    obstacles: number
    photo: boolean
    sockets: number
    // Lashing points on the deck tied to no stack.
    lashingPoints: number
    marks: number
  }
  checks: { deckWeight?: CheckStatus; zones?: CheckStatus }
  stability: {
    gm?: { valueM: number; status: 'ok' | 'warn' | 'error'; estimated: boolean; state: 'departure' | 'arrival' }
    // Why it isn't worked out though the vessel's data is there.
    missing?: string
    hasVessel: boolean
  }
}

const count = (n: number, one: string, few: string, many: string) => (n === 0 ? 'нет' : `${n} ${pluralRu(n, one, few, many)}`)
// A check's ✕ and ⚠ carry over; its ✓ and «—» say nothing a summary doesn't.
const fromCheck = (status: CheckStatus | undefined) => (status === 'error' || status === 'warn' ? status : undefined)

export function vesselSteps(s: VesselStepsInput): Record<VesselStepId, VesselStep> {
  const d = s.deck
  const strength = d.strength
  const card: VesselStep = {
    summary: [
      d.maxDeckCargoT !== undefined ? `до ${fmtNumber(d.maxDeckCargoT)} т` : 'вес груза не ограничен',
      strength?.pending ? 'прочность палубы не выбрана' : strength?.chosenTPerM2 !== undefined && `${fmtNumber(strength.chosenTPerM2)} т/м²`,
    ]
      .filter(Boolean)
      .join(' · '),
    status:
      s.checks.deckWeight === 'error'
        ? 'error'
        : strength?.pending
          ? 'warn'
          : (fromCheck(s.checks.deckWeight) ?? (d.maxDeckCargoT !== undefined ? 'ok' : undefined)),
  }
  const gm = s.stability.gm
  const stability: VesselStep = gm
    ? {
        summary: `GM ${gm.estimated ? '≈' : ''}${gm.valueM.toFixed(2)} м (${STATE_LABEL[gm.state].toLowerCase()})`,
        status: gm.status,
      }
    : s.stability.missing === NO_DECK_HEIGHT
      ? { summary: 'не задана высота палубы над килем', status: 'warn' }
      : { summary: s.stability.hasVessel ? 'нет гидростатики судна' : 'нет данных судна' }
  return {
    // A calculation under way has its vessel and deck, if only its own.
    library: { summary: s.vesselLabel ?? 'Своя палуба', status: s.fresh ? undefined : 'ok' },
    deck: {
      summary: `${fmtNumber(d.width)} × ${fmtNumber(d.length)} ${d.unitLabel} · нос ${d.bow}`,
      status: d.bowAssumed ? 'warn' : s.fresh ? undefined : 'ok',
    },
    card,
    zones: {
      summary: count(d.zones, 'зона', 'зоны', 'зон'),
      // The deck strength left to choose is the card's to say.
      status: strength?.pending ? undefined : (fromCheck(s.checks.zones) ?? (d.zones > 0 ? 'ok' : undefined)),
    },
    stability,
    obstacles: { summary: count(d.obstacles, 'препятствие', 'препятствия', 'препятствий') },
    photo: { summary: d.photo ? 'загружено' : 'нет' },
    sockets: { summary: count(d.sockets, 'розетка', 'розетки', 'розеток') },
    lashing: { summary: count(d.lashingPoints, 'точка', 'точки', 'точек') },
    marks: { summary: count(d.marks, 'метка', 'метки', 'меток') },
  }
}

// The step open on entering the section: the first step with a problem,
// else the first step of a calculation nothing is chosen for yet, else none
// — every block folded to its line.
export function firstOpenStep(steps: Record<VesselStepId, VesselStep>, fresh: boolean): VesselStepId | undefined {
  const problem = REQUIRED_STEPS.find((id) => steps[id].status === 'error' || steps[id].status === 'warn')
  return problem ?? (fresh ? 'library' : undefined)
}
