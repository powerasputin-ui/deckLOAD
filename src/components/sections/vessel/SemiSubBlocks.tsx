'use client'

import { useId, useState } from 'react'
import { CircleCheck, CircleMinus, CircleX, Plus, Trash2 } from 'lucide-react'
import { v4 as uuid } from 'uuid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PanelBlock } from '@/components/shell/SectionPanel'
import { NumberField } from '@/components/calculator/NumberField'
import { useCalculator } from '@/store/calculator'
import { EMPTY_SEMI_SUB, type SemiSubData, type SemiSubKgRow, type SemiSubMode, type SemiSubResult, type SemiSubTransfer } from '@/lib/semiSub'
import { cn, fmtNumber } from '@/lib/utils'

// A semi-submersible's blocks in «Платформа» (spec 2026-11-06, 7.1): what
// its operating manual gives, the day's report from its loading computer,
// and the supply run's other transfers. Every figure is the user's; none is
// guessed, and a check without its figures reads «—».

export const PLANNING_NOTE = 'Оценка для планирования. Окончательно считает бортовой компьютер установки.'

function useSemiSub(): [SemiSubData, (next: SemiSubData) => void] {
  const semi = useCalculator((s) => s.deck.semiSub) ?? EMPTY_SEMI_SUB
  const setDeck = useCalculator((s) => s.setDeck)
  return [semi, (next) => setDeck({ semiSub: next })]
}

export function SemiSubDataBlock() {
  const [semi, update] = useSemiSub()
  const height = useCalculator((s) => s.deck.shipFrame?.heightAboveBaselineM)
  const setShipFrame = useCalculator((s) => s.setShipFrame)
  const uid = useId()
  return (
    <PanelBlock title="Данные установки" fold="semi-data">
      <p className="text-xs text-ink-2">Из руководства по эксплуатации установки. KG — с поправкой на свободные поверхности.</p>
      <Field id={`${uid}-deck`} label="Высота палубы над основной плоскостью" unit="м">
        <NumberField id={`${uid}-deck`} min={0.1} value={height} onCommit={(v) => setShipFrame({ heightAboveBaselineM: v })} placeholder="не задана" className="h-8 text-xs" />
      </Field>
      <Field id={`${uid}-ballast`} label="Высота откачиваемого балласта" unit="м">
        <NumberField
          id={`${uid}-ballast`}
          min={0.1}
          value={semi.ballastVcgM}
          onCommit={(v) => update({ ...semi, ballastVcgM: v })}
          onClear={() => update({ ...semi, ballastVcgM: undefined })}
          placeholder="не задана"
          className="h-8 text-xs"
        />
      </Field>
      <ModeFields title="Рабочий режим" mode={semi.operating} onChange={(operating) => update({ ...semi, operating })} />
      <ModeFields title="Штормовой режим" mode={semi.survival} onChange={(survival) => update({ ...semi, survival })} />
    </PanelBlock>
  )
}

function ModeFields({ title, mode, onChange }: { title: string; mode: SemiSubMode; onChange: (m: SemiSubMode) => void }) {
  const uid = useId()
  const set = (patch: Partial<SemiSubMode>) => onChange({ ...mode, ...patch })
  return (
    <fieldset className="space-y-2 rounded-md border border-line p-2.5">
      <legend className="px-1 text-xs font-semibold text-ink-2">{title}</legend>
      <div className="grid grid-cols-3 gap-1.5">
        <Field id={`${uid}-draft`} label="Осадка" unit="м" compact>
          <NumberField id={`${uid}-draft`} min={0.1} value={mode.draftM} onCommit={(v) => set({ draftM: v })} onClear={() => set({ draftM: undefined })} className="h-8 text-xs" />
        </Field>
        <Field id={`${uid}-disp`} label="Водоизм." unit="т" compact>
          <NumberField id={`${uid}-disp`} min={1} step={100} value={mode.displacementT} onCommit={(v) => set({ displacementT: v })} onClear={() => set({ displacementT: undefined })} className="h-8 text-xs" />
        </Field>
        <Field id={`${uid}-vdl`} label="Предел VDL" unit="т" compact>
          <NumberField id={`${uid}-vdl`} min={1} step={100} value={mode.vdlMaxT} onCommit={(v) => set({ vdlMaxT: v })} onClear={() => set({ vdlMaxT: undefined })} className="h-8 text-xs" />
        </Field>
      </div>
      <KgTable label={`Допустимый KG, ${title.toLowerCase()}`} rows={mode.kgLimit ?? []} onChange={(rows) => set({ kgLimit: rows.length > 0 ? rows : undefined })} />
    </fieldset>
  )
}

// The allowable KG by draught: a row per draught of the manual's table or
// curve, one row being enough at a single draught. A new row is empty and
// joins the table once both its figures are in: no limit is ever assumed.
export function KgTable({ label, rows, onChange }: { label: string; rows: SemiSubKgRow[]; onChange: (rows: SemiSubKgRow[]) => void }) {
  const put = (i: number, patch: Partial<SemiSubKgRow>) => onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)))
  const [draft, setDraft] = useState<Partial<SemiSubKgRow> | null>(null)
  const fillDraft = (next: Partial<SemiSubKgRow>) => {
    if (next.draftM !== undefined && next.kgMaxM !== undefined) {
      onChange([...rows, { draftM: next.draftM, kgMaxM: next.kgMaxM }])
      setDraft(null)
    } else setDraft(next)
  }
  const n = rows.length + 1
  return (
    <div role="group" aria-label={label} className="space-y-1">
      {(rows.length > 0 || draft) && (
        <div className="grid grid-cols-[1fr_1fr_24px] gap-1.5 text-xs text-ink-2">
          <span>Осадка, м</span>
          <span>KG доп., м</span>
          <span />
        </div>
      )}
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_24px] items-center gap-1.5">
          <NumberField aria-label={`Осадка, строка ${i + 1}`} min={0.1} value={r.draftM} onCommit={(v) => put(i, { draftM: v })} className="h-7 text-xs" />
          <NumberField aria-label={`Допустимый KG, строка ${i + 1}`} min={0.1} value={r.kgMaxM} onCommit={(v) => put(i, { kgMaxM: v })} className="h-7 text-xs" />
          <button
            type="button"
            aria-label={`Удалить строку ${i + 1}`}
            onClick={() => onChange(rows.filter((_, k) => k !== i))}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-ink-2 hover:bg-accent hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      ))}
      {draft && (
        <div className="grid grid-cols-[1fr_1fr_24px] items-center gap-1.5">
          <NumberField aria-label={`Осадка, строка ${n}`} min={0.1} value={draft.draftM} onCommit={(v) => fillDraft({ ...draft, draftM: v })} placeholder="м" className="h-7 text-xs" />
          <NumberField aria-label={`Допустимый KG, строка ${n}`} min={0.1} value={draft.kgMaxM} onCommit={(v) => fillDraft({ ...draft, kgMaxM: v })} placeholder="м" className="h-7 text-xs" />
          <button
            type="button"
            aria-label={`Удалить строку ${n}`}
            onClick={() => setDraft(null)}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-ink-2 hover:bg-accent hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}
      <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" disabled={!!draft} onClick={() => setDraft({})}>
        <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
        Строка KG
      </Button>
    </div>
  )
}

export function SemiSubReportBlock({ result }: { result?: SemiSubResult }) {
  const [semi, update] = useSemiSub()
  const r = semi.report
  const uid = useId()
  const set = (patch: Partial<SemiSubData['report']>) => update({ ...semi, report: { ...r, ...patch } })
  const num = (key: 'draftM' | 'displacementT' | 'kgM' | 'vdlT' | 'ballastT', label: string, unit: string, min: number, step = 0.1) => (
    <Field id={`${uid}-${key}`} label={label} unit={unit} compact>
      <NumberField id={`${uid}-${key}`} min={min} step={step} value={r[key]} onCommit={(v) => set({ [key]: v })} onClear={() => set({ [key]: undefined })} className="h-8 text-xs" />
    </Field>
  )
  return (
    <PanelBlock title="Суточный отчёт" fold="semi-report">
      <p className="text-xs text-ink-2">Из бортового компьютера установки — груз «на борту» в нём уже учтён.</p>
      <div className="space-y-1">
        <label htmlFor={`${uid}-date`} className="block text-xs text-ink-2">
          Дата отчёта
        </label>
        <Input id={`${uid}-date`} type="date" value={r.date ?? ''} onChange={(e) => set({ date: e.target.value || undefined })} className="h-8 text-xs" />
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {num('draftM', 'Осадка', 'м', 0.1)}
        {num('displacementT', 'Водоизм.', 'т', 1, 100)}
        {num('kgM', 'KG испр.', 'м', 0.1, 0.01)}
        {num('vdlT', 'VDL', 'т', 0, 10)}
        {num('ballastT', 'Балласт', 'т', 0, 100)}
      </div>
      {result && <SemiSubResultView result={result} />}
    </PanelBlock>
  )
}

export const STATUS_ICON = { ok: CircleCheck, error: CircleX, none: CircleMinus }
export const STATUS_TONE = { ok: 'text-ok', error: 'text-danger', none: 'text-ink-2' }

function SemiSubResultView({ result }: { result: SemiSubResult }) {
  const m = (v: number | undefined) => (v === undefined ? '—' : `${v.toFixed(2)} м`)
  const t = (v: number | undefined) => (v === undefined ? '—' : `${fmtNumber(Math.round(v))} т`)
  return (
    <div className="space-y-2 rounded-md border border-line p-2.5" data-testid="semi-sub-result">
      <p className="text-xs font-semibold text-ink-2">После рейса</p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-ink-2">Приход − отгрузка</dt>
        <dd className="text-right font-medium tabular-nums">{t(result.netT)}</dd>
        <dt className="text-ink-2">VDL</dt>
        <dd className="text-right font-medium tabular-nums">{t(result.vdlAfterT)}</dd>
        <dt className="text-ink-2">KG в работе</dt>
        <dd className="text-right font-medium tabular-nums">{m(result.kgOperatingM)}</dd>
        <dt className="text-ink-2">KG в шторм</dt>
        <dd className="text-right font-medium tabular-nums">{m(result.kgSurvivalM)}</dd>
      </dl>
      <ul className="space-y-1.5" aria-label="Проверки ППБУ">
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
      <p className="text-xs text-ink-2">{PLANNING_NOTE}</p>
    </div>
  )
}

export function SemiSubTransfersBlock() {
  const [semi, update] = useSemiSub()
  return <TransfersBlock fold="semi-transfers" rows={semi.transfers} onChange={(transfers) => update({ ...semi, transfers })} />
}

// The supply run's other transfers — fuel, water, bulk — for a unit of
// either kind: a row starts empty and assumes nothing.
export function TransfersBlock({ fold, rows, onChange }: { fold: string; rows: SemiSubTransfer[]; onChange: (rows: SemiSubTransfer[]) => void }) {
  const put = (id: string, patch: Partial<SemiSubTransfer>) => onChange(rows.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  return (
    <PanelBlock title="Прочий приход и расход" fold={fold}>
      <p className="text-xs text-ink-2">Топливо, вода, сыпучие: «+» — приходит, «−» — уходит. Входит в VDL и в KG.</p>
      {rows.length > 0 && (
        <div className="space-y-1" role="group" aria-label="Прочий приход и расход">
          <div className="grid grid-cols-[1fr_72px_64px_24px] gap-1.5 text-xs text-ink-2">
            <span>Что</span>
            <span>Вес, т</span>
            <span>ЦТ, м</span>
            <span />
          </div>
          {rows.map((x, i) => (
            <div key={x.id} className="grid grid-cols-[1fr_72px_64px_24px] items-center gap-1.5">
              <Input aria-label={`Что, строка ${i + 1}`} value={x.name} onChange={(e) => put(x.id, { name: e.target.value })} className="h-7 text-xs" />
              <NumberField
                aria-label={`Вес, т, строка ${i + 1}`}
                value={x.weightT}
                onCommit={(v) => put(x.id, { weightT: v })}
                onClear={() => put(x.id, { weightT: undefined })}
                placeholder="±т"
                className="h-7 text-xs"
              />
              <NumberField
                aria-label={`ЦТ над ОП, м, строка ${i + 1}`}
                min={0}
                value={x.vcgM}
                onCommit={(v) => put(x.id, { vcgM: v })}
                onClear={() => put(x.id, { vcgM: undefined })}
                placeholder="м"
                className="h-7 text-xs"
              />
              <button
                type="button"
                aria-label={`Удалить «${x.name || `строку ${i + 1}`}»`}
                onClick={() => onChange(rows.filter((y) => y.id !== x.id))}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-ink-2 hover:bg-accent hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
      <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => onChange([...rows, { id: uuid(), name: '' }])}>
        <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
        Добавить строку
      </Button>
    </PanelBlock>
  )
}

export function Field({ id, label, unit, compact, children }: { id: string; label: string; unit: string; compact?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className={cn('block text-xs text-ink-2', compact && 'truncate')} title={compact ? `${label}, ${unit}` : undefined}>
        {label}, {unit}
      </label>
      {children}
    </div>
  )
}
