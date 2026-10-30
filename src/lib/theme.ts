// Interface colour tokens (spec 9.1) — the same values globals.css declares,
// kept in step by theme.test.ts. Components styled with classes read the CSS
// variables; the deck SVG takes these values directly.
export type ThemeName = 'light' | 'dark'
export type ThemePreference = ThemeName | 'system'

export interface ThemeTokens {
  paper: string
  surface: string
  ink: string
  ink2: string
  line: string
  lineStrong: string
  deck: string
  deckGrid: string
  deckOutline: string
  // The spec's `--accent`; in CSS it is shadcn's `--primary` (shadcn's own
  // `--accent` is a hover tint).
  accent: string
  accentHover: string
  onAccent: string
  ok: string
  okBg: string
  warn: string
  warnBg: string
  danger: string
  dangerBg: string
  inkCargo: string
}

export const THEME_TOKENS: Record<ThemeName, ThemeTokens> = {
  light: {
    paper: '#F3F6F9',
    surface: '#FFFFFF',
    ink: '#10243A',
    ink2: '#4B5D70',
    line: '#D6DEE6',
    lineStrong: '#7D8EA0',
    deck: '#E2E8EE',
    deckGrid: '#C9D3DD',
    deckOutline: '#10243A',
    accent: '#C2410C',
    accentHover: '#9A3412',
    onAccent: '#FFFFFF',
    ok: '#1E7B4F',
    okBg: '#E6F4EC',
    warn: '#8F5300',
    warnBg: '#FFF1D6',
    danger: '#B42318',
    dangerBg: '#FDE8E6',
    inkCargo: '#10243A',
  },
  dark: {
    paper: '#0C1724',
    surface: '#122131',
    ink: '#E7EEF6',
    ink2: '#A3B3C4',
    line: '#22354A',
    lineStrong: '#5D7189',
    deck: '#1A2A3B',
    deckGrid: '#2A3D52',
    deckOutline: '#C9D6E3',
    accent: '#FF8A3D',
    accentHover: '#FFA366',
    onAccent: '#10243A',
    ok: '#4CC38A',
    okBg: '#123526',
    warn: '#F0B44C',
    warnBg: '#3A2A0E',
    danger: '#FF7A6E',
    dangerBg: '#3D1614',
    inkCargo: '#10243A',
  },
}

// The choice lives in this browser, not in the calculation: it's how the
// person likes to look at the screen, not part of the plan.
export const THEME_STORAGE_KEY = 'deckload-theme'

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ThemeName {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light'
  return preference
}

export function parseThemePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system'
}

export function readThemePreference(): ThemePreference {
  try {
    return parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return 'system'
  }
}

export function writeThemePreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') localStorage.removeItem(THEME_STORAGE_KEY)
    else localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Storage off (private mode, quota): the theme still applies for this visit.
  }
}

export function applyThemeClass(theme: ThemeName): void {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
}

// Runs in <head> before the first paint, so a dark-theme visitor never sees a
// flash of the light page. Kept in plain ES5 and in step with resolveTheme.
export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem('${THEME_STORAGE_KEY}');var d=p==='dark'||(p!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;if(d)r.classList.add('dark');r.style.colorScheme=d?'dark':'light'}catch(e){}})()`
