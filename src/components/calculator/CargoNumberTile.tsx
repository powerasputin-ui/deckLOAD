import { CARGO_INK, cargoToneForNumber } from '@/lib/cargoPalette'
import { cn } from '@/lib/utils'

// The cargo's number on its tone — the same mark the deck draws on the stack
// (spec 6.2), so the list, the tables and the deck read as one.
export function CargoNumberTile({ number, className }: { number: number; className?: string }) {
  return (
    <span
      className={cn('inline-grid shrink-0 place-items-center rounded-md font-semibold tabular-nums', className)}
      style={{ backgroundColor: cargoToneForNumber(number), color: CARGO_INK }}
      title={`Груз № ${number}`}
    >
      {number}
    </span>
  )
}
