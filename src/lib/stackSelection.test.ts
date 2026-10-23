import { describe, it, expect } from 'vitest'
import { isStackSelected } from './stackSelection'

describe('isStackSelected', () => {
  const selection = { pinIds: ['pin-1'], manualIds: ['m-1'], autoKeys: ['item@1.000,2.000'] }

  it('finds a manual stack by its id, in manual mode only', () => {
    expect(isStackSelected({ placementId: 'm-1' }, 'manual', selection)).toBe(true)
    expect(isStackSelected({ placementId: 'm-2' }, 'manual', selection)).toBe(false)
    expect(isStackSelected({ placementId: 'm-1' }, 'auto', selection)).toBe(false)
  })

  it('finds a pinned stack by its pin, and a stack the packer placed by its key', () => {
    expect(isStackSelected({ placementId: 'pin-1' }, 'auto', selection)).toBe(true)
    expect(isStackSelected({ autoKey: 'item@1.000,2.000' }, 'auto', selection)).toBe(true)
    expect(isStackSelected({ autoKey: 'item@1.000,3.000' }, 'auto', selection)).toBe(false)
    // A pinned stack is not selected through a stale key of where it stood.
    expect(isStackSelected({ placementId: 'pin-2', autoKey: 'item@1.000,2.000' }, 'auto', selection)).toBe(false)
  })
})
