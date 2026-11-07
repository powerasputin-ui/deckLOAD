'use client'

import { useId } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { v4 as uuid } from 'uuid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { PanelBlock } from '@/components/shell/SectionPanel'
import { NumberField } from '@/components/calculator/NumberField'
import { Field, KgTable, PLANNING_NOTE, STATUS_ICON, STATUS_TONE, TransfersBlock } from '@/components/sections/vessel/SemiSubBlocks'
import { useCalculator } from '@/store/calculator'
import { EMPTY_JACK_UP, type JackUpData, type JackUpLeg, type JackUpResult } from '@/lib/jackUp'
import { cn, fmtNumber } from '@/lib/utils'

// A self-elevating unit's blocks in «Платформа» (spec 2026-11-06, 11.2):
// its legs and limits afloat and elevated from the operating manual, the
// day's report — where it is, and on its legs each leg's load — and the
// supply run's other transfers. No figure is assumed.

// A leg's load taken out of the report's.
function without(loads: Record<string, number>, id: string): Record<string, number> {
  return Object.fromEntries(Object.entries(loads).filter(([k]) => k !== id))
}

function useJackUp(): [JackUpData, (next: JackUpData) => void] {
  const jack = useCalculator((s) => s.deck.jackUp) ?? EMPTY_JACK_UP
  const setDeck = useCalculator((s) => s.setDeck)
  return [jack, (next) => setDeck({ jackUp: next })]
}

export function JackUpDataBlock() {
  const [jack, update] = useJackUp()
  const height = useCalculator((s) => s.deck.shipFrame?.heightAboveBaselineM)
  const setShipFrame = useCalculator((s) => s.setShipFrame)
  const uid = useId()
  const a = jack.afloat
  const e = jack.elevated
  const setA = (patch: Partial<JackUpData['afloat']>) => update({ ...jack, afloat: { ...a, ...patch } })
  const setE = (patch: Partial<JackUpData['elevated']>) => update({ ...jack, elevated: { ...e, ...patch } })
  const putLeg = (id: string, patch: Partial<JackUpLeg>) => update({ ...jack, legs: jack.legs.map((l) => (l.id === id ? { ...l, ...patch } : l)) })
  const removeLeg = (id: string) => {
    update({ ...jack, legs: jack.legs.filter((l) => l.id !== id), report: { ...jack.report, legLoadsT: without(jack.report.legLoadsT, id) } })
  }
  const num = (
    id: string,
    label: string,
    unit: string,
    value: number | undefined,
    set: (v: number | undefined) => void,
    opts: { min?: number; step?: number } = {}
  ) => (
    <Field id={`${uid}-${id}`} label={label} unit={unit} compact>
      <NumberField id={`${uid}-${id}`} min={opts.min ?? 0.01} step={opts.step} value={value} onCommit={(v) => set(v)} onClear={() => set(undefined)} className="h-8 text-xs" />
    </Field>
  )
  return (
    <PanelBlock title="Данные установки" fold="jack-data">
      <p className="text-xs text-ink-2">Из руководства по эксплуатации установки и оценки точки работы. KG — с поправкой на свободные поверхности.</p>
      <Field id={`${uid}-deck`} label="Высота палубы над основной плоскостью" unit="м">
        <NumberField id={`${uid}-deck`} min={0.1} value={height} onCommit={(v) => setShipFrame({ heightAboveBaselineM: v })} placeholder="не задана" className="h-8 text-xs" />
      </Field>
      <fieldset className="space-y-2 rounded-md border border-line p-2.5">
        <legend className="px-1 text-xs font-semibold text-ink-2">На опорах</legend>
        <div className="grid grid-cols-3 gap-1.5">
          {num('vdl-e', 'VDL в работе', 'т', e.vdlMaxT, (v) => setE({ vdlMaxT: v }), { min: 1, step: 100 })}
          {num('vdl-s', 'VDL в шторм', 'т', e.vdlStormMaxT, (v) => setE({ vdlStormMaxT: v }), { min: 1, step: 100 })}
          {num('leg-max', 'Опора, доп.', 'т', e.maxLegLoadT, (v) => setE({ maxLegLoadT: v }), { min: 1, step: 100 })}
        </div>
        <p className="text-xs text-ink-2">Допустимая статическая нагрузка на опору — из оценки точки работы, с запасом на шторм.</p>
      </fieldset>
      <fieldset className="space-y-2 rounded-md border border-line p-2.5">
        <legend className="px-1 text-xs font-semibold text-ink-2">На плаву</legend>
        <div className="grid grid-cols-3 gap-1.5">
          {num('vdl-a', 'Предел VDL', 'т', a.vdlMaxT, (v) => setA({ vdlMaxT: v }), { min: 1, step: 100 })}
          {num('tpc', 'TPC', 'т/см', a.tpcTPerCm, (v) => setA({ tpcTPerCm: v }), { min: 0.01 })}
          {num('draft-max', 'Осадка наиб.', 'м', a.maxDraftM, (v) => setA({ maxDraftM: v }), { min: 0.1 })}
        </div>
        <KgTable label="Допустимый KG, на плаву" rows={a.kgLimit ?? []} onChange={(rows) => setA({ kgLimit: rows.length > 0 ? rows : undefined })} />
      </fieldset>
      <fieldset className="space-y-1.5 rounded-md border border-line p-2.5">
        <legend className="px-1 text-xs font-semibold text-ink-2">Опоры</legend>
        <p className="text-xs text-ink-2">Центр опоры: от кормового края палубы и от левого борта, м. Опора может стоять и за пределами палубы.</p>
        {jack.legs.length > 0 && (
          <div role="group" aria-label="Опоры" className="space-y-1">
            <div className="grid grid-cols-[1fr_64px_64px_24px] gap-1.5 text-xs text-ink-2">
              <span>Опора</span>
              <span>От кормы</span>
              <span>От лев. борта</span>
              <span />
            </div>
            {jack.legs.map((leg, i) => (
              <div key={leg.id} className="grid grid-cols-[1fr_64px_64px_24px] items-center gap-1.5">
                <Input aria-label={`Название опоры ${i + 1}`} value={leg.name} onChange={(ev) => putLeg(leg.id, { name: ev.target.value })} className="h-7 text-xs" />
                <NumberField aria-label={`От кормы, м, ${leg.name || `опора ${i + 1}`}`} value={leg.fromSternM} onCommit={(v) => putLeg(leg.id, { fromSternM: v })} onClear={() => putLeg(leg.id, { fromSternM: undefined })} className="h-7 text-xs" />
                <NumberField aria-label={`От левого борта, м, ${leg.name || `опора ${i + 1}`}`} value={leg.fromPortM} onCommit={(v) => putLeg(leg.id, { fromPortM: v })} onClear={() => putLeg(leg.id, { fromPortM: undefined })} className="h-7 text-xs" />
                <button
                  type="button"
                  aria-label={`Удалить «${leg.name || `опору ${i + 1}`}»`}
                  onClick={() => removeLeg(leg.id)}
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-ink-2 hover:bg-accent hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}
        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => update({ ...jack, legs: [...jack.legs, { id: uuid(), name: `Опора ${jack.legs.length + 1}` }] })}>
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Добавить опору
        </Button>
      </fieldset>
    </PanelBlock>
  )
}

export function JackUpReportBlock({ result }: { result?: JackUpResult }) {
  const [jack, update] = useJackUp()
  const r = jack.report
  const uid = useId()
  const set = (patch: Partial<JackUpData['report']>) => update({ ...jack, report: { ...r, ...patch } })
  const num = (key: 'draftM' | 'displacementT' | 'kgM' | 'vdlT', label: string, unit: string, min: number, step = 0.1) => (
    <Field id={`${uid}-${key}`} label={label} unit={unit} compact>
      <NumberField id={`${uid}-${key}`} min={min} step={step} value={r[key]} onCommit={(v) => set({ [key]: v })} onClear={() => set({ [key]: undefined })} className="h-8 text-xs" />
    </Field>
  )
  return (
    <PanelBlock title="Суточный отчёт" fold="jack-report">
      <p className="text-xs text-ink-2">Из бортового компьютера установки — груз «на борту» в нём уже учтён.</p>
      <ToggleGroup
        type="single"
        value={jack.mode}
        onValueChange={(v) => (v === 'afloat' || v === 'elevated') && update({ ...jack, mode: v })}
        aria-label="Положение установки"
        className="grid w-full grid-cols-2 gap-1"
      >
        <ToggleGroupItem value="elevated" className="h-8 text-xs">
          На опорах
        </ToggleGroupItem>
        <ToggleGroupItem value="afloat" className="h-8 text-xs">
          На плаву
        </ToggleGroupItem>
      </ToggleGroup>
      <div className="space-y-1">
        <label htmlFor={`${uid}-date`} className="block text-xs text-ink-2">
          Дата отчёта
        </label>
        <Input id={`${uid}-date`} type="date" value={r.date ?? ''} onChange={(e) => set({ date: e.target.value || undefined })} className="h-8 text-xs" />
      </div>
      {jack.mode === 'afloat' ? (
        <div className="grid grid-cols-3 gap-1.5">
          {num('draftM', 'Осадка', 'м', 0.1)}
          {num('displacementT', 'Водоизм.', 'т', 1, 100)}
          {num('kgM', 'KG испр.', 'м', 0.1, 0.01)}
          {num('vdlT', 'VDL', 'т', 0, 10)}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-1.5">{num('vdlT', 'VDL', 'т', 0, 10)}</div>
          {jack.legs.length === 0 ? (
            <p className="text-xs text-ink-2">Задайте опоры в «Данных установки» — здесь появятся их нагрузки.</p>
          ) : (
            <div role="group" aria-label="Нагрузки на опоры" className="grid grid-cols-2 gap-1.5">
              {jack.legs.map((leg, i) => (
                <Field key={leg.id} id={`${uid}-leg-${leg.id}`} label={`Нагрузка, ${leg.name || `опора ${i + 1}`}`} unit="т" compact>
                  <NumberField
                    id={`${uid}-leg-${leg.id}`}
                    min={0}
                    step={10}
                    value={r.legLoadsT[leg.id]}
                    onCommit={(v) => set({ legLoadsT: { ...r.legLoadsT, [leg.id]: v } })}
                    onClear={() => set({ legLoadsT: without(r.legLoadsT, leg.id) })}
                    className="h-8 text-xs"
                  />
                </Field>
              ))}
            </div>
          )}
        </div>
      )}
      {result && <JackUpResultView result={result} />}
    </PanelBlock>
  )
}

function JackUpResultView({ result }: { result: JackUpResult }) {
  const t = (v: number | undefined) => (v === undefined ? '—' : `${fmtNumber(Math.round(v))} т`)
  const m = (v: number | undefined) => (v === undefined ? '—' : `${v.toFixed(2)} м`)
  return (
    <div className="space-y-2 rounded-md border border-line p-2.5" data-testid="jack-up-result">
      <p className="text-xs font-semibold text-ink-2">После рейса</p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-ink-2">Приход − отгрузка</dt>
        <dd className="text-right font-medium tabular-nums">{t(result.netT)}</dd>
        <dt className="text-ink-2">VDL</dt>
        <dd className="text-right font-medium tabular-nums">{t(result.vdlAfterT)}</dd>
        {result.mode === 'afloat' && (
          <>
            <dt className="text-ink-2">Осадка</dt>
            <dd className="text-right font-medium tabular-nums">{m(result.draftAfterM)}</dd>
            <dt className="text-ink-2">KG</dt>
            <dd className="text-right font-medium tabular-nums">{m(result.kgAfterM)}</dd>
          </>
        )}
      </dl>
      {result.mode === 'elevated' && (result.legs ?? []).length > 0 && (
        <table className="w-full text-xs tabular-nums" aria-label="Нагрузки на опоры после рейса">
          <thead className="text-ink-2">
            <tr>
              <th className="text-left font-normal">Опора</th>
              <th className="text-right font-normal">Отчёт</th>
              <th className="text-right font-normal">Прирост</th>
              <th className="text-right font-normal">После</th>
            </tr>
          </thead>
          <tbody>
            {result.legs!.map((l) => (
              <tr key={l.id} className={cn(result.maxLegLoadT !== undefined && (l.afterT ?? 0) > result.maxLegLoadT && 'font-medium text-danger')}>
                <td>{l.name}</td>
                <td className="text-right">{t(l.reportT)}</td>
                <td className="text-right">{t(l.addedT)}</td>
                <td className="text-right">{t(l.afterT)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ul className="space-y-1.5" aria-label="Проверки СПБУ">
        {result.checks.map((c) => {
          const Icon = STATUS_ICON[c.status]
          return (
            <li key={c.id} className="flex items-start gap-1.5 text-xs">
              <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', STATUS_TONE[c.status])} aria-hidden="true" />
              <span>
                <span className="font-medium">{c.title}:</span> {c.detail}
              </span>
            </li>
          )
        })}
      </ul>
      {result.mode === 'elevated' && (
        <p className="text-xs text-ink-2">
          Только статика. Уходящий груз и расход из нагрузок на опоры не вычитаются; прочий приход — у своей опоры или поровну, как указано в его строке.
        </p>
      )}
      <p className="text-xs text-ink-2">{PLANNING_NOTE}</p>
    </div>
  )
}

// A jack-up's rows say where what's brought stands, for the legs (audit
// 2026-11-07): by a leg, or shared equally at the legs' centre.
export function JackUpTransfersBlock() {
  const [jack, update] = useJackUp()
  const places = jack.legs.map((l, i) => ({ id: l.id, label: `у «${l.name || `Опора ${i + 1}`}»` }))
  return <TransfersBlock fold="jack-transfers" rows={jack.transfers} onChange={(transfers) => update({ ...jack, transfers })} places={places} />
}
