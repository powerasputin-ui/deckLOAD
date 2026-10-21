import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NumberField, type NumberFieldProps } from './NumberField'

// Parent stand-in: keeps the committed value in state like the real store
// does, and records every commit so tests can assert what reached it.
function Harness({
  initial,
  commits,
  ...rest
}: { initial: number | undefined; commits: Array<number | undefined> } & Partial<NumberFieldProps>) {
  const [value, setValue] = useState<number | undefined>(initial)
  return (
    <NumberField
      aria-label="поле"
      {...rest}
      value={value}
      onCommit={(v) => {
        commits.push(v)
        setValue(v)
      }}
      onClear={
        rest.onClear
          ? () => {
              rest.onClear?.()
              commits.push(undefined)
              setValue(undefined)
            }
          : undefined
      }
    />
  )
}

const field = () => screen.getByLabelText('поле') as HTMLInputElement

describe('NumberField', () => {
  it('shows the stored value, without float noise', () => {
    render(<Harness initial={0.1 + 0.2} commits={[]} />)
    expect(field().value).toBe('0.3')
  })

  it('shows an empty box for a missing optional value', () => {
    render(<Harness initial={undefined} commits={[]} placeholder="авто" />)
    expect(field().value).toBe('')
    expect(field().placeholder).toBe('авто')
  })

  it('does not touch the store while typing — only the finished number is committed', async () => {
    const user = userEvent.setup()
    const commits: Array<number | undefined> = []
    render(<Harness initial={20} commits={commits} min={0.1} />)

    await user.clear(field())
    await user.type(field(), '24')
    // Mid-edit: the draft is on screen, nothing has been committed (the old
    // field snapped "20" → "" → 0.1 → "0.124" and pushed each step).
    expect(field().value).toBe('24')
    expect(commits).toEqual([])

    await user.tab()
    expect(commits).toEqual([24])
    expect(field().value).toBe('24')
  })

  it('Backspace on "20" no longer collapses the field to the minimum', async () => {
    const user = userEvent.setup()
    const commits: Array<number | undefined> = []
    render(<Harness initial={20} commits={commits} min={0.1} />)

    await user.type(field(), '{Backspace}{Backspace}')
    expect(field().value).toBe('')

    // Left empty and abandoned: the field restores the stored value.
    await user.tab()
    expect(commits).toEqual([])
    expect(field().value).toBe('20')
  })

  it('accepts a comma as the decimal separator', async () => {
    const user = userEvent.setup()
    const commits: Array<number | undefined> = []
    render(<Harness initial={1} commits={commits} min={0} />)

    await user.clear(field())
    await user.type(field(), '0,4')
    expect(field().value).toBe('0,4')
    await user.tab()
    expect(commits).toEqual([0.4])
    expect(field().value).toBe('0.4')
  })

  it('ignores characters that cannot be part of a number', async () => {
    const user = userEvent.setup()
    render(<Harness initial={5} commits={[]} min={0} />)

    await user.clear(field())
    await user.type(field(), '1a2e3-4')
    expect(field().value).toBe('1234')
  })

  it('only allows a minus sign when negatives are legal', async () => {
    const user = userEvent.setup()
    const commits: Array<number | undefined> = []
    const { unmount } = render(<Harness initial={5} commits={commits} min={0} />)
    await user.clear(field())
    await user.type(field(), '-3')
    expect(field().value).toBe('3')
    await user.tab()
    expect(commits).toEqual([3])
    unmount()

    render(<Harness initial={5} commits={commits} />)
    await user.clear(field())
    await user.type(field(), '-3')
    expect(field().value).toBe('-3')
    await user.tab()
    expect(commits).toEqual([3, -3])
  })

  it('pulls a too-small value back to min on commit and reports it', async () => {
    const user = userEvent.setup()
    const commits: Array<number | undefined> = []
    const onClamp = vi.fn()
    render(<Harness initial={5} commits={commits} min={0.1} onClamp={onClamp} />)

    await user.clear(field())
    await user.type(field(), '0')
    expect(commits).toEqual([])
    await user.tab()

    expect(commits).toEqual([0.1])
    expect(field().value).toBe('0.1')
    expect(onClamp).toHaveBeenCalledWith({ bound: 'min', limit: 0.1, typed: 0 })
  })

  it('pulls a too-large value back to max on commit and reports it', async () => {
    const user = userEvent.setup()
    const commits: Array<number | undefined> = []
    const onClamp = vi.fn()
    render(<Harness initial={20} commits={commits} min={0.1} max={100} onClamp={onClamp} />)

    await user.clear(field())
    await user.type(field(), '250')
    await user.tab()

    expect(commits).toEqual([100])
    expect(onClamp).toHaveBeenCalledWith({ bound: 'max', limit: 100, typed: 250 })
  })

  it('commits on Enter and keeps the result on screen', async () => {
    const user = userEvent.setup()
    const commits: Array<number | undefined> = []
    render(<Harness initial={1} commits={commits} />)

    await user.clear(field())
    await user.type(field(), '7.5{Enter}')
    expect(commits).toEqual([7.5])
    expect(field().value).toBe('7.5')
  })

  it('Escape throws the draft away', async () => {
    const user = userEvent.setup()
    const commits: Array<number | undefined> = []
    render(<Harness initial={20} commits={commits} />)

    await user.clear(field())
    await user.type(field(), '99{Escape}')
    expect(field().value).toBe('20')
    await user.tab()
    expect(commits).toEqual([])
  })

  it('does not commit when the text equals the stored value', async () => {
    const user = userEvent.setup()
    const commits: Array<number | undefined> = []
    render(<Harness initial={20} commits={commits} />)

    await user.clear(field())
    await user.type(field(), '20,0')
    await user.tab()
    expect(commits).toEqual([])
  })

  it('steps with the arrow keys and commits each step immediately', async () => {
    const user = userEvent.setup()
    const commits: Array<number | undefined> = []
    render(<Harness initial={0.1} commits={commits} min={0.1} step={0.2} />)

    await user.click(field())
    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(commits).toEqual([0.3, 0.5])
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')
    // 0.5 → 0.3 → 0.1 → stays on the min (no redundant commit)
    expect(commits).toEqual([0.3, 0.5, 0.3, 0.1])
    expect(field().value).toBe('0.1')
  })

  it('rounds integer fields on commit', async () => {
    const user = userEvent.setup()
    const commits: Array<number | undefined> = []
    render(<Harness initial={4} commits={commits} integer min={1} />)

    expect(field().inputMode).toBe('numeric')
    await user.clear(field())
    await user.type(field(), '2,6')
    await user.tab()
    expect(commits).toEqual([3])
  })

  it('an optional field clears instead of reverting', async () => {
    const user = userEvent.setup()
    const commits: Array<number | undefined> = []
    const onClear = vi.fn()
    render(<Harness initial={1.5} commits={commits} onClear={onClear} />)

    await user.clear(field())
    await user.tab()
    expect(onClear).toHaveBeenCalledTimes(1)
    expect(commits).toEqual([undefined])
    expect(field().value).toBe('')
  })

  it('shows a value that changed from outside while not editing (undo/redo, reflow)', () => {
    const { rerender } = render(<NumberField aria-label="поле" value={5} onCommit={() => {}} />)
    expect(field().value).toBe('5')
    rerender(<NumberField aria-label="поле" value={8} onCommit={() => {}} />)
    expect(field().value).toBe('8')
  })
})
