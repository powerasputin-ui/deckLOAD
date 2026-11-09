'use client'

import { ErrorScreen } from '@/components/shell/ErrorScreen'

// A page that fails to render shows ErrorScreen, inside the root layout,
// instead of Next's blank «Application error» page.
export default function PageError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorScreen error={error} retry={retry} />
}
