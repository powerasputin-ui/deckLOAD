'use client'

import './globals.css'
import { ErrorScreen } from '@/components/shell/ErrorScreen'

// The root layout itself failed: this replaces it, so it brings its own
// document and styles (no fonts or theme of the app's — the default ones).
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="ru">
      <body className="font-sans antialiased bg-background text-foreground">
        <title>DeckLoad — ошибка</title>
        <ErrorScreen error={error} retry={retry} />
      </body>
    </html>
  )
}
