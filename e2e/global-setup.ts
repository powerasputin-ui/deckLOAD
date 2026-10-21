import type { FullConfig } from '@playwright/test'

// `reuseExistingServer` attaches to WHATEVER already listens on the port. If
// that is some other app (a different dev server, another project), every spec
// then fails in confusing ways — or passes against the wrong thing. Before
// running anything, confirm the page really is DeckLoad.
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL
  if (!baseURL) throw new Error('playwright.config.ts must set use.baseURL')

  let html: string
  try {
    html = await (await fetch(baseURL)).text()
  } catch (error) {
    throw new Error(`Could not reach ${baseURL} — is the server up? (${String(error)})`)
  }
  if (!html.includes('DeckLoad')) {
    throw new Error(
      `${baseURL} is serving something other than DeckLoad. Stop whatever is using that port, ` +
        `or point the suite at a free one with E2E_PORT=<port>.`
    )
  }
}
