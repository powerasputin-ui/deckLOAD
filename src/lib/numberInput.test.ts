import { describe, it, expect } from 'vitest'
import {
  cleanNumberInput,
  formatNumberInput,
  isAllowedNumberInput,
  parseNumberInput,
  stepNumberInput,
} from './numberInput'

describe('formatNumberInput', () => {
  it('shows nothing for a missing value', () => {
    expect(formatNumberInput(undefined)).toBe('')
    expect(formatNumberInput(NaN)).toBe('')
  })

  it('strips float noise and never shows -0', () => {
    expect(formatNumberInput(0.1 + 0.2)).toBe('0.3')
    expect(formatNumberInput(-0)).toBe('0')
    expect(formatNumberInput(20)).toBe('20')
  })
})

describe('cleanNumberInput', () => {
  it('drops regular, non-breaking and narrow no-break spaces', () => {
    expect(cleanNumberInput('1 200,5')).toBe('1200,5')
    expect(cleanNumberInput('1 200')).toBe('1200')
    expect(cleanNumberInput('1 200')).toBe('1200')
  })
})

describe('isAllowedNumberInput', () => {
  it('lets half-typed values through while typing', () => {
    for (const raw of ['', '0', '0,', '0.', '.5', ',5', '12,34']) {
      expect(isAllowedNumberInput(raw, { min: 0 })).toBe(true)
    }
  })

  it('rejects letters, exponents and a second separator', () => {
    for (const raw of ['abc', '1e3', '1.2.3', '1,2,3', '1.2,3', '--1', '1-']) {
      expect(isAllowedNumberInput(raw)).toBe(false)
    }
  })

  it('only accepts a minus sign when negatives are legal', () => {
    expect(isAllowedNumberInput('-')).toBe(true)
    expect(isAllowedNumberInput('-2.5')).toBe(true)
    expect(isAllowedNumberInput('-', { min: -5 })).toBe(true)
    expect(isAllowedNumberInput('-', { min: 0 })).toBe(false)
    expect(isAllowedNumberInput('-2', { min: 0.1 })).toBe(false)
  })
})

describe('parseNumberInput', () => {
  // Audit 2026-11-01, F-UT-2: a finite number past ~1e302 overflowed to
  // Infinity in rounding, and a field without a maximum committed it.
  it('never gives an infinite value, however many digits are typed', () => {
    const big = parseNumberInput('1' + '0'.repeat(305))
    expect(big.kind).toBe('ok')
    expect(big.kind === 'ok' && Number.isFinite(big.value) && Number.isFinite(big.typed)).toBe(true)
    expect(parseNumberInput('1' + '0'.repeat(400))).toEqual({ kind: 'invalid' })
  })

  it('reads plain numbers with either decimal separator', () => {
    expect(parseNumberInput('24')).toEqual({ kind: 'ok', value: 24, typed: 24 })
    expect(parseNumberInput('0,4')).toEqual({ kind: 'ok', value: 0.4, typed: 0.4 })
    expect(parseNumberInput('0.4')).toEqual({ kind: 'ok', value: 0.4, typed: 0.4 })
    expect(parseNumberInput('5.')).toEqual({ kind: 'ok', value: 5, typed: 5 })
    expect(parseNumberInput('.5')).toEqual({ kind: 'ok', value: 0.5, typed: 0.5 })
    expect(parseNumberInput('1 200,5')).toEqual({ kind: 'ok', value: 1200.5, typed: 1200.5 })
  })

  it('reports empty and unfinished text instead of inventing a number', () => {
    expect(parseNumberInput('')).toEqual({ kind: 'empty' })
    expect(parseNumberInput('   ')).toEqual({ kind: 'empty' })
    for (const raw of ['-', '.', ',', '-.', 'abc', '1e3', '1.2.3']) {
      expect(parseNumberInput(raw)).toEqual({ kind: 'invalid' })
    }
  })

  it('clamps to the bounds and says which one it hit', () => {
    expect(parseNumberInput('0', { min: 0.1 })).toEqual({ kind: 'ok', value: 0.1, typed: 0, clamped: 'min' })
    expect(parseNumberInput('500', { max: 100 })).toEqual({ kind: 'ok', value: 100, typed: 500, clamped: 'max' })
    expect(parseNumberInput('50', { min: 0.1, max: 100 })).toEqual({ kind: 'ok', value: 50, typed: 50 })
    // exactly on a bound is not "clamped"
    expect(parseNumberInput('100', { max: 100 })).toEqual({ kind: 'ok', value: 100, typed: 100 })
  })

  it('rounds integer fields on commit but still accepts a separator while typing', () => {
    expect(parseNumberInput('2.4', { integer: true })).toEqual({ kind: 'ok', value: 2, typed: 2 })
    expect(parseNumberInput('2,6', { integer: true })).toEqual({ kind: 'ok', value: 3, typed: 3 })
    expect(parseNumberInput('0', { integer: true, min: 1 })).toEqual({ kind: 'ok', value: 1, typed: 0, clamped: 'min' })
  })

  it('keeps negatives when the bounds allow them', () => {
    expect(parseNumberInput('-1,5')).toEqual({ kind: 'ok', value: -1.5, typed: -1.5 })
    expect(parseNumberInput('-1,5', { min: 0 })).toEqual({ kind: 'ok', value: 0, typed: -1.5, clamped: 'min' })
  })
})

describe('stepNumberInput', () => {
  it('steps without float noise', () => {
    expect(stepNumberInput(0.1, 1, 0.2)).toBe(0.3)
    expect(stepNumberInput(0.3, -1, 0.1)).toBe(0.2)
  })

  it('stays inside the bounds', () => {
    expect(stepNumberInput(0.1, -1, 0.1, { min: 0.1 })).toBe(0.1)
    expect(stepNumberInput(99.95, 1, 0.1, { max: 100 })).toBe(100)
  })

  it('keeps integer fields whole', () => {
    expect(stepNumberInput(4, 1, 1, { integer: true })).toBe(5)
    expect(stepNumberInput(1, -1, 1, { integer: true, min: 1 })).toBe(1)
  })
})
