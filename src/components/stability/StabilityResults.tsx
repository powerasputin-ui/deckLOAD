'use client'

import { useId, useState } from 'react'
import { AlertTriangle, Check, CircleCheck, CircleX, TriangleAlert, X } from 'lucide-react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { GzChart } from '@/components/stability/GzChart'
import { G_METACENTRIC_MIN_SAFE, type LoadingState } from '@/lib/stability'
import {
  gmMargin,
  knReference,
  NOT_CHECKED,
  STABILITY_DISCLAIMER,
  STATE_LABEL,
  type StabilityVerdict,
  type StateStability,
  type TripStabilityResult,
} from '@/lib/stabilityConditions'
import { cn, fmtNumber, fmtTonnes } from '@/lib/utils'

const m2 = (v: number) => v.toFixed(2)
const tonnes = (kg: number) => String(Math.round(kg / 1000))

export const VERDICT_WORD: Record<StabilityVerdict, string> = {
  ok: 'Выполнено по формуляру',
  warn: 'Нужна проверка',
  error: 'Не выполнено',
}

export function VerdictIcon({ verdict, className }: { verdict: StabilityVerdict; className?: string }) {
  const cls = cn('h-4 w-4 shrink-0', className)
  return verdict === 'ok' ? (
    <CircleCheck className={cn(cls, 'text-ok')} aria-hidden="true" />
  ) : verdict === 'warn' ? (
    <TriangleAlert className={cn(cls, 'text-warn')} aria-hidden="true" />
  ) : (
    <CircleX className={cn(cls, 'text-danger')} aria-hidden="true" />
  )
}

// The right column of the stability workspace (spec 2026-10-24, 6.1): the
// open trip at departure and at arrival, each judged against the booklet.
export function StabilityResults({ evaluation, hasVessel }: { evaluation: TripStabilityResult | undefined; hasVessel: boolean }) {
  const [chosen, setChosen] = useState<LoadingState | null>(null)
  const labelId = useId()

  return (
    <div className="space-y-4">
      <p className="flex gap-2 rounded-md border border-line bg-surface px-3 py-2 text-xs text-ink-2">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {STABILITY_DISCLAIMER}
      </p>
      {!evaluation ? (
        <p className="text-sm text-ink-2">
          {hasVessel
            ? 'Добавьте гидростатику судна — без неё остойчивость не считается.'
            : 'Данных судна нет. Выберите судно в библиотеке или заполните группы слева, начиная с гидростатики.'}
        </p>
      ) : (
        <>
          <span id={labelId} className="sr-only">
            Результат для состояния
          </span>
          <ToggleGroup
            type="single"
            value={chosen ?? evaluation.worst.state}
            onValueChange={(v) => v && setChosen(v as LoadingState)}
            aria-labelledby={labelId}
            className="grid grid-cols-2 gap-1"
          >
            {(['departure', 'arrival'] as const).map((state) => (
              <ToggleGroupItem
                key={state}
                value={state}
                className="h-auto justify-start gap-2 rounded-md border px-3 py-2 text-left data-[state=on]:border-line-strong data-[state=on]:bg-accent"
              >
                <VerdictIcon verdict={evaluation[state].verdict} />
                <span>
                  <span className="block text-sm font-medium">{STATE_LABEL[state]}</span>
                  <span className="block text-xs text-ink-2">{VERDICT_WORD[evaluation[state].verdict]}</span>
                </span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {evaluation.arrivalSameAsDeparture && (
            <p className="text-xs text-ink-2">Приход совпадает с отходом: своих танков у прихода нет, обледенение не учитывается.</p>
          )}
          <StateResult s={evaluation[chosen ?? evaluation.worst.state]} />
        </>
      )}
      <section className="space-y-1 text-xs text-ink-2">
        <h3 className="font-medium text-ink">Не проверяется</h3>
        <ul className="list-disc space-y-0.5 pl-4">
          {NOT_CHECKED.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function StateResult({ s }: { s: StateStability }) {
  const { stability: r, draughts: d } = s
  const estimated = r.extrapolated
  const value = cn('tabular-nums', estimated ? 'text-ink-2' : 'text-ink')
  const listSide = r.listSide === 'starboard' ? ' на правый борт' : r.listSide === 'port' ? ' на левый борт' : ''
  const trim =
    r.trimM === null ? '—' : r.trimDirection === 'even' ? 'ровно' : `${m2(Math.abs(r.trimM))} м ${r.trimDirection === 'by-head' ? 'на нос' : 'на корму'}`
  const margin = gmMargin(s)
  const maxDraft = s.vessel.particulars.maxDraftM
  const reference = knReference(s)

  return (
    <div className="space-y-4" data-testid="stability-state" data-state={s.state} data-verdict={s.verdict}>
      {estimated && (
        <div role="alert" className="space-y-1 rounded-md border border-danger/40 bg-danger-bg p-3 text-danger">
          <p className="flex items-center gap-1.5 text-lg font-semibold leading-tight">
            <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
            Числа ниже — только оценка
          </p>
          <p className="text-xs">
            Водоизмещение {tonnes(r.displacementKg)} т вне таблицы гидростатики. Взята её крайняя строка, а не расчёт для этой загрузки, поэтому
            осадки, GM, крен и дифферент не подтверждены.
          </p>
        </div>
      )}

      <div className={cn('flex items-center gap-2 text-base font-semibold', s.verdict === 'error' ? 'text-danger' : s.verdict === 'warn' ? 'text-warn' : 'text-ok')}>
        <VerdictIcon verdict={s.verdict} className="h-5 w-5" />
        {STATE_LABEL[s.state]}: {VERDICT_WORD[s.verdict].toLowerCase()}
      </div>

      <div className="rounded-md border border-line bg-surface p-3">
        <div className="flex items-baseline gap-2 text-xs text-ink-2">
          GM с поправкой на свободную поверхность
          {estimated && <EstimateTag />}
        </div>
        <div className={cn('mt-1 text-2xl font-semibold', estimated ? 'text-ink-2' : s.verdict === 'error' ? 'text-danger' : 'text-ink')} data-testid="stability-gm">
          {m2(r.GM_fluid)} м
        </div>
        <p className="mt-1 text-xs text-ink-2">{limitLine(s)}</p>
        <p className="text-xs text-ink-2">
          {margin >= 0 ? 'Запас' : 'Не хватает'} {m2(Math.abs(margin))} м · KM {m2(r.KM)} − KG {m2(r.KG)} − поправка {m2(r.freeSurfaceCorrectionM)}
        </p>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <Row label="Водоизмещение" estimated={estimated}>
          <span className={value}>{tonnes(r.displacementKg)} т</span>
        </Row>
        <Row label="Осадка средняя" estimated={estimated}>
          <span className={value}>{d.meanM !== null ? `${m2(d.meanM)} м` : '—'}</span>
        </Row>
        <Row label="Носом / кормой" estimated={estimated}>
          {d.foreM !== null && d.aftM !== null ? (
            <span className={value}>
              {m2(d.foreM)} / {m2(d.aftM)} м
            </span>
          ) : (
            <span className="text-xs text-ink-2">{foreAftMissing(s)}</span>
          )}
        </Row>
        {maxDraft !== undefined && d.midM !== null && (
          <Row label="На миделе" estimated={estimated}>
            <span className={cn(value, d.midM > maxDraft + 1e-9 && 'text-danger')}>
              {m2(d.midM)} м <span className="text-xs text-ink-2">предел {m2(maxDraft)} м</span>
            </span>
          </Row>
        )}
        <Row label="Крен" estimated={estimated}>
          <span className={value}>
            {fmtNumber(r.listDeg)}°{listSide}
            {!r.listReliable && <span className="text-xs text-warn"> — больше 10°, малоугловая формула недостоверна</span>}
          </span>
        </Row>
        <Row label="Дифферент" estimated={estimated && r.trimM !== null}>
          {r.trimM === null ? <span className="text-xs text-ink-2">нужны LCB и MTC в гидростатике</span> : <span className={value}>{trim}</span>}
        </Row>
        {s.waterKg > 0 && (
          <Row label="Вода в трубах">
            <span className="tabular-nums">
              {fmtTonnes(s.waterKg)} т{s.waterVcgM !== undefined && <span className="text-xs text-ink-2"> · центр {m2(s.waterVcgM)} м над килем</span>}
            </span>
          </Row>
        )}
        {s.iceKg > 0 && (
          <Row label="Лёд">
            <span className="tabular-nums">
              {fmtTonnes(s.iceKg)} т{s.iceVcgM !== undefined && <span className="text-xs text-ink-2"> · центр {m2(s.iceVcgM)} м над килем</span>}
            </span>
          </Row>
        )}
      </dl>

      {s.reasons.length > 0 && (
        <ul className="space-y-1.5" aria-label="Причины">
          {s.reasons.map((reason) => (
            <li key={reason.text} className="flex items-start gap-2 text-sm">
              <VerdictIcon verdict={reason.status} className="mt-0.5" />
              <span className="sr-only">{reason.status === 'error' ? 'Ошибка: ' : 'Предупреждение: '}</span>
              <span>{reason.text}</span>
            </li>
          ))}
        </ul>
      )}

      <section className="space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          Справка по KN
          <EstimateTag />
        </h3>
        {reference ? (
          <>
            <p className="text-xs text-ink-2">На итог проверки не влияет: итог даёт предел по формуляру.</p>
            {reference.gz.knOutOfRange && <p className="text-xs text-warn">Водоизмещение вне таблицы KN — кривая построена по её крайней строке.</p>}
            <GzChart gz={reference.gz} downfloodingAngleDeg={s.vessel.particulars.downfloodingAngleDeg} />
            <table className="w-full text-xs" aria-label="Критерии справки по KN">
              <tbody>
                {reference.criteria.map((c) => (
                  <tr key={c.id} className="border-t border-line first:border-t-0">
                    <td className="py-1 pr-2">
                      {c.pass ? <Check className="mr-1 inline h-3.5 w-3.5 text-ink-2" aria-hidden="true" /> : <X className="mr-1 inline h-3.5 w-3.5 text-ink-2" aria-hidden="true" />}
                      <span className="sr-only">{c.pass ? 'выполнен: ' : 'не выполнен: '}</span>
                      {c.description}
                    </td>
                    <td className="whitespace-nowrap py-1 text-right tabular-nums">
                      {fmtNumber(c.actualValue)}
                      {c.unit === '°' ? '°' : ` ${c.unit}`} <span className="text-ink-2">(треб. {fmtNumber(c.requiredValue)})</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {s.vessel.particulars.downfloodingAngleDeg === undefined && (
              <p className="text-xs text-ink-2">Угол заливания не задан — площади считаются до 30° и 40°, что завышает их, если судно заливает раньше.</p>
            )}
          </>
        ) : (
          <p className="text-xs text-ink-2">Кривых KN нет — справка по кривой GZ недоступна.</p>
        )}
      </section>
    </div>
  )
}

// What the draughts fore and aft wait for.
function foreAftMissing(s: StateStability): string {
  const hydro = [s.stability.LCF === undefined && 'LCF', s.stability.trimM === null && 'LCB и MTC'].filter(Boolean).join(', ')
  const parts = [hydro && `${hydro} в гидростатике`, !(s.vessel.particulars.lengthBpp > 0) && 'LBP'].filter(Boolean)
  return `не хватает: ${parts.join('; ')}`
}

// The limit the GM is judged against, in words.
function limitLine(s: StateStability): string {
  const general = `общим минимумом GM ${G_METACENTRIC_MIN_SAFE} м`
  const l = s.limit
  if (!l) return `Предел из формуляра не задан — сравнивается с ${general}`
  const at = l.kind === 'min-gm-by-draft' ? `осадке ${m2(l.arg)} м` : `водоизмещении ${tonnes(l.arg)} т`
  if (!l.inRange) {
    const range = l.kind === 'min-gm-by-draft' ? `${m2(l.range[0])}–${m2(l.range[1])} м` : `${tonnes(l.range[0])}–${tonnes(l.range[1])} т`
    return `При ${at} предела в таблице нет (${range}) — сравнивается с ${general}`
  }
  if (l.kind === 'max-kg-by-displacement')
    return `Предел: KG с поправкой не выше ${m2(s.stability.KM - l.gmMinM)} м при ${at}, то есть GM не ниже ${m2(l.gmMinM)} м`
  return `Предел по формуляру ${m2(l.gmMinM)} м при ${at}`
}

function Row({ label, estimated, children }: { label: string; estimated?: boolean; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-ink-2">
        {label}
        {estimated && (
          <>
            {' '}
            <EstimateTag />
          </>
        )}
      </dt>
      <dd>{children}</dd>
    </>
  )
}

function EstimateTag() {
  return <span className="rounded bg-accent px-1 text-xs font-medium text-ink-2">оценка</span>
}
