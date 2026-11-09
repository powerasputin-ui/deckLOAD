# DeckLoad

Планировщик палубного груза: раскладка штабелей по палубе судна, рейсы, вес и
нагрузка на палубу, остойчивость, крепление, план и отчёт в PDF.

## Что нужно

- [Bun](https://bun.sh) 1.4 — им запускаются все скрипты, зависимости ставятся
  только по `bun.lock`.
- Node.js 22 или новее — под ним Next.js запускает свой CLI в `bun run dev`.

## Запуск

```sh
bun install --frozen-lockfile
bun run dev                  # http://localhost:3000, вывод дублируется в dev.log
```

Как в проде:

```sh
bun run build
bun run start                # порт из PORT (по умолчанию 3000), вывод — и в server.log
```

## Проверки

```sh
bunx tsc --noEmit            # типы
bun run lint                 # ESLint, без единого предупреждения
bun run test:ci              # unit-тесты (Vitest)
bun run test:cov             # они же с покрытием по файлам: coverage/index.html
bun run test:e2e             # сценарии в браузере (Playwright)
```

Для e2e нужен Chromium: `bunx playwright install chromium`, либо путь к уже
установленному в `E2E_CHROMIUM_PATH`. Сервер для e2e Playwright собирает и
поднимает сам на порту 3210 (другой — в `E2E_PORT`). Если на порту уже работает
DeckLoad другой сборки — например, сервер, оставшийся от прошлого прогона, —
набор не запустится: остановите его (или `E2E_ANY_BUILD=1`, чтобы проверить
именно его).

CI (GitHub Actions) на каждый push в `main` прогоняет то же самое, а на Windows
ещё и запускает `bun run start` с Bun, поставленным через npm.

## Выкладка

Vercel собирает и выкладывает `main` при каждом push.

## Где что

| Папка | Что там |
|---|---|
| `src/lib` | расчёты: `packing.ts` — раскладка, `stability*.ts` — остойчивость, `checks.ts` — проверки, `planDrawing.ts` и `exportPdf.ts` — план и PDF |
| `src/store` | состояние приложения (Zustand): расчёт, проекты, библиотека судов |
| `src/components` | интерфейс |
| `e2e` | сценарии Playwright |
| `docs/superpowers/specs` | спецификации: что и почему так устроено |
| `docs/superpowers/plans` | планы этапов |
