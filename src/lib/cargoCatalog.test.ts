import { describe, expect, it } from 'vitest'
import { ownSize, searchCatalog, templateInUnit, type CatalogGroup } from './cargoCatalog'

const groups: CatalogGroup[] = [
  { key: 'containers', label: 'Контейнеры', items: [{ name: 'Контейнер 20ft' }, { name: 'Корзина 10\'' }] },
  { key: 'pipes', label: 'Трубы', items: [{ name: 'Труба Ø813×30,2 НУБП-130' }], tool: 'Конструктор штабеля' },
  { key: 'objects', label: 'Фигуры', items: [{ name: 'Круг' }, { name: 'Овал' }], tool: 'Нарисовать форму' },
]

describe('searchCatalog', () => {
  it('keeps every group for an empty query', () => {
    expect(searchCatalog(groups, '  ')).toBe(groups)
  })

  it('keeps the templates whose name holds the query, case and ё aside', () => {
    const found = searchCatalog(groups, 'КОНТЕЙНЕР')
    expect(found.map((g) => g.key)).toEqual(['containers'])
    expect(found[0].items.map((it) => it.name)).toEqual(['Контейнер 20ft'])
    expect(searchCatalog([{ key: 'x', label: 'X', items: [{ name: 'Ёмкость' }] }], 'емк')[0].items).toHaveLength(1)
  })

  it('finds a group by its tool, with no template of its own', () => {
    const found = searchCatalog(groups, 'нарисовать')
    expect(found.map((g) => g.key)).toEqual(['objects'])
    expect(found[0].items).toEqual([])
  })

  it('drops a group with nothing found', () => {
    expect(searchCatalog(groups, 'паллета')).toEqual([])
  })
})

describe('templateInUnit', () => {
  it('brings the sides from metres into the deck unit', () => {
    expect(templateInUnit({ name: 'A', width: 6.06, length: 2.44, height: 2.59, weight: 2200 }, 'cm')).toEqual({
      name: 'A',
      width: 606,
      length: 244,
      height: 259,
      weight: 2200,
    })
  })

  it('leaves a side that is not given unset', () => {
    expect(templateInUnit({ name: 'A', width: 2 }, 'm')).toEqual({ name: 'A', width: 2, length: undefined, height: undefined })
  })
})

describe('ownSize', () => {
  it('names the longest side first, then the height', () => {
    expect(ownSize({ width: 2.44, length: 6.06, height: 2.59 })).toEqual([6.06, 2.44, 2.59])
    expect(ownSize({ width: 6.06, length: 2.44 })).toEqual([6.06, 2.44])
  })
})
