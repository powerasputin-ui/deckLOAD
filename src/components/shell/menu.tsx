import { cn } from '@/lib/utils'

// A menu's popover closes without the fade-out (the opening fade stays). An
// item that opens a dialog would otherwise mount it while the popover is
// still fading: Radix ranks the layers as they mount, the dialog doesn't
// count as the top one until the popover is gone, and Esc pressed in that
// moment is lost.
export const MENU_CLOSES_AT_ONCE = 'data-[state=closed]:animate-none!'

export function MenuItem({
  icon,
  children,
  onSelect,
  destructive,
  disabled,
  hint,
}: {
  icon?: React.ReactNode
  children: React.ReactNode
  onSelect: () => void
  destructive?: boolean
  disabled?: boolean
  hint?: string
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm',
        'hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
        destructive && 'text-danger'
      )}
    >
      {icon && <span className={cn('shrink-0 [&_svg]:h-4 [&_svg]:w-4', !destructive && 'text-ink-2')}>{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
      {hint && (
        <span aria-hidden="true" className="shrink-0 text-xs text-ink-2">
          {hint}
        </span>
      )}
    </button>
  )
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-line" />
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <p className="px-2 pb-1 pt-1.5 text-xs font-medium text-ink-2">{children}</p>
}
