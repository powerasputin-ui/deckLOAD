// A stack's balance of forces (securing.ts, planFacts' stackSecuring) in
// words: the deck point's tip, the inspector's lines.
import type { Accelerations, Balance, PushDirection } from './securing'
import { CSS_G } from './securing'
import type { StackSecuring } from './planFacts'
import { fmtNumber } from './utils'

// Where a push sends the stack: deck x runs from port to starboard, the bow
// is at +y or −y.
export function pushWords(toward: PushDirection, forwardIsPositiveY = true): string {
  if (toward === '+x') return 'к правому борту'
  if (toward === '-x') return 'к левому борту'
  return (toward === '+y') === forwardIsPositiveY ? 'к носу' : 'к корме'
}

// «Сдвиг к правому борту: держит 119 из 331 кН».
export function balanceLine(b: Balance, forwardIsPositiveY = true): string {
  const what = b.kind === 'sliding' ? 'Сдвиг' : 'Опрокидывание'
  const unit = b.kind === 'sliding' ? 'кН' : 'кН·м'
  return `${what} ${pushWords(b.toward, forwardIsPositiveY)}: держит ${fmtNumber(Math.round(b.capacity))} из ${fmtNumber(Math.round(b.demand))} ${unit}`
}

// «поперёк 0.92 g, вдоль 0.42 g, вертикально 0.61 g».
export function accelerationsLine(a: Accelerations): string {
  const g = (v: number) => fmtNumber(Math.round((v / CSS_G) * 100) / 100)
  return `поперёк ${g(a.ay)} g, вдоль ${g(a.ax)} g, вертикально ${g(a.az)} g`
}

export function securingTitle(s: StackSecuring, forwardIsPositiveY = true): string {
  if (s.status === 'none') return ''
  if (s.status === 'unchecked') return `Силы крепления не проверены: ${s.reason}`
  const head = s.result.ok ? 'Крепление держит' : 'Крепление НЕ держит'
  const method = s.source === 'css' ? 'CSS Code, прил. 13' : 'свои ускорения'
  return `${head} (${method}; ${accelerationsLine(s.accelerations)}; ветер и заливание по 1 кН/м²) — наименьший запас: ${balanceLine(s.result.worst, forwardIsPositiveY).toLowerCase()}`
}
