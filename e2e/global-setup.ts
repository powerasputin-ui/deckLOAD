import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

  // DeckLoad, but which build? A server left running from an earlier build
  // passes the check above and the suite then tests old code — green or red
  // for reasons that are no longer true (audit 2026-11-09). The page names
  // its build: it must be the one just built here.
  let buildId: string | undefined
  try {
    buildId = readFileSync(join(process.cwd(), '.next', 'BUILD_ID'), 'utf8').trim()
  } catch {
    // Nothing built here: nothing to compare against.
  }
  if (buildId && !html.includes(buildId) && !process.env.E2E_ANY_BUILD) {
    throw new Error(
      `${baseURL} is serving a DeckLoad build other than the one in .next (${buildId}) — most likely a server ` +
        `left running from an earlier build. Stop it and run the suite again (it builds and starts its own), ` +
        `or set E2E_ANY_BUILD=1 to test whatever is running.`
    )
  }
}
