'use client'

import { useId, useState } from 'react'
import { ChevronRight, Copy, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { NumberField } from '@/components/calculator/NumberField'
import { ValueTable, type CellValue, type ValueColumn } from '@/components/stability/ValueTable'
import { TextField } from '@/components/calculator/TextField'
import { useCalculator } from '@/store/calculator'
import {
  DEFAULT_SHIP_FRAME,
  DEFAULT_VESSEL_PARTICULARS,
  G_METACENTRIC_MIN_SAFE,
  knCurvesProblem,
  lightshipLcgHint,
  weightsInState,
  type HydrostaticPoint,
  type KNCrossCurves,
  type LoadingState,
  type StabilityLimit,
  type VariableWeightItem,
  type VesselParticulars,
  type VesselStabilityData,
} from '@/lib/stability'
import { parseKnTable } from '@/lib/tablePaste'
import { vesselTemplateById } from '@/lib/vesselTemplates'
import { DRAWING_EDGE_WORD, hullSideEdges } from '@/lib/deckDrawing'
import { cn, fmtNumber, pluralRu } from '@/lib/utils'

const EMPTY_VESSEL: VesselStabilityData = { particulars: DEFAULT_VESSEL_PARTICULARS, hydrostatics: { points: [] }, variableWeights: [] }

const rowsWord = (n: number) => `${n} ${pluralRu(n, 'строка', 'строки', 'строк')}`
const num = (v: CellValue) => (typeof v === 'number' ? v : undefined)

// The left column of the stability workspace (spec 2026-10-24, 6.1): the
// vessel's data by group, each field saved on Enter or leaving it. A
// library vessel's groups come filled in and folded.
export function StabilityData() {
  const vessel = useCalculator((s) => s.deck.vessel) ?? EMPTY_VESSEL
  const templateId = useCalculator((s) => s.deck.vesselTemplateId)
  const template = vesselTemplateById(templateId)
  const fromLibrary = !!template?.vessel

  return (
    <div className="space-y-2">
      {template && (
        <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs">
          <p>
            Данные из библиотеки: <span className="font-medium">{template.label}</span>
          </p>
          <details className="mt-1">
            <summary className="cursor-pointer text-ink-2 hover:text-ink">Откуда данные</summary>
            <p className="mt-1 text-ink-2">{template.note}</p>
          </details>
        </div>
      )}
      <VesselGroup particulars={vessel.particulars} open={!fromLibrary} />
      <LightshipGroup particulars={vessel.particulars} open={!fromLibrary} />
      <LimitGroup vessel={vessel} open={!fromLibrary} />
      <TanksGroup vessel={vessel} open={!fromLibrary} />
      <IcingGroup particulars={vessel.particulars} open={!fromLibrary} />
      <FrameGroup particulars={vessel.particulars} open={!fromLibrary} />
      <HydrostaticsGroup points={vessel.hydrostatics.points} open={!fromLibrary} />
      <KnGroup curves={vessel.knCurves} open={!fromLibrary} />
    </div>
  )
}

function Group({ title, summary, open, children }: { title: string; summary?: string; open: boolean; children: React.ReactNode }) {
  return (
    <details open={open} className="group rounded-md border border-line bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-4 w-4 shrink-0 text-ink-2 transition-transform group-open:rotate-90" aria-hidden="true" />
        <span className="text-sm font-semibold">{title}</span>
        {summary && <span className="ml-auto truncate text-xs text-ink-2">{summary}</span>}
      </summary>
      <div className="space-y-3 border-t border-line px-3 py-3">{children}</div>
    </details>
  )
}

function Hint({ children, tone }: { children: React.ReactNode; tone?: 'warn' }) {
  return <p className={cn('text-xs', tone === 'warn' ? 'text-warn' : 'text-ink-2')}>{children}</p>
}

function NumberInput({
  label,
  unit,
  value,
  onCommit,
  onClear,
  min,
  max,
  hint,
  placeholder,
}: {
  label: string
  unit?: string
  value: number | undefined
  onCommit: (v: number) => void
  // Makes the field optional: empty means «not given».
  onClear?: () => void
  min?: number
  max?: number
  hint?: string
  placeholder?: string
}) {
  const id = useId()
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs text-ink-2">
        {label}
        {unit && `, ${unit}`}
      </label>
      <NumberField id={id} value={value} onCommit={onCommit} onClear={onClear} min={min} max={max} placeholder={placeholder} className="h-8 text-sm tabular-nums" />
      {hint && <p className="text-xs text-ink-2">{hint}</p>}
    </div>
  )
}

function SelectField<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const id = useId()
  return (
    <div className="space-y-1">
      <span id={id} className="block text-xs text-ink-2">
        {label}
      </span>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger aria-labelledby={id} className="h-8 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function VesselGroup({ particulars: p, open }: { particulars: VesselParticulars; open: boolean }) {
  const set = useCalculator((s) => s.setVesselParticulars)
  const nameId = useId()
  return (
    <Group title="Судно" summary={[p.name || 'без названия', p.lengthBpp > 0 && `LBP ${fmtNumber(p.lengthBpp)} м`].filter(Boolean).join(' · ')} open={open}>
      <div className="space-y-1">
        <label htmlFor={nameId} className="block text-xs text-ink-2">
          Название
        </label>
        <TextField id={nameId} value={p.name ?? ''} onCommit={(v) => set({ name: v.trim() || undefined })} className="h-8 text-sm" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumberInput label="Длина LBP" unit="м" value={p.lengthBpp} min={0} onCommit={(v) => set({ lengthBpp: v })} />
        <NumberInput label="Ширина" unit="м" value={p.breadth} min={0} onCommit={(v) => set({ breadth: v })} />
        <NumberInput
          label="Длина L по грузовой марке"
          unit="м"
          value={p.loadLineLengthM}
          min={0}
          placeholder="как LBP"
          onCommit={(v) => set({ loadLineLengthM: v })}
          onClear={() => set({ loadLineLengthM: undefined })}
        />
        <NumberInput
          label="Предельная осадка"
          unit="м"
          value={p.maxDraftM}
          min={0}
          placeholder="не задана"
          onCommit={(v) => set({ maxDraftM: v })}
          onClear={() => set({ maxDraftM: undefined })}
        />
        <NumberInput
          label="Угол заливания"
          unit="°"
          value={p.downfloodingAngleDeg}
          min={0}
          max={90}
          placeholder="не задан"
          onCommit={(v) => set({ downfloodingAngleDeg: v })}
          onClear={() => set({ downfloodingAngleDeg: undefined })}
        />
      </div>
      <Hint>
        Длина L — для воды в трубах, без неё берётся LBP, и воды выходит меньше. Предельная осадка — летняя, по свидетельству о грузовой марке.
        Угол заливания ограничивает площади под кривой GZ в справке по KN.
      </Hint>
      <SelectField
        label="Критерии для справки по KN"
        value={p.criteriaSet ?? 'is-code-a'}
        options={[
          { value: 'is-code-a', label: 'IS Code, часть A 2.2' },
          { value: 'osv-b245', label: 'Судно снабжения, IS Code B 2.4.5' },
        ]}
        onChange={(v) => set({ criteriaSet: v })}
      />
    </Group>
  )
}

function LightshipGroup({ particulars: p, open }: { particulars: VesselParticulars; open: boolean }) {
  const set = useCalculator((s) => s.setVesselParticulars)
  const lcgHint = lightshipLcgHint(p)
  return (
    <Group title="Порожнее судно" summary={p.lightshipWeightKg > 0 ? `${fmtNumber(p.lightshipWeightKg / 1000)} т · KG ${fmtNumber(p.lightshipKG)} м` : 'не задано'} open={open}>
      <div className="grid grid-cols-2 gap-2">
        <NumberInput label="Вес" unit="т" value={p.lightshipWeightKg / 1000} min={0} onCommit={(v) => set({ lightshipWeightKg: v * 1000 })} />
        <NumberInput label="KG" unit="м" value={p.lightshipKG} onCommit={(v) => set({ lightshipKG: v })} />
        <NumberInput label="LCG" unit="м" value={p.lightshipLCG} onCommit={(v) => set({ lightshipLCG: v })} />
        <NumberInput label="TCG, + правый борт" unit="м" value={p.lightshipTCG} onCommit={(v) => set({ lightshipTCG: v })} />
      </div>
      <SelectField
        label="Точка отсчёта LCG, LCB и LCF"
        value={p.longitudinalOrigin}
        options={[
          { value: 'midships', label: 'От миделя' },
          { value: 'aft-perpendicular', label: 'От кормового перпендикуляра' },
        ]}
        onChange={(v) => set({ longitudinalOrigin: v })}
      />
      <Hint>
        Порожнее судно, танки, гидростатика и положение палубы по длине — на одной оси. От точки отсчёта зависят осадки носом и кормой.
      </Hint>
      {lcgHint && <Hint tone="warn">{lcgHint}</Hint>}
    </Group>
  )
}

const LIMIT_COLUMNS: Record<StabilityLimit['kind'], ValueColumn[]> = {
  'min-gm-by-draft': [
    { key: 'arg', label: 'Осадка', unit: 'м', min: 0 },
    { key: 'value', label: 'GM мин.', unit: 'м' },
  ],
  'max-kg-by-displacement': [
    { key: 'arg', label: 'Водоизмещение', unit: 'т', min: 0 },
    { key: 'value', label: 'KG макс.', unit: 'м' },
  ],
}

function LimitGroup({ vessel, open }: { vessel: VesselStabilityData; open: boolean }) {
  const setLimit = useCalculator((s) => s.setStabilityLimit)
  const limit = vessel.limit
  const kind = limit?.kind ?? 'min-gm-by-draft'
  const rows = limit?.rows ?? []
  // A displacement is kept in kg, like the hydrostatics, and shown in t.
  const scale = kind === 'max-kg-by-displacement' ? 1000 : 1
  const sorted = (r: StabilityLimit['rows']) => [...r].sort((a, b) => a.arg - b.arg)
  const write = (next: StabilityLimit['rows'], patch: Partial<StabilityLimit> = {}) => setLimit({ kind, rows: next, source: limit?.source, ...patch })
  const toRow = (cells: CellValue[]) => ({ arg: (num(cells[0]) ?? 0) * scale, value: num(cells[1]) ?? 0 })
  const minGM = vessel.particulars.minGM
  const sourceId = useId()

  return (
    <Group title="Предел по формуляру" summary={rows.length > 0 ? rowsWord(rows.length) : 'не задан'} open={open}>
      <SelectField
        label="Вид предела"
        value={kind}
        options={[
          { value: 'min-gm-by-draft', label: 'Мин. GM по осадке' },
          { value: 'max-kg-by-displacement', label: 'Макс. KG по водоизмещению' },
        ]}
        onChange={(v) => {
          if (v === kind) return
          if (rows.length > 0) toast.info('Таблица предела очищена: у другого вида другие столбцы. Вернуть — Ctrl+Z')
          setLimit({ kind: v, rows: [], source: limit?.source })
        }}
      />
      <ValueTable
        label="Предел по формуляру"
        columns={LIMIT_COLUMNS[kind]}
        rows={rows.map((r) => [r.arg / scale, r.value])}
        onChange={(r, c, v) => write(rows.map((row, i) => (i !== r ? row : c === 0 ? { ...row, arg: (num(v) ?? 0) * scale } : { ...row, value: num(v) ?? 0 })))}
        onAdd={(cells) => write(sorted([...rows, toRow(cells)]))}
        onRemove={(r) => write(rows.filter((_, i) => i !== r))}
        onPaste={(pasted) => write(sorted(pasted.map(toRow)))}
        addLabel="Добавить строку"
        emptyText={`Предел не задан: проверяется только общий минимум GM ${G_METACENTRIC_MIN_SAFE} м, итог не выше ⚠.`}
      />
      <div className="space-y-1">
        <label htmlFor={sourceId} className="block text-xs text-ink-2">
          Источник
        </label>
        <TextField
          id={sourceId}
          value={limit?.source ?? ''}
          placeholder="Информация об остойчивости, табл. …"
          onCommit={(v) => setLimit({ kind, rows, source: v.trim() || undefined })}
          className="h-8 text-sm"
        />
      </div>
      <Hint>Между строками — линейно. За таблицей предела нет, итог тогда ⚠. Предел по KG сравнивается с KG с поправкой на свободную поверхность.</Hint>
      {minGM !== undefined && <Hint tone="warn">Было: мин. GM {fmtNumber(minGM)} м — одно число без осадки, в таблицу не перенесено.</Hint>}
    </Group>
  )
}

const TANK_COLUMNS: ValueColumn[] = [
  { key: 'name', label: 'Название', kind: 'text' },
  { key: 'weight', label: 'Вес', unit: 'т', min: 0 },
  { key: 'vcg', label: 'VCG', unit: 'м' },
  { key: 'tcg', label: 'TCG', unit: 'м' },
  { key: 'lcg', label: 'LCG', unit: 'м' },
  { key: 'fsm', label: 'FSM', unit: 'т·м', optional: true, min: 0 },
]

const tankFrom = (cells: CellValue[]): Omit<VariableWeightItem, 'id'> => ({
  name: (typeof cells[0] === 'string' && cells[0].trim()) || 'Танк',
  weightKg: (num(cells[1]) ?? 0) * 1000,
  vcgM: num(cells[2]) ?? 0,
  tcgM: num(cells[3]) ?? 0,
  lcgM: num(cells[4]) ?? 0,
  freeSurfaceMomentTm: num(cells[5]),
})

const TANK_FIELD: (keyof Omit<VariableWeightItem, 'id'>)[] = ['name', 'weightKg', 'vcgM', 'tcgM', 'lcgM', 'freeSurfaceMomentTm']

function TanksGroup({ vessel, open }: { vessel: VesselStabilityData; open: boolean }) {
  const [state, setState] = useState<LoadingState>('departure')
  const addTank = useCalculator((s) => s.addVariableWeight)
  const updateTank = useCalculator((s) => s.updateVariableWeight)
  const removeTank = useCalculator((s) => s.removeVariableWeight)
  const setTanks = useCalculator((s) => s.setVariableWeights)
  const copyDeparture = useCalculator((s) => s.copyDepartureToArrival)
  const tanks = weightsInState(vessel, state)
  const sameAsDeparture = vessel.arrivalWeights === undefined
  const labelId = useId()

  return (
    <Group
      title="Танки и запасы"
      summary={`отход ${vessel.variableWeights.length} · приход ${sameAsDeparture ? '= отход' : vessel.arrivalWeights!.length}`}
      open={open}
    >
      <span id={labelId} className="sr-only">
        Танки для состояния
      </span>
      <ToggleGroup
        type="single"
        value={state}
        onValueChange={(v) => v && setState(v as LoadingState)}
        aria-labelledby={labelId}
        className="grid grid-cols-2 gap-1"
      >
        <ToggleGroupItem value="departure" className="h-8 rounded-md border text-xs data-[state=on]:border-line-strong data-[state=on]:bg-accent data-[state=on]:font-medium">
          Отход
        </ToggleGroupItem>
        <ToggleGroupItem value="arrival" className="h-8 rounded-md border text-xs data-[state=on]:border-line-strong data-[state=on]:bg-accent data-[state=on]:font-medium">
          Приход
        </ToggleGroupItem>
      </ToggleGroup>
      {sameAsDeparture && vessel.variableWeights.length > 0 && (
        <Hint tone="warn">Отход совпадает с приходом — проверьте. Правка прихода начинается с копии отхода.</Hint>
      )}
      <ValueTable
        label={`Танки и запасы: ${state === 'departure' ? 'отход' : 'приход'}`}
        columns={TANK_COLUMNS}
        rows={tanks.map((w) => [w.name, w.weightKg / 1000, w.vcgM, w.tcgM, w.lcgM, w.freeSurfaceMomentTm])}
        rowKeys={tanks.map((w) => w.id)}
        onChange={(r, c, v) => {
          const field = TANK_FIELD[c]
          const value = field === 'name' ? String(v ?? '') : field === 'weightKg' ? (num(v) ?? 0) * 1000 : field === 'freeSurfaceMomentTm' ? num(v) : (num(v) ?? 0)
          updateTank(tanks[r].id, { [field]: value }, state)
        }}
        onAdd={(cells) => addTank(tankFrom(cells), state)}
        onRemove={(r) => removeTank(tanks[r].id, state)}
        onPaste={(pasted) => setTanks(pasted.map(tankFrom), state)}
        addLabel="Добавить строку"
        emptyText="Танков нет. Без них GM считается по порожнему судну и грузу, итог не выше ⚠."
      />
      {state === 'arrival' && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => {
            if (!sameAsDeparture) toast.info('Приход заменён копией отхода. Вернуть — Ctrl+Z')
            copyDeparture()
          }}
        >
          <Copy className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Скопировать из отхода
        </Button>
      )}
      <Hint>
        TCG + — правый борт. FSM — момент свободной поверхности по таблицам танков: пусто — танк запрессован или пуст, 0 — проверено,
        свободной поверхности нет.
      </Hint>
    </Group>
  )
}

function IcingGroup({ particulars: p, open }: { particulars: VesselParticulars; open: boolean }) {
  const set = useCalculator((s) => s.setVesselParticulars)
  const icing = useCalculator((s) => s.deck.icing ?? false)
  const setIcing = useCalculator((s) => s.setIcing)
  const switchId = useId()
  return (
    <Group title="Обледенение" summary={icing ? 'учитывается' : 'нет'} open={open}>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={switchId} className="text-sm">
          Учитывать обледенение
        </label>
        <Switch id={switchId} checked={icing} onCheckedChange={setIcing} />
      </div>
      <Hint>Лёд добавляется к приходу: 30 кг/м² на палубы и верх груза, 7,5 кг/м² на борт с каждой стороны.</Hint>
      <div className="grid grid-cols-2 gap-2">
        <NumberInput
          label="Боковая площадь судна без груза"
          unit="м²"
          value={p.windageAreaM2}
          min={0}
          onCommit={(v) => set({ windageAreaM2: v })}
          onClear={() => set({ windageAreaM2: undefined })}
        />
        <NumberInput
          label="Высота её центра над ватерлинией"
          unit="м"
          value={p.windageLeverM}
          onCommit={(v) => set({ windageLeverM: v })}
          onClear={() => set({ windageLeverM: undefined })}
        />
        <NumberInput
          label="Открытые палубы вне грузовой"
          unit="м²"
          value={p.otherExposedDeckAreaM2}
          min={0}
          onCommit={(v) => set({ otherExposedDeckAreaM2: v })}
          onClear={() => set({ otherExposedDeckAreaM2: undefined })}
        />
        <NumberInput
          label="Их высота над килем"
          unit="м"
          value={p.otherExposedDeckVcgM}
          onCommit={(v) => set({ otherExposedDeckVcgM: v })}
          onClear={() => set({ otherExposedDeckVcgM: undefined })}
        />
      </div>
      <Hint>0 — такой площади нет, пусто — не задано.</Hint>
    </Group>
  )
}

function FrameGroup({ particulars: p, open }: { particulars: VesselParticulars; open: boolean }) {
  const frame = useCalculator((s) => s.deck.shipFrame) ?? DEFAULT_SHIP_FRAME
  const setFrame = useCalculator((s) => s.setShipFrame)
  const forward = useCalculator((s) => s.deck.deckForwardIsPositiveY ?? true)
  const width = useCalculator((s) => s.deck.width)
  const length = useCalculator((s) => s.deck.length)
  const bow = DRAWING_EDGE_WORD[hullSideEdges(width, length, forward).bow]
  return (
    <Group title="Система координат палубы" summary={`нос ${bow}`} open={open}>
      <div className="grid grid-cols-2 gap-2">
        <NumberInput
          label="Центр палубы от ДП, + правый борт"
          unit="м"
          value={frame.originOffsetFromCenterlineM}
          onCommit={(v) => setFrame({ originOffsetFromCenterlineM: v })}
        />
        <NumberInput
          label={p.longitudinalOrigin === 'aft-perpendicular' ? 'Центр палубы от КП' : 'Центр палубы от миделя'}
          unit="м"
          value={frame.originOffsetFromMidshipsM}
          onCommit={(v) => setFrame({ originOffsetFromMidshipsM: v })}
        />
        <NumberInput
          label="Высота палубы над килем"
          unit="м"
          value={frame.heightAboveBaselineM}
          onCommit={(v) => setFrame({ heightAboveBaselineM: v })}
          hint="Она же высота борта для надводного борта"
        />
      </div>
      {/* Set with the deck, in «Судно» → «Палуба» (spec 8.1, A.6). */}
      <p className="text-xs text-ink-2">Нос на схеме: {bow}. Меняется в разделе «Судно», блок «Палуба»</p>
    </Group>
  )
}

const HYDRO_COLUMNS: ValueColumn[] = [
  { key: 'disp', label: 'Водоизм.', unit: 'т', min: 0 },
  { key: 'draft', label: 'Осадка', unit: 'м', min: 0 },
  { key: 'km', label: 'KM', unit: 'м' },
  { key: 'lcb', label: 'LCB', unit: 'м', optional: true },
  { key: 'lcf', label: 'LCF', unit: 'м', optional: true },
  { key: 'mtc', label: 'MTC', unit: 'т·м/см', optional: true, min: 0 },
]

const pointFrom = (cells: CellValue[]): HydrostaticPoint => ({
  displacementKg: (num(cells[0]) ?? 0) * 1000,
  draftM: num(cells[1]) ?? 0,
  KM: num(cells[2]) ?? 0,
  LCB: num(cells[3]),
  LCF: num(cells[4]),
  MTC: num(cells[5]),
})

const byDisplacement = <T extends { displacementKg: number }>(rows: T[]) => [...rows].sort((a, b) => a.displacementKg - b.displacementKg)

function HydrostaticsGroup({ points, open }: { points: HydrostaticPoint[]; open: boolean }) {
  const setPoints = useCalculator((s) => s.setHydrostaticPoints)
  const updatePoint = useCalculator((s) => s.updateHydrostaticPoint)
  const removePoint = useCalculator((s) => s.removeHydrostaticPoint)
  const field: (keyof HydrostaticPoint)[] = ['displacementKg', 'draftM', 'KM', 'LCB', 'LCF', 'MTC']
  return (
    <Group title="Гидростатика" summary={points.length > 0 ? rowsWord(points.length) : 'не задана'} open={open}>
      <ValueTable
        label="Гидростатика"
        columns={HYDRO_COLUMNS}
        rows={points.map((pt) => [pt.displacementKg / 1000, pt.draftM, pt.KM, pt.LCB, pt.LCF, pt.MTC])}
        onChange={(r, c, v) => updatePoint(r, { [field[c]]: c === 0 ? (num(v) ?? 0) * 1000 : c < 3 ? (num(v) ?? 0) : num(v) })}
        onAdd={(cells) => setPoints(byDisplacement([...points, pointFrom(cells)]))}
        onRemove={removePoint}
        onPaste={(pasted) => setPoints(byDisplacement(pasted.map(pointFrom)))}
        addLabel="Добавить строку"
        emptyText="Без гидростатики остойчивость не считается."
      />
      <Hint>
        LCB и MTC нужны для дифферента, LCF — для осадок носом и кормой. Между строками — линейно; за таблицей берётся крайняя строка, и числа
        помечаются «оценка».
      </Hint>
    </Group>
  )
}

// «0; 10; 20» or «0 10 20» or «0,10,20»: heel angles in degrees.
function parseAngles(text: string): number[] | null {
  const cleaned = text.replace(/°/g, ' ').trim()
  if (!cleaned) return null
  const parts = /[;\s]/.test(cleaned) ? cleaned.split(/[;\s]+/).filter(Boolean) : cleaned.split(',')
  const angles = parts.map((p) => Number(p.replace(',', '.')))
  return angles.every((a) => Number.isFinite(a)) ? angles : null
}

function KnGroup({ curves, open }: { curves: KNCrossCurves | undefined; open: boolean }) {
  const setCurves = useCalculator((s) => s.setKNCrossCurves)
  const [angleError, setAngleError] = useState<string | null>(null)
  const anglesId = useId()
  const angles = curves?.headingAngles ?? []
  const points = curves?.points ?? []
  const problem = curves ? knCurvesProblem(curves) : null
  const columns: ValueColumn[] = [{ key: 'disp', label: 'Водоизм.', unit: 'т', min: 0 }, ...angles.map((a, i) => ({ key: `a${i}`, label: `${fmtNumber(a)}°` }))]
  const write = (next: KNCrossCurves['points']) => setCurves({ headingAngles: angles, points: next })
  const pointFromCells = (cells: CellValue[]) => ({ displacementKg: (num(cells[0]) ?? 0) * 1000, KNByAngle: cells.slice(1).map((c) => num(c) ?? 0) })

  return (
    <Group title="KN-кривые" summary={curves ? `${angles.length} ${pluralRu(angles.length, 'угол', 'угла', 'углов')} × ${rowsWord(points.length)}` : 'нет'} open={open}>
      <div className="space-y-1">
        <label htmlFor={anglesId} className="block text-xs text-ink-2">
          Углы крена, °
        </label>
        <TextField
          id={anglesId}
          value={angles.map(fmtNumber).join('; ')}
          placeholder="0; 10; 20; 30; 40; 50; 60"
          className="h-8 text-sm"
          onCommit={(text) => {
            const next = parseAngles(text)
            if (!next) return setAngleError('Углы — числа через точку с запятой или пробел: 0; 10; 20; 30')
            if (points.length > 0 && next.length !== angles.length)
              return setAngleError(`Углов должно быть столько же, сколько столбцов KN (${angles.length}). Чтобы сменить их число, вставьте таблицу заново.`)
            setAngleError(null)
            setCurves({ headingAngles: next, points })
          }}
        />
        {angleError && (
          <p role="alert" className="text-xs text-danger">
            {angleError}
          </p>
        )}
      </div>
      <ValueTable
        label="KN-кривые"
        columns={columns}
        rows={points.map((pt) => [pt.displacementKg / 1000, ...angles.map((_, i) => pt.KNByAngle[i])])}
        onChange={(r, c, v) =>
          write(
            points.map((pt, i) =>
              i !== r ? pt : c === 0 ? { ...pt, displacementKg: (num(v) ?? 0) * 1000 } : { ...pt, KNByAngle: pt.KNByAngle.map((k, j) => (j === c - 1 ? (num(v) ?? 0) : k)) }
            )
          )
        }
        onAdd={(cells) => write(byDisplacement([...points, pointFromCells(cells)]))}
        onRemove={(r) => write(points.filter((_, i) => i !== r))}
        onPasteText={(text) => {
          const parsed = parseKnTable(text, angles)
          if ('error' in parsed) return parsed.error
          const next: KNCrossCurves = {
            headingAngles: parsed.angles,
            points: byDisplacement(parsed.rows.map(([d, ...kn]) => ({ displacementKg: d * 1000, KNByAngle: kn }))),
          }
          const wrong = knCurvesProblem(next)
          if (wrong) return wrong
          setCurves(next)
          setAngleError(null)
          return null
        }}
        pasteHint="Первая строка — углы крена (можно с подписью и знаком °), дальше по строке на водоизмещение: водоизмещение в тоннах и KN при каждом угле."
        addLabel="Добавить строку"
        addDisabled={angles.length === 0 ? 'Сначала задайте углы крена или вставьте таблицу со строкой углов' : undefined}
        emptyText="Кривых нет — справка по кривой GZ недоступна. На итог проверки это не влияет."
      />
      {problem && points.length > 0 && <Hint tone="warn">Кривые не читаются — {problem}.</Hint>}
      {curves && (
        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs text-ink-2 hover:text-danger" onClick={() => setCurves(undefined)}>
          <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Удалить кривые KN
        </Button>
      )}
      <Hint>Справка по KN — оценка: кривая GZ и критерии выбранного набора. Итог проверки по ним не меняется.</Hint>
    </Group>
  )
}
