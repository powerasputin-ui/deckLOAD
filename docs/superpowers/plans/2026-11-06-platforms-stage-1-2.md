# Платформы, этапы 1 и 2: вид объекта, стационарная платформа, ППБУ

План по спецификации `docs/superpowers/specs/2026-11-06-platforms-design.md`, разделы 3–9.

## Что меняется для пользователя

- На стартовом экране — «Начать с платформы»: выбор ППБУ или стационарной платформы.
- Раздел «Судно» у платформы называется «Платформа»: тип объекта, палуба, зоны, препятствия, фото, розетки, пометки; у стационарной — допускаемая нагрузка на палубу; у ППБУ — данные установки, суточный отчёт, прочий приход и расход.
- У груза платформы статус: «на борту», «приход», «отгрузка». План — палуба после рейса.
- У платформы нет рейсов и проверки креплений.
- ППБУ: проверки VDL и KG в рабочем режиме и при уходе в шторм, балласт; в строке состояния — VDL и KG; в PDF — блок с пометкой «оценка для планирования».

## Как работаем

- Группа — отдельный коммит; перед коммитом зелёные `npx tsc --noEmit`, `bun run lint`, `npx vitest run`; перед пушем этапа — e2e.
- Этап — пуш в `claude/youthful-johnson-0c1hlk`, превью, перемотка `main`, CI и продакшен.
- Старые расчёты читаются как суда без изменений: новое поле не задано — судно.
- Расчёт ППБУ — чистые функции в `src/lib/semiSub.ts`, без React и хранилища, с тестом на пример из спеки (KG₁ 20,36 м, KGшт 22,18 м).

## Этап 1

| Группа | Пункты спеки | Основные файлы | Тесты |
|---|---|---|---|
| A. Модель | 3, 9 | новый `src/lib/objectKind.ts`; `store/calculator.ts` (`DeckConfig.objectKind`), `lib/packing.ts` (`CargoItem.platformStatus`), `store/projects.ts`, `lib/vesselTemplates.ts`, `lib/vesselLibrary.ts` | unit: нормализация вида и статуса, библиотека несёт вид |
| B. Главная и названия | 4 | `components/intro/StartScreen.tsx`, `app/page.tsx` (`startFromScreen`), `lib/workflow.ts` (`sectionTitle`), `TopBar.tsx`, `SectionPanel.tsx`, `ChecksSection.tsx` | `page.test.tsx`: «Начать с платформы» → ППБУ создаёт расчёт вида и открывает «Платформа» |
| C. Раздел «Платформа» | 5 | `sections/VesselSection.tsx`, новый `sections/vessel/ObjectKindBlock.tsx`, `VesselCard.tsx` (допускаемая нагрузка), `VesselLibrary.tsx` (вид), `lib/vesselSteps.ts` | unit/компонент: блоки по виду; смена вида сохраняет палубу и грузы |
| D. Статусы груза | 6 | `cargo/CargoList.tsx`, `cargo/CargoTable.tsx`, `sections/CargoSection.tsx`, `hooks/useTrips.ts` | груз «отгрузка» не на плане и в строке «Отгрузка»; новый груз платформы — «приход» |
| E. Без рейсов и креплений | 6, 8 | `hooks/useTrips.ts` (один рейс), `app/page.tsx` (вкладки рейсов, крепления), `lib/checks.ts`, `lib/statusLine.ts`, `shell/Inspector.tsx` | платформа: один рейс, нет проверки креплений, строка без рейсов |
| F. PDF | 8 | `lib/exportPdf.ts` | шапка платформы, «План палубы», статус в таблице, список отгрузки |
| G. Сценарий | — | `e2e/platform.spec.ts` | стационарная платформа: груз «на борту» и «приход», отгрузка, PDF |

## Этап 2: ППБУ

| Группа | Пункты спеки | Основные файлы | Тесты |
|---|---|---|---|
| H. Данные и расчёт | 7.1, 7.2 | новый `src/lib/semiSub.ts`; `store/calculator.ts` (`deck.semiSub`), `store/projects.ts` | unit: пример спеки, нет данных → нет вердикта, осадка вне таблицы, балласта не хватает |
| I. Блоки ППБУ | 5, 7.1 | новые `sections/vessel/SemiSubBlocks.tsx` (режимы, отчёт, прочий приход и расход) | компонент: ввод и вставка таблицы KG |
| J. Проверки и строка состояния | 7.3, 8 | `lib/checks.ts`, `lib/planFacts.ts`, `lib/statusLine.ts`, `app/page.tsx` | проверки по таблице 7.3; «—» без данных |
| K. PDF | 8 | `lib/exportPdf.ts` | блок ППБУ с пометкой об оценке |
| L. Сценарий | — | `e2e/semi-sub.spec.ts` | ППБУ: данные, отчёт, приход труб → VDL и KG, шторм ✕ при перегрузе |

## Этап 3: СПБУ

Спека, раздел 11.

| Группа | Пункты спеки | Основные файлы | Тесты |
|---|---|---|---|
| M. Модель и расчёт | 11.2, 11.3 | `objectKind.ts` (`'jack-up'`), новые `lib/jackUp.ts`, `lib/jackUpPlan.ts`; `store/calculator.ts` (`deck.jackUp`), `store/projects.ts`, библиотека | unit: три опоры — точное решение, четыре — пример спеки, на одной линии — нет решения; на плаву — KG и осадка; нет данных — «—» |
| N. Блоки | 11.2 | `StartScreen.tsx`, `VesselCard.tsx` (четыре вида), новые `sections/vessel/JackUpBlocks.tsx`, общий блок прочего прихода, `vesselSteps.ts` | компонент: опоры, положение, нагрузки из отчёта |
| O. Проверки, строка, PDF | 11.4 | `checks.ts`, `planFacts.ts`, `statusLine.ts`, `exportPdf.ts` | проверки по 11.4; блок PDF |
| P. Сценарий | — | `e2e/jack-up.spec.ts` | на опорах: груз у опоры → её нагрузка выше допустимой ✕; на плаву: KG и осадка |

## Этап 4: площадки на разных уровнях

Спека, раздел 12.

| Группа | Пункты спеки | Основные файлы | Тесты |
|---|---|---|---|
| Q. Уровень зоны | 12.1, 12.2 | `packing.ts` (`LoadZone.elevationM`), `store/projects.ts`, `sections/vessel/LoadZonesBlock.tsx` | хранение: уровень сохраняется, 0 и мусор — нет |
| R. Расчёты | 12.3 | `stability.ts` (`deckLevels`, `levelAt`, `placementLevel`, `lowestDeckLevel`), `stabilityConditions.ts` (VCG, лёд), `planFacts.ts`, `semiSubPlan.ts`, `jackUpPlan.ts` | unit: самая маленькая зона с уровнем, центроид формы, единицы палубы; GM судна с площадкой и нишей; лёд на верху штабеля; приход и отгрузка ППБУ и СПБУ |
| S. Отображение | 12.4 | `deckDrawing.ts` (`zoneLevelSuffix`), `DeckVisualization.tsx`, `planDrawing.ts`, `Deck3DView.tsx`, `page.tsx` | подпись зоны в PDF; e2e: GM в строке состояния при +3, −2, ниже киля и пусто |
