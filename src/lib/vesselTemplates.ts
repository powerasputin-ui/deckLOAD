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
import type { RestrictionZone } from './packing'

export interface VesselTemplate {
  id: string
  label: string
  // Non-rectangular real deck silhouette (from a GA drawing, say) — deck-
  // local coords in the same [0,width]x[0,length] frame as DeckConfig.outline.
  // Undefined = plain rectangle (today's default for every template that
  // doesn't have a real outline to draw from).
  deck: { width: number; length: number; outline?: { x: number; y: number }[] } // meters
  // A template built from pure geometry (a GA drawing) may have NO stability
  // data at all — no lightship weight/KG, no hydrostatics, nothing a real
  // loading manual would carry. Optional rather than a fabricated zeroed
  // VesselStabilityData: the app already shows an honest "Заполните данные
  // судна" prompt when deck.vessel is undefined (StabilityPanel), so a
  // geometry-only template just leaves stability unset instead of lying
  // with invented numbers.
  vessel?: VesselStabilityData
  shipFrame?: DeckShipFrame
  deckForwardIsPositiveY?: boolean
  // Hard-blocked obstacles on the real deck (hatches, moon pool, crane
  // pedestals, etc.) — seeded onto the new project's deck.restrictionZones
  // on apply, same mechanism a user could draw by hand, just pre-filled
  // from the real drawing.
  restrictionZones?: RestrictionZone[]
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
    label: 'Алексей Кузнецов (IMO 9692648)',
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
      // Estimated: places the modeled deck rectangle's own CENTRE (see
      // DeckShipFrame's doc comment in stability.ts — offsets locate the
      // deck's centre, not its y=0 edge) at 27.5 m from the aft
      // perpendicular, i.e. its aft edge at 27.5 − 49.1/2 ≈ 2.95 m from
      // AP, matching where the source drawing's cargo area appears to
      // begin. Not a measured figure — see `note`.
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
  {
    id: 'olympic-commander',
    label: 'Коммандер (IMO 9340609)',
    // Source: real GA (General Arrangement) drawing — "101-100 (1960-11)_A
    // GA Commander.pdf" (Marin Teknikk, project MT6016, Olympic Shipping
    // A.S.), Main Deck plan. This is a GEOMETRY drawing, not a stability
    // booklet — see `note` for exactly what it does and doesn't give us.
    //
    // Real, printed on the drawing: Length o.a. 92.95 m, LBP 86.60 m,
    // Breadth 19.70 m, Depth maindeck 7.70 m. Cargo deck area is labelled
    // directly: "LxB=51mx16m = 815 m2" — used here AS-IS for both
    // deck.width and deck.length; no outline needed, the cargo deck really
    // is a plain rectangle (see correction note below).
    //
    // CORRECTED (previous version of this template used deck.length=62 and
    // a narrowing outline — that was wrong, not a "wrong deck" mistake but a
    // bad frame-spacing guess). The first pass assumed ~0.6 m/frame without
    // checking it against any printed number. A pixel-accurate re-check of
    // the actual PDF render (numpy analysis of the frame-ruler tick spacing
    // and the yellow cargo-deck fill) gives a consistent ~94.12 px/m in BOTH
    // axes, confirmed two independent ways: the deck's own pixel width
    // against the printed 16 m, and the pixel length of the full-width run
    // against the printed "51 m" — i.e. the real spacing is ~0.729 m/frame,
    // not 0.6. Under the wrong 0.6 figure the deck's full-width run looked
    // like it ended at frame 80 (48 m) with a narrow strip continuing to
    // frame 103 (62 m); under the correct spacing the full-width run ends
    // EXACTLY at frame 70 (=51 m, matching the printed figure almost
    // exactly: 51x16=816 m^2 vs printed 815 m^2). What's actually past frame
    // 70 is not a narrow continuation of open deck at all — it's enclosed
    // superstructure (ROV-Workshop, EL-Workshop, ROV-Control Room, Coffee
    // Shop, Locker room, Laundry), with both "net opening" cutouts and an
    // unlabelled "FLUSH HATCH" sitting inside THAT block, not on the cargo
    // deck. So the honest model is the plain printed rectangle, full stop —
    // no outline, and the two net-opening restriction zones are dropped
    // (they were never really on this deck to begin with).
    deck: {
      width: 16, // real, printed
      length: 51, // real, printed (LxB=51x16=815 m^2)
    },
    // No stability booklet on hand for this vessel — a GA drawing carries
    // none of lightship weight/KG/LCG, hydrostatics, GMmin, or KN curves.
    // Deliberately left undefined rather than filled with invented numbers;
    // the app already shows an honest "Заполните данные судна" prompt
    // instead of a fabricated PASS/FAIL. Deck/cargo/auto-placement work
    // fully regardless — that side has no dependency on stability data.
    // limits also omitted — deck-strength/total-capacity figures live in a
    // separate loading manual, not on a GA drawing.
    restrictionZones: [
      {
        id: 'og-hatch',
        // No printed dimensions for this one — position and size both
        // measured directly off pixels in a numpy-analyzed render of the
        // PDF (edge-detected against the drawing's own frame ruler, at the
        // corrected ~94.12 px/m scale established above), not eyeballed.
        // Sits almost exactly centered across the deck's 16 m width.
        name: 'Люк/вырез в палубе (оценка размера и позиции)',
        shapeType: 'rect',
        x: 5,
        y: 41, // ~frame 56
        width: 6,
        length: 7, // ~frame 56-66
      },
    ],
    note:
      'Источник: реальный GA-чертёж (Marin Teknikk, проект MT6016, «101-100 (1960-11)_A GA Commander.pdf»), план Main Deck ' +
      '(подпись рамкой «MAIN DECK» на самом плане, порядок палуб в профиле судна подтверждает — Shelter Deck выше по чертежу). ' +
      'РЕАЛЬНОЕ: длина 92,95 м, LBP 86,60 м, ширина 19,70 м, грузовая палуба подписана прямо как 51×16 = 815 м² — ' +
      'использовано как есть, палуба ПРОСТОЙ прямоугольник (51×16=816 м² почти точно сходится с печатной цифрой). ' +
      'ИСПРАВЛЕНО: в первой версии здесь стояла длина 62 м и контур с сужением до узкой полосы за шп. 80 — это была ошибка ' +
      'неверно угаданной шпации (~0,6 м/шп. без проверки по печатным числам), а не спутанная палуба. Повторная пиксель-точная ' +
      'проверка (numpy-анализ рендера чертежа, а не «на глаз») даёт согласованную шпацию ~0,729 м/шп. (сверено дважды: ' +
      'ширина палубы в пикселях против печатных 16 м, и длина участка полной ширины в пикселях против печатных 51 м) — ' +
      'участок полной ширины на самом деле заканчивается ровно на шп. 70 (=51 м). То, что дальше похоже на «узкую полосу», ' +
      'на самом деле не открытая палуба, а закрытые помещения (ROV-Workshop, EL-Workshop, ROV-Control Room, Coffee Shop, ' +
      'Locker room, Laundry) — оба «net opening» и неразмеченный «FLUSH HATCH» физически лежат ВНУТРИ этого блока, не на ' +
      'грузовой палубе, поэтому убраны из модели вместе с контуром. Единственный реальный вырез ВНУТРИ честных 0–51 м — ' +
      'люк/moon pool без подписанных размеров; позиция и размер измерены пиксель-точно по тому же методу (не «на глаз»), ' +
      'сидит почти строго по центру ширины палубы. НЕТ ДАННЫХ ОБ ОСТОЙЧИВОСТИ: это чертёж общего расположения, не книга ' +
      'остойчивости — лёгкий вес, ЦТ, гидростатика, допустимый GM, кросс-кривые KN на нём не приведены и здесь не заполнены ' +
      '(не выдуманы). Расчёт остойчивости для этого судна будет недоступен, пока такие данные не появятся — раздел ' +
      'палубы/груза/автораспределения на это никак не завязан. Лимиты по нагрузке на палубу (т/м²) и общей грузоподъёмности ' +
      'также не заполнены — это отдельный документ (loading manual), которого нет на руках. Не включены в эту версию ' +
      '(сознательно отложено): 4 мелких объекта у кормы (склады/вентшахты) в пределах честных 0–51 м — на чертеже без ' +
      'подписанных размеров, точность оценки ниже; и основания кранов.',
  },
]
