import { pluralRu } from './utils'

// A table pasted as text from a booklet, a spreadsheet or a PDF into one of
// the stability tables (spec 2026-10-24, 6.1). Columns go apart by tab or
// semicolon — then a comma is a decimal point, as Russian tables write it —
// or by spaces, or, failing those, by commas with a point for decimals.

export type PasteColumn = { kind: 'text' } | { kind: 'number'; optional?: boolean }

export type PasteResult = { rows: (string | number | undefined)[][] } | { error: string }

function fields(line: string): { parts: string[]; decimalComma: boolean } {
  if (line.includes('\t')) return { parts: line.split('\t'), decimalComma: true }
  if (line.includes(';')) return { parts: line.split(';'), decimalComma: true }
  const bySpace = line.trim().split(/\s+/)
  if (bySpace.length > 1) return { parts: bySpace, decimalComma: true }
  return { parts: line.split(','), decimalComma: false }
}

function toNumber(raw: string, decimalComma: boolean): number | undefined {
  const s = (decimalComma ? raw.replace(',', '.') : raw).replace(/\s/g, '')
  if (s === '' || s === '-' || s === '—') return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}

const nonEmptyLines = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

// `firstLine` numbers the lines in errors when the text read is the rest of
// a larger paste.
export function parsePastedTable(text: string, columns: PasteColumn[], firstLine = 1): PasteResult {
  const lines = nonEmptyLines(text)
  if (lines.length === 0) return { error: 'Вставьте хотя бы одну строку' }
  const required = columns.filter((c) => c.kind === 'text' || !c.optional).length
  const rows: (string | number | undefined)[][] = []
  for (const [index, line] of lines.entries()) {
    const i = index + firstLine - 1
    const { parts, decimalComma } = fields(line)
    const cells = parts.map((p) => p.trim())
    // Optional columns at the end may be left off.
    if (cells.length > columns.length || cells.length < required) {
      const expected = required === columns.length ? `${columns.length}` : `от ${required} до ${columns.length}`
      const word = pluralRu(columns.length, 'значение', 'значения', 'значений')
      return { error: `Строка ${i + 1}: ожидается ${expected} ${word}, а их ${cells.length}` }
    }
    const row: (string | number | undefined)[] = []
    for (const [j, col] of columns.entries()) {
      const cell = cells[j] ?? ''
      if (col.kind === 'text') {
        row.push(cell)
        continue
      }
      const n = toNumber(cell, decimalComma)
      if (n === undefined) {
        if (!col.optional) return { error: `Строка ${i + 1}, столбец ${j + 1}: нужно число` }
        row.push(undefined)
      } else if (Number.isNaN(n)) {
        return { error: `Строка ${i + 1}, столбец ${j + 1}: «${cell}» — не число` }
      } else row.push(n)
    }
    rows.push(row)
  }
  return { rows }
}

// KN cross curves as a booklet prints them: a line of heel angles — a label
// before them and degree signs are fine — then a line per displacement with
// its KN at each angle. Without an angle line, `currentAngles` stand.
// Displacements are read as they are typed; the caller knows the unit.
export function parseKnTable(text: string, currentAngles: number[]): { angles: number[]; rows: number[][] } | { error: string } {
  const lines = nonEmptyLines(text)
  if (lines.length === 0) return { error: 'Вставьте хотя бы одну строку' }
  const head = fields(lines[0].replace(/°/g, ''))
  const tokens = head.parts.map((p) => p.trim()).filter(Boolean)
  const numbers = tokens.map((t) => toNumber(t, head.decimalComma))
  // Where the run of numbers to the end of the line starts.
  let start = tokens.length
  while (start > 0 && numbers[start - 1] !== undefined && !Number.isNaN(numbers[start - 1])) start--
  const secondCount = lines.length > 1 ? fields(lines[1]).parts.map((p) => p.trim()).filter(Boolean).length : 0
  const isHeader = start > 0 || (lines.length > 1 && tokens.length === secondCount - 1)
  const angles = isHeader ? (numbers.slice(start) as number[]) : currentAngles
  if (angles.length === 0) return { error: 'Первая строка — углы крена, например: 0; 10; 20; 30; 40' }
  const data = isHeader ? lines.slice(1) : lines
  if (data.length === 0) return { error: 'После строки углов нужна хотя бы одна строка водоизмещения' }
  const parsed = parsePastedTable(data.join('\n'), [{ kind: 'number' }, ...angles.map(() => ({ kind: 'number' as const }))], isHeader ? 2 : 1)
  if ('error' in parsed) return parsed
  return { angles, rows: parsed.rows as number[][] }
}
