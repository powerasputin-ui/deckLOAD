// What a calculation plans the deck of (spec 2026-11-06, 3): a vessel, as
// DeckLoad always did, or a platform the supply vessels serve — a
// semi-submersible drilling unit (ППБУ) or a fixed platform (МСП, МЛСП).
// A calculation saved before this existed has no kind and is a vessel.
//
// A platform has no trips (it doesn't sail with its cargo) and no lashing
// check (its motions aren't a vessel's, and DeckLoad has no standard for
// them); its cargo carries a status instead: already on board, arriving
// with the supply vessel, or leaving with it.
export type ObjectKind = 'vessel' | 'semi-sub' | 'fixed'

export const OBJECT_KINDS: readonly ObjectKind[] = ['vessel', 'semi-sub', 'fixed']

export const OBJECT_KIND_LABEL: Record<ObjectKind, string> = {
  vessel: 'Судно',
  'semi-sub': 'ППБУ',
  fixed: 'Стационарная платформа',
}

// The kind as a line under its name, where the choice is made.
export const OBJECT_KIND_HINT: Record<ObjectKind, string> = {
  vessel: 'Судно снабжения, баржа, буровое судно',
  'semi-sub': 'Полупогружная буровая установка: VDL и KG по кривым руководства',
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
