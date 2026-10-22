import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { contrastRatio } from './colorScience'
import {
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  THEME_TOKENS,
  parseThemePreference,
  resolveTheme,
  type ThemeName,
  type ThemeTokens,
} from './theme'

// The CSS variable each token lives in (the spec's accent is shadcn's
// --primary, see globals.css).
const CSS_VARIABLE: Record<keyof ThemeTokens, string> = {
  paper: '--paper',
  surface: '--surface',
  ink: '--ink',
  ink2: '--ink-2',
  line: '--line',
  lineStrong: '--line-strong',
  deck: '--deck',
  deckGrid: '--deck-grid',
  deckOutline: '--deck-outline',
  accent: '--primary',
  accentHover: '--primary-hover',
  onAccent: '--primary-foreground',
  ok: '--ok',
  okBg: '--ok-bg',
  warn: '--warn',
  warnBg: '--warn-bg',
  danger: '--danger',
  dangerBg: '--danger-bg',
  inkCargo: '--ink-cargo',
}

const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8')

function declaredIn(selector: ':root' | '.dark'): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  const block = css.slice(start, css.indexOf('}', start))
  return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
}

const THEMES: ThemeName[] = ['light', 'dark']

describe('theme tokens', () => {
  it.each(THEMES)('globals.css declares every %s token with the value theme.ts holds for the deck', (theme) => {
    const declared = declaredIn(theme === 'light' ? ':root' : '.dark')
    for (const [token, variable] of Object.entries(CSS_VARIABLE)) {
      expect(declared[variable]?.toUpperCase(), variable).toBe(THEME_TOKENS[theme][token as keyof ThemeTokens].toUpperCase())
    }
  })

  // Spec 9.1: 4.5:1 for text, 3:1 for input borders and the deck outline.
  const PAIRS: [keyof ThemeTokens, keyof ThemeTokens, number][] = [
    ['ink', 'surface', 4.5],
    ['ink', 'paper', 4.5],
    ['ink2', 'surface', 4.5],
    ['ink2', 'paper', 4.5],
    ['accent', 'surface', 4.5],
    ['accent', 'paper', 4.5],
    ['onAccent', 'accent', 4.5],
    ['ok', 'okBg', 4.5],
    ['warn', 'warnBg', 4.5],
    ['danger', 'dangerBg', 4.5],
    ['lineStrong', 'surface', 3],
    ['deckOutline', 'deck', 3],
  ]
  it.each(THEMES)('%s theme: every text and border pair of 9.1 has enough contrast', (theme) => {
    const t = THEME_TOKENS[theme]
    const short = PAIRS.filter(([fg, bg, min]) => contrastRatio(t[fg], t[bg]) < min).map(
      ([fg, bg]) => `${fg} on ${bg}: ${contrastRatio(t[fg], t[bg]).toFixed(2)}`
    )
    expect(short).toEqual([])
  })

  it('the numbers on cargo are the same dark ink in both themes (the tones are light in both)', () => {
    expect(THEME_TOKENS.dark.inkCargo).toBe(THEME_TOKENS.light.inkCargo)
  })
})

describe('theme choice', () => {
  it('follows the system unless the user picked a theme', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('reads anything unknown as «как в системе»', () => {
    expect(parseThemePreference('dark')).toBe('dark')
    expect(parseThemePreference('light')).toBe('light')
    expect(parseThemePreference(null)).toBe('system')
    expect(parseThemePreference('sepia')).toBe('system')
  })

  // The script runs in <head> before React, so it is checked on its own.
  function runInitScript(stored: string | null, systemDark: boolean) {
    const classes = new Set<string>()
    const root = { classList: { add: (c: string) => classes.add(c) }, style: { colorScheme: '' } }
    const fakeWindow = { matchMedia: () => ({ matches: systemDark }) }
    const fakeStorage = { getItem: (k: string) => (k === THEME_STORAGE_KEY ? stored : null) }
    new Function('localStorage', 'window', 'document', THEME_INIT_SCRIPT)(fakeStorage, fakeWindow, { documentElement: root })
    return { dark: classes.has('dark'), colorScheme: root.style.colorScheme }
  }

  it('the no-flash script picks the same theme as resolveTheme', () => {
    expect(runInitScript('dark', false)).toEqual({ dark: true, colorScheme: 'dark' })
    expect(runInitScript('light', true)).toEqual({ dark: false, colorScheme: 'light' })
    expect(runInitScript(null, true)).toEqual({ dark: true, colorScheme: 'dark' })
    expect(runInitScript(null, false)).toEqual({ dark: false, colorScheme: 'light' })
  })
})
