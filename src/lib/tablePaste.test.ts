import { describe, it, expect } from 'vitest'
import { parseKnTable, parsePastedTable, type PasteColumn } from './tablePaste'

const two: PasteColumn[] = [{ kind: 'number' }, { kind: 'number' }]

describe('parsePastedTable', () => {
  it('reads tab- and semicolon-separated rows with a decimal comma, as copied from a spreadsheet', () => {
    expect(parsePastedTable('5,0\t1,20\n6,0\t1,35', two)).toEqual({ rows: [[5, 1.2], [6, 1.35]] })
    expect(parsePastedTable('5,0; 1,20\n6;1,35', two)).toEqual({ rows: [[5, 1.2], [6, 1.35]] })
  })

  it('reads space-separated rows, and comma-separated ones with a decimal point', () => {
    expect(parsePastedTable('5.0   1.20\n  6 1,35 ', two)).toEqual({ rows: [[5, 1.2], [6, 1.35]] })
    expect(parsePastedTable('5.0,1.20\n6,1.35', two)).toEqual({ rows: [[5, 1.2], [6, 1.35]] })
  })

  it('takes a text column and lets optional ones at the end be left off', () => {
    const tanks: PasteColumn[] = [{ kind: 'text' }, { kind: 'number' }, { kind: 'number' }, { kind: 'number', optional: true }]
    expect(parsePastedTable('Fuel;99,2;4,68;175,8\nBallast;177,2;0,93', tanks)).toEqual({
      rows: [
        ['Fuel', 99.2, 4.68, 175.8],
        ['Ballast', 177.2, 0.93, undefined],
      ],
    })
    expect(parsePastedTable('Stores;30;9,4;—', tanks)).toEqual({ rows: [['Stores', 30, 9.4, undefined]] })
  })

  it('names the line and column it can\'t read', () => {
    expect(parsePastedTable('5;1,2;7', two)).toEqual({ error: 'Строка 1: ожидается 2 значения, а их 3' })
    expect(parsePastedTable('5;1,2\n6;x', two)).toEqual({ error: 'Строка 2, столбец 2: «x» — не число' })
    expect(parsePastedTable('5;', two)).toEqual({ error: 'Строка 1, столбец 2: нужно число' })
    expect(parsePastedTable('  \n ', two)).toEqual({ error: 'Вставьте хотя бы одну строку' })
  })
})

describe('parseKnTable', () => {
  it('takes the angles from a first line one value short, or labelled, or with degree signs', () => {
    const rows = [[2000, 0, 1.2, 2.3], [3000, 0, 1.1, 2.1]]
    expect(parseKnTable('0;10;20\n2000;0;1,2;2,3\n3000;0;1,1;2,1', [])).toEqual({ angles: [0, 10, 20], rows })
    expect(parseKnTable('Δ, т\t0°\t10°\t20°\n2000\t0\t1,2\t2,3\n3000\t0\t1,1\t2,1', [])).toEqual({ angles: [0, 10, 20], rows })
    expect(parseKnTable('D, t 0 10 20\n2000 0 1.2 2.3\n3000 0 1.1 2.1', [])).toEqual({ angles: [0, 10, 20], rows })
  })

  it('keeps the current angles for rows alone, and numbers lines as pasted', () => {
    expect(parseKnTable('2000;0;1,2;2,3', [0, 10, 20])).toEqual({ angles: [0, 10, 20], rows: [[2000, 0, 1.2, 2.3]] })
    expect(parseKnTable('2000;0;1,2;2,3', [])).toEqual({ error: 'Первая строка — углы крена, например: 0; 10; 20; 30; 40' })
    expect(parseKnTable('0;10;20\n2000;0;1,2;2,3\n3000;0;x;2,1', [])).toEqual({ error: 'Строка 3, столбец 3: «x» — не число' })
    expect(parseKnTable('Δ 0 10 20', [])).toEqual({ error: 'После строки углов нужна хотя бы одна строка водоизмещения' })
  })
})
