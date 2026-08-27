// A small, deliberately extensible library of real-vessel starting points —
// pick one and get a fresh calculation with the deck size and vessel
// stability data (lightship, hydrostatics, variable weights) already filled
// in. Cargo is always left empty; the user places their own.
//
// Every number here is sourced from a real, approved project document
// (ДВТК/638.362241.034 "Проект перевозки труб... Алексей Кузнецов", REV3,
// approved via TRN171-UKIR for the South Kirinskoye field development) —
// see each field's own comment for exactly which table/line it came from.
// Fields the source document does not give are explicitly estimated and
// marked as such in `note`, never silently invented as if they were real.

import type { VesselStabilityData, DeckShipFrame, VariableWeightItem } from './stability'

export interface VesselTemplate {
  id: string
  label: string
  deck: { width: number; length: number } // meters
  vessel: VesselStabilityData
  shipFrame: DeckShipFrame
  deckForwardIsPositiveY: boolean
  note: string // shown to the user on selection — what's real vs. estimated
}

// Table 3 (LC51 - Max deck cargo Arrival) line items that are NOT the deck
// cargo itself (Deck load/Water in Pipes are left for the user to place as
// real cargo) — crew, stores, liquids, and ballast, each with its own real
// P/LCG/TCG/VCG/FRSM from the document. FRSM left undefined for the three
// items where the table's own FRSM column is blank (crew/provisions/stores)
// rather than reported as a genuine zero.
const kuznetsovVariableWeights: VariableWeightItem[] = [
  { id: 'crew', name: 'Crew and Effects', weightKg: 6_000, lcgM: 65.000, tcgM: 0.000, vcgM: 19.000 },
  { id: 'provisions', name: 'Provisions', weightKg: 20_000, lcgM: 68.800, tcgM: -4.500, vcgM: 12.300 },
  { id: 'ship-stores', name: 'Ship stores', weightKg: 30_000, lcgM: 23.000, tcgM: 0.000, vcgM: 9.400 },
  { id: 'fuel-oil', name: 'Fuel oil', weightKg: 99_200, lcgM: 50.400, tcgM: 0.220, vcgM: 4.680, freeSurfaceMomentTm: 175.8 },
  { id: 'fuel-oil-cargo', name: 'Fuel oil cargo', weightKg: 12_500, lcgM: 45.800, tcgM: -2.780, vcgM: 1.200, freeSurfaceMomentTm: 75.8 },
  { id: 'hydraulic-oil', name: 'Hydraulic oil', weightKg: 1_900, lcgM: 52.940, tcgM: -8.000, vcgM: 2.950, freeSurfaceMomentTm: 0.3 },
  { id: 'lubricating-oil', name: 'Lubricating oil', weightKg: 10_200, lcgM: 53.620, tcgM: -3.670, vcgM: 3.060, freeSurfaceMomentTm: 1.3 },
  { id: 'miscellaneous', name: 'Miscellaneous', weightKg: 120_000, lcgM: 45.330, tcgM: 1.970, vcgM: 3.500, freeSurfaceMomentTm: 208.5 },
  { id: 'pot-water', name: "Ship's pot water", weightKg: 34_100, lcgM: 61.590, tcgM: 0.000, vcgM: 0.480, freeSurfaceMomentTm: 136.4 },
  { id: 'wb-304c', name: 'Water ballast 304C', weightKg: 177_200, lcgM: 38.840, tcgM: 0.000, vcgM: 0.930, freeSurfaceMomentTm: 0 },
  { id: 'wb-31s', name: 'Water ballast 31S', weightKg: 32_000, lcgM: 39.000, tcgM: 9.600, vcgM: 5.100, freeSurfaceMomentTm: 0 },
  { id: 'wb-32c', name: 'Water ballast 32C', weightKg: 410_900, lcgM: 32.730, tcgM: 0.000, vcgM: 2.360, freeSurfaceMomentTm: 0 },
  { id: 'wb-401c', name: 'Water ballast 401C', weightKg: 80_800, lcgM: 23.690, tcgM: 0.000, vcgM: 0.730, freeSurfaceMomentTm: 0 },
  { id: 'wb-501c', name: 'Water ballast 501C', weightKg: 36_200, lcgM: 9.250, tcgM: -0.010, vcgM: 0.600, freeSurfaceMomentTm: 0 },
]

export const VESSEL_TEMPLATES: VesselTemplate[] = [
  {
    id: 'aleksey-kuznetsov',
    label: 'Алексей Кузнецов (ПБУ, IMO 9692648)',
    // Real total/usable cargo-deck AREA (860/830 m²) is now confirmed by TWO
    // independent real sources (the ДВТК project document and FEMCO's own
    // technical specification sheet, both giving 860/830 m² exactly), but
    // neither gives a published or GA-drawing exact width×length split —
    // estimated as width ≈ 17 m (typical clear deck width for this beam
    // class, main-deck breadth 20 m minus bulwark/walkway) and
    // length = 830/17 ≈ 49 m. Flagged to the user in `note`.
    deck: { width: 17, length: 49 },
    vessel: {
      particulars: {
        name: 'Алексей Кузнецов',
        lengthBpp: 77.20, // real — "Длина между перпендикулярами"
        breadth: 20.00, // real — "Ширина на миделе"
        lightshipWeightKg: 4_048_700, // real — "Водоизмещение порожнем Δ0"
        lightshipKG: 7.758, // real — "Ордината ЦТ от ОП zg"
        // Real — "Абсцисса ЦТ от КП xg" = 41.213 m, measured from the aft
        // perpendicular. DeckLoad's longitudinalOrigin field does not
        // actually affect any calculation (confirmed by reading
        // src/lib/stability.ts — it is never read outside its own type
        // declaration), so "from AP" is used here as the one consistent
        // axis for lightshipLCG, the hydrostatic LCB, and shipFrame's own
        // offset below — not because the app enforces that consistency,
        // but because nothing else will.
        lightshipLCG: 41.213,
        lightshipTCG: 0, // not reported in the source document (no nonzero value given)
        longitudinalOrigin: 'aft-perpendicular',
      },
      hydrostatics: {
        points: [
          // Real — single point from the document's own worked case
          // (LC51-Max deck cargo Arrival): Δ, draft, KM, LCB, MTC exactly
          // as computed there. LCF was not given.
          { displacementKg: 7_456_680, draftM: 5.873, KM: 9.604, LCB: 33.829, MTC: 98.320 },
        ],
      },
      variableWeights: kuznetsovVariableWeights,
      // knCurves intentionally omitted — the source document does not
      // include a KN cross-curve table (it references one only as an
      // external, unprovided source, [4] "Final Stability Calculation").
    },
    shipFrame: {
      originOffsetFromCenterlineM: 0, // TCG values above are already "from centerline" — no shift needed
      // Estimated: places deck-local y=0 (the aft edge of the modeled
      // deck rectangle) at ~3 m from the aft perpendicular, matching
      // where the source drawing's cargo area appears to begin. Not a
      // measured figure — see `note`.
      originOffsetFromMidshipsM: 27.5,
      heightAboveBaselineM: 8.40, // real — "Высота борта на миделе" (depth at midships)
    },
    deckForwardIsPositiveY: true,
    note:
      'Судно, лёгкое судно, гидростатика (1 точка) и танки/расходники — из реального утверждённого проекта (ДВТК/638.362241.034). ' +
      'Площадь палубы (860/830 м²) подтверждена ВТОРЫМ независимым источником — технической спецификацией FEMCO — точно совпадает. ' +
      'Размеры палубы (17×49 м) и продольное положение палубы на корпусе — по-прежнему ОЦЕНКА (ни один источник не даёт точный GA-чертёж с разбивкой ширина×длина). ' +
      'ВНИМАНИЕ — конфликт по допустимой нагрузке на палубу: спецификация FEMCO указывает 10 т/м², а рабочий пример из проекта ДВТК явно использует лимит 5,0 т/м² ' +
      '(«Допустимое давление груза на палубу не должно превышать g = 5,0 т/м²»). Это НЕ разрешено автоматически — при создании зоны нагрузки на палубе сверьте, ' +
      'какой лимит актуален для конкретной операции, прежде чем полагаться на предупреждения о перегрузке. ' +
      'Справочно: максимальная грузоподъёмность палубы (Deck Cargo capacity) по FEMCO — 2550 т. ' +
      'Кросс-кривые KN в документах отсутствуют — недоступна полная кривая GZ. Сверьте перед реальным рейсом.',
  },
]
