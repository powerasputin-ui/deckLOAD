// «Судно» as steps (spec 8.1, revision 2026-10-30): each block folds to its
// title and one line of what it holds, so the section reads as an order of
// things to fill in — the vessel, its deck, its limits, the load zones, its
// stability — with what's optional below. A folded block still says when
// something in it needs looking at; that block, or the first step of a new
// calculation, is the one open on entering the section.
import type { CheckStatus } from './checks'
import { NO_DECK_HEIGHT, STATE_LABEL } from './stabilityConditions'
import { fmtNumber, pluralRu } from './utils'
import { deckWords } from './deckDrawing'
import { OBJECT_KIND_LABEL, type ObjectKind } from './objectKind'
import type { SemiSubData, SemiSubResult } from './semiSub'

export type VesselStepId =
  | 'library'
  | 'deck'
  | 'card'
  | 'zones'
  | 'stability'
  | 'obstacles'
  | 'photo'
  | 'sockets'
  | 'lashing'
  | 'marks'
  // A semi-submersible's (spec 2026-11-06, 7.1).
  | 'semi-data'
  | 'semi-report'
  | 'semi-transfers'

// The steps in the order they are filled in; the rest are optional.
export const REQUIRED_STEPS: readonly VesselStepId[] = ['library', 'deck', 'card', 'zones', 'stability']
export const OPTIONAL_STEPS: readonly VesselStepId[] = ['obstacles', 'photo', 'sockets', 'lashing', 'marks']

// A platform's (spec 2026-11-06, 5): its card first — what it is and what it
// is called — then its deck and zones; the library keeps it for the next
// calculation. No vessel stability, no lashing points.
export const PLATFORM_REQUIRED_STEPS: readonly VesselStepId[] = ['card', 'deck', 'zones', 'library']
export const PLATFORM_OPTIONAL_STEPS: readonly VesselStepId[] = ['obstacles', 'photo', 'sockets', 'marks']

// A semi-submersible's: its manual's data and the day's report after the
// deck (spec 2026-11-06, 7.1); the run's other transfers are optional.
export const SEMI_SUB_REQUIRED_STEPS: readonly VesselStepId[] = ['card', 'deck', 'zones', 'semi-data', 'semi-report', 'library']

export function requiredSteps(kind: ObjectKind = 'vessel'): readonly VesselStepId[] {
  return kind === 'vessel' ? REQUIRED_STEPS : kind === 'semi-sub' ? SEMI_SUB_REQUIRED_STEPS : PLATFORM_REQUIRED_STEPS
}

export interface VesselStep {
  // One line for the folded header.
  summary: string
  // Unset — nothing to say either way.
  status?: 'ok' | 'warn' | 'error'
}

export interface VesselStepsInput {
  // What the deck is of; unset — a vessel.
  kind?: ObjectKind
  // A platform's name, as its card gives it.
  platformName?: string
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
  // A semi-submersible's data and what it gives (semiSub.ts).
  semiSub?: { data?: SemiSubData; result?: SemiSubResult }
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
  const kind = s.kind ?? 'vessel'
  const platform = kind !== 'vessel'
  const name = s.platformName ?? s.vesselLabel
  const card: VesselStep = platform
    ? {
        summary: [
          name ? `${OBJECT_KIND_LABEL[kind]} «${name}»` : OBJECT_KIND_LABEL[kind],
          d.maxDeckCargoT !== undefined ? `до ${fmtNumber(d.maxDeckCargoT)} т` : 'нагрузка не ограничена',
        ].join(' · '),
        status: fromCheck(s.checks.deckWeight) ?? (name ? 'ok' : undefined),
      }
    : {
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
    library: platform
      ? { summary: s.vesselLabel ? `из библиотеки: ${s.vesselLabel}` : 'не сохранена в библиотеку' }
      : { summary: s.vesselLabel ?? 'Своя палуба', status: s.fresh ? undefined : 'ok' },
    deck: {
      summary: `${fmtNumber(d.width)} × ${fmtNumber(d.length)} ${d.unitLabel} · ${deckWords(kind).bow} ${d.bow}`,
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
    ...semiSubSteps(s.semiSub),
  }
}

// A semi-submersible's steps in a line each: what its manual gives, the
// day's report and how it holds, the run's other transfers.
function semiSubSteps(semi: VesselStepsInput['semiSub']): Pick<Record<VesselStepId, VesselStep>, 'semi-data' | 'semi-report' | 'semi-transfers'> {
  const data = semi?.data
  const op = data?.operating
  const rows = (op?.kgLimit?.length ?? 0) + (data?.survival.kgLimit?.length ?? 0)
  const r = data?.report
  const checks = semi?.result?.checks ?? []
  const worst = checks.some((c) => c.status === 'error') ? 'error' : checks.length > 0 && checks.every((c) => c.status === 'ok') ? 'ok' : undefined
  const transfers = data?.transfers.length ?? 0
  return {
    'semi-data': {
      summary:
        op?.vdlMaxT !== undefined || rows > 0
          ? [op?.draftM !== undefined && `в работе ${fmtNumber(op.draftM)} м`, op?.vdlMaxT !== undefined && `VDL ${fmtNumber(op.vdlMaxT)} т`, `KG: ${rows} ${pluralRu(rows, 'строка', 'строки', 'строк')}`]
              .filter(Boolean)
              .join(' · ')
          : 'не заданы',
    },
    'semi-report': {
      summary:
        r && (r.vdlT !== undefined || r.kgM !== undefined)
          ? [r.date && `от ${r.date.split('-').reverse().join('.')}`, r.vdlT !== undefined && `VDL ${fmtNumber(r.vdlT)} т`, r.kgM !== undefined && `KG ${r.kgM.toFixed(2)} м`]
              .filter(Boolean)
              .join(' · ')
          : 'не внесён',
      status: worst,
    },
    'semi-transfers': { summary: transfers === 0 ? 'нет' : `${transfers} ${pluralRu(transfers, 'строка', 'строки', 'строк')}` },
  }
}

// The step open on entering the section: the first step with a problem,
// else the first step of a calculation nothing is chosen for yet, else none
// — every block folded to its line.
export function firstOpenStep(steps: Record<VesselStepId, VesselStep>, fresh: boolean, kind: ObjectKind = 'vessel'): VesselStepId | undefined {
  const required = requiredSteps(kind)
  const problem = required.find((id) => steps[id].status === 'error' || steps[id].status === 'warn')
  return problem ?? (fresh ? required[0] : undefined)
}
