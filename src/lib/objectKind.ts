import { fmtTonnes } from './utils'

// What a calculation plans the deck of (spec 2026-11-06, 3): a vessel, as
// DeckLoad always did, or a platform the supply vessels serve — a
// semi-submersible drilling unit (ППБУ), a self-elevating one (СПБУ) or a
// fixed platform (МСП, МЛСП).
// A calculation saved before this existed has no kind and is a vessel.
//
// A platform has no trips (it doesn't sail with its cargo) and no lashing
// check (its motions aren't a vessel's, and DeckLoad has no standard for
// them); its cargo carries a status instead: already on board, arriving
// with the supply vessel, or leaving with it.
export type ObjectKind = 'vessel' | 'semi-sub' | 'jack-up' | 'fixed'

export const OBJECT_KINDS: readonly ObjectKind[] = ['vessel', 'semi-sub', 'jack-up', 'fixed']

export const OBJECT_KIND_LABEL: Record<ObjectKind, string> = {
  vessel: 'Судно',
  'semi-sub': 'ППБУ',
  'jack-up': 'СПБУ',
  fixed: 'Стационарная платформа',
}

// The kind as a line under its name, where the choice is made.
export const OBJECT_KIND_HINT: Record<ObjectKind, string> = {
  vessel: 'Судно снабжения, баржа, буровое судно',
  'semi-sub': 'Полупогружная буровая установка: VDL и KG по кривым руководства',
  'jack-up': 'Самоподъёмная: на плаву — VDL, KG и осадка, на опорах — VDL и нагрузки на опоры',
  fixed: 'МСП, МЛСП: площадки т/м² и допускаемая нагрузка на палубу',
}

export function objectKindOf(deck: { objectKind?: ObjectKind }): ObjectKind {
  return deck.objectKind ?? 'vessel'
}

export function isPlatform(deck: { objectKind?: ObjectKind }): boolean {
  return objectKindOf(deck) !== 'vessel'
}

export function isObjectKind(value: unknown): value is ObjectKind {
  return typeof value === 'string' && (OBJECT_KINDS as readonly string[]).includes(value)
}

// A platform's cargo: on its deck already (and in the unit's daily report),
// arriving with the supply vessel, or leaving with it. The plan is the deck
// after the supply run: what's on board and what arrives.
export type PlatformStatus = 'onboard' | 'incoming' | 'outgoing'

export const PLATFORM_STATUSES: readonly PlatformStatus[] = ['onboard', 'incoming', 'outgoing']

export const PLATFORM_STATUS_LABEL: Record<PlatformStatus, string> = {
  onboard: 'на борту',
  incoming: 'приход',
  outgoing: 'отгрузка',
}

// A cargo of the list without a status arrives: cargo is added to a plan to
// be brought.
export function platformStatusOf(item: { platformStatus?: PlatformStatus }): PlatformStatus {
  return item.platformStatus ?? 'incoming'
}

export function isPlatformStatus(value: unknown): value is PlatformStatus {
  return typeof value === 'string' && (PLATFORM_STATUSES as readonly string[]).includes(value)
}

// The cargo that stands on the platform's deck after the supply run.
export function staysOnDeck(item: { platformStatus?: PlatformStatus }): boolean {
  return platformStatusOf(item) !== 'outgoing'
}

// The cargo by status, for the line under the list's totals — what the
// supply run brings and takes first: «Приход: 12 ед., 34.5 т · Отгрузка:
// 3 ед., 8 т · На борту: 5 ед., 10 т». A status with nothing is left out.
const LINE_ORDER: readonly PlatformStatus[] = ['incoming', 'outgoing', 'onboard']

export function platformStatusLine(items: readonly { quantity: number; weight?: number; platformStatus?: PlatformStatus }[]): string {
  return LINE_ORDER.map((status) => {
    const of = items.filter((it) => platformStatusOf(it) === status)
    const units = of.reduce((n, it) => n + Math.max(0, it.quantity), 0)
    if (units === 0) return null
    const kg = of.reduce((n, it) => n + Math.max(0, it.quantity) * (it.weight && it.weight > 0 ? it.weight : 0), 0)
    const label = PLATFORM_STATUS_LABEL[status]
    return `${label[0].toUpperCase()}${label.slice(1)}: ${units} ед., ${fmtTonnes(kg)} т`
  })
    .filter(Boolean)
    .join(' · ')
}
