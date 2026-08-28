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
  // Operational limits, kept as STRUCTURED numbers rather than only as
  // prose inside `note`. A caveat buried in a toast the user dismisses once
  // is not a safety control; a number the app can show, compare against and
  // pre-fill a load zone with is.
  limits?: {
    // t/m². Two real sources disagree for А. Кузнецов (see `note`), so this
    // is a range, not a single figure — the app must not silently pick one.
    deckStrengthTPerM2?: { min: number; max: number; sources: string }
    maxDeckCargoT?: number // total deck cargo capacity
    maxStackHeightM?: number // max permitted cargo stack height
    tenFootContainerCapacity?: number // how many 10' units fit when fully loaded with pipe
    reeferSocketCount?: number // powered sockets for reefer containers
  }
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
    // Width is REAL, read off the document's own worked deck-pressure check
    // (п. 2.1.7): a 756 t stack of ТШ406,4 pipes is laid on
    // "S = 16,9 · 12,37 = 209 м²", where 12.37 m is the pipe length and the
    // pipes are stowed "между внутренними бортовыми стенками" — so 16.9 m is
    // the clear width between the bulwarks. It cross-checks twice over:
    // 16.9 / 0.957 = 17 pipes per row for Ø813 НУБП-72, and the operator's
    // own spreadsheet puts 33 pipes in that stack — exactly 17 + 16, a
    // two-row nest spanning the full width.
    //
    // Length remains an ESTIMATE: 830 m² effective area / 16.9 m ≈ 49.1 m.
    // Total/usable deck AREA (860/830 m²) is itself confirmed by two
    // independent sources (ДВТК and the FEMCO specification sheet).
    deck: { width: 16.9, length: 49.1 },
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
        // Real — Таблица 3 LIGHT SHIP row: "TCG от ДП = −0,020 м"
        // (MTCG = −81,0 т·м). Previously carried here as 0 on the mistaken
        // reading that the document gave no figure; it does, and zeroing it
        // silently erases the vessel's own built-in list bias to port.
        lightshipTCG: -0.02,
        longitudinalOrigin: 'aft-perpendicular',
        // Real — the vessel's OWN approved minimum for this load case,
        // interpolated from the Min GM table in Final Stability Calculation
        // No. 4749-152-006 and quoted in the project document as
        // "Допустимая GMmin = 1,220 м". Over 8x the app's generic 0.15 m
        // reference, so without this the app would show a comfortable green
        // PASS at, say, GM = 1.0 m where the real approved criterion FAILS.
        minGM: 1.22,
        // Real — Приложение Г, п. Г.3.3: "Av = 854,4 м² - парусность" and
        // "zv = 10,347 м – плечо парусности, измеренное от центра
        // парусности до площади действующей ватерлинии".
        windageAreaM2: 854.4,
        windageLeverM: 10.347,
        // Real — FEMCO technical specification, "Block Coefficient 0.814".
        blockCoefficient: 0.814,
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
    limits: {
      // FEMCO technical specification says 10 t/m²; the ДВТК project's own
      // worked example explicitly designs to 5.0 t/m². Both are real, from
      // real documents, and they disagree by a factor of two — so both are
      // carried and the choice is left to the person planning the operation.
      deckStrengthTPerM2: { min: 5.0, max: 10.0, sources: 'ДВТК 5,0 / FEMCO 10,0' },
      maxDeckCargoT: 2550, // FEMCO spec — Deck Cargo
      maxStackHeightM: 3.0, // ДВТК п. 2.1.2 — допустимая высота штабелирования
      tenFootContainerCapacity: 14, // реестр: при полной загрузке трубной продукцией
      reeferSocketCount: 8, // реестр: точек подключения рефконтейнеров
    },
    note:
      'ОЦЕНКА: длина палубы 49,1 м (площадь 830 м² ÷ ширину) и продольное положение палубы на корпусе. ' +
      'Ширина 16,9 м — РЕАЛЬНАЯ, из проверочного расчёта давления (п. 2.1.7: штабель 756 т на S = 16,9 × 12,37 = 209 м², ' +
      'груз уложен между внутренними бортовыми стенками); сходится с укладкой 17+16 труб Ø813 НУБП-72 в штабеле. ' +
      'КОНФЛИКТ ИСТОЧНИКОВ: допустимая нагрузка на палубу — 10 т/м² по FEMCO против 5,0 т/м² в рабочем примере ДВТК. ' +
      'Приложение НЕ выбирает за вас: задавая зону нагрузки, поставьте тот лимит, который актуален для вашей операции. ' +
      'НЕТ ДАННЫХ: кросс-кривые KN отсутствуют в обоих документах — полная кривая GZ и критерии IMO Part A недоступны, ' +
      'считаются только начальная GM, крен и дифферент. Гидростатика — одна точка (Δ=7456,7 т), за её пределами идёт экстраполяция. ' +
      'ЗАБЛОКИРОВАНО: положение палубы по длине судна (shipFrame.originOffsetFromMidshipsM) остаётся оценкой — ' +
      'реальные номера шпангоутов на чертежах укладки есть (граница палубы −7…80, штабели на конкретных шпангоутах), ' +
      'но перевод шпангоутов в метры (шпация) нигде не указан текстом ни в одном документе на руках. Из-за этого LCG груза, ' +
      'размещённого через собственную геометрию приложения, может отличаться от документа на метры — нужен чертёж общего ' +
      'расположения (MW628A-100-02, источник [6] в списке литературы) или прямое указание шпации, чтобы это закрыть. ' +
      'Остальное (лёгкое судно, танки, расходники, допустимая GMmin 1,220 м) — из реального утверждённого проекта ДВТК/638.362241.034.',
  },
]
