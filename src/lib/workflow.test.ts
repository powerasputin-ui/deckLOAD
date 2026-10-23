import { describe, it, expect } from 'vitest'
import { sectionMarks, type WorkflowState } from './workflow'

const base: WorkflowState = {
  deck: { width: 8, length: 20, unit: 'm' },
  items: [],
  placedUnits: 0,
  pdfUpToDate: false,
}

describe('section marks', () => {
  it('a new, empty calculation has no marks', () => {
    expect(sectionMarks(base)).toEqual({
      vessel: { kind: 'none' },
      cargo: { kind: 'none' },
      placement: { kind: 'none' },
      checks: { kind: 'none' },
      report: { kind: 'none' },
    })
  })

  it('«Судно» is done for a library vessel, a changed deck or cargo already on the deck', () => {
    expect(sectionMarks({ ...base, vesselTemplateId: 'aleksey-kuznetsov' }).vessel.kind).toBe('done')
    expect(sectionMarks({ ...base, deck: { width: 8, length: 24, unit: 'm' } }).vessel.kind).toBe('done')
    expect(sectionMarks({ ...base, items: [{ quantity: 1 }], placedUnits: 1 }).vessel.kind).toBe('done')
  })

  it('the same 8×20 m deck in centimetres is not a change', () => {
    expect(sectionMarks({ ...base, deck: { width: 800, length: 2000, unit: 'cm' } }).vessel.kind).toBe('none')
  })

  it('«Грузы» is done once a cargo has a quantity of 1 or more', () => {
    expect(sectionMarks({ ...base, items: [{ quantity: 0 }] }).cargo.kind).toBe('none')
    expect(sectionMarks({ ...base, items: [{ quantity: 0 }, { quantity: 2 }] }).cargo.kind).toBe('done')
  })

  it('«Размещение» is done when every unit is placed in some trip', () => {
    const items = [{ quantity: 3 }, { quantity: 2 }]
    expect(sectionMarks({ ...base, items, placedUnits: 4 }).placement.kind).toBe('none')
    expect(sectionMarks({ ...base, items, placedUnits: 5 }).placement.kind).toBe('done')
  })

  it('«Проверки» shows ✕ before ⚠, and a tick only with cargo and nothing to fix', () => {
    const items = [{ quantity: 1 }]
    expect(sectionMarks({ ...base, items, checks: { errors: 1, warnings: 2 } }).checks).toEqual({ kind: 'errors', count: 1 })
    expect(sectionMarks({ ...base, items, checks: { errors: 0, warnings: 2 } }).checks).toEqual({ kind: 'warnings', count: 2 })
    expect(sectionMarks({ ...base, items, checks: { errors: 0, warnings: 0 } }).checks.kind).toBe('done')
    expect(sectionMarks({ ...base, checks: { errors: 0, warnings: 0 } }).checks.kind).toBe('none')
  })

  it('«Проверки» shows ✕ and ⚠ without cargo too, as the status line does', () => {
    expect(sectionMarks({ ...base, checks: { errors: 0, warnings: 1 } }).checks).toEqual({ kind: 'warnings', count: 1 })
  })

  it('«Проверки» has no mark while the checks aren’t counted', () => {
    expect(sectionMarks({ ...base, items: [{ quantity: 1 }] }).checks.kind).toBe('none')
  })

  it('«Отчёт» is done while the downloaded PDF is up to date', () => {
    expect(sectionMarks({ ...base, pdfUpToDate: true }).report.kind).toBe('done')
  })
})
