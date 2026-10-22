// Cargo tones (spec 9.2): ten light tones, none in the orange band the accent
// uses. A cargo's tone follows its number — its place in the cargo list, the
// same number shown on the deck, in the list, in the tables and in the PDF —
// so cargo 11 takes tone 1 again. The `color` saved with each cargo stays in
// the file for compatibility but is no longer drawn.
//
// The number is the main way to tell cargo apart; the tone helps. Under any
// colour vision adjacent numbers differ clearly, and every tone keeps the
// dark number ink above 7:1 — cargoPalette.test.ts pins both down.
export const CARGO_TONES = [
  '#B0E0F8', // небесный
  '#FDDB7C', // песочный
  '#90CACD', // морская волна
  '#AFC798', // оливковый
  '#D5ADDE', // сиреневый
  '#A3F5B4', // мятный
  '#C3B0FD', // лавандовый
  '#5CDDC4', // бирюзовый
  '#B4CBF9', // васильковый
  '#F99FB8', // розовый
] as const

// Numbers and outlines on cargo, in both themes (the tones are light in both).
export const CARGO_INK = '#10243A'

export function cargoToneForNumber(n: number): string {
  const i = Math.trunc(n) - 1
  return CARGO_TONES[((i % CARGO_TONES.length) + CARGO_TONES.length) % CARGO_TONES.length]
}

// Cargo id → number (1-based place in the list).
export function cargoNumbers(items: readonly { id: string }[]): Map<string, number> {
  return new Map(items.map((it, i) => [it.id, i + 1]))
}

// Rows in cargo-list order, the way the list numbers them; a stack of cargo
// no longer in the list sorts last.
export function sortByCargoNumber<T extends { itemId: string }>(rows: readonly T[], numbers: Map<string, number>): T[] {
  const rank = (row: T) => numbers.get(row.itemId) ?? Number.MAX_SAFE_INTEGER
  return [...rows].sort((a, b) => rank(a) - rank(b))
}
