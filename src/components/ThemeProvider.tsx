'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { Toaster } from 'sonner'
import {
  applyThemeClass,
  readThemePreference,
  resolveTheme,
  writeThemePreference,
  type ThemeName,
  type ThemePreference,
} from '@/lib/theme'

interface ThemeContextValue {
  preference: ThemePreference
  resolved: ThemeName
  setPreference: (preference: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  preference: 'system',
  resolved: 'light',
  setPreference: () => {},
})

const DARK_QUERY = '(prefers-color-scheme: dark)'

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches
}

// The class on <html> is set before the first paint by THEME_INIT_SCRIPT;
// this keeps it in step afterwards (the user's choice, or the system theme
// changing while the page is open). Read on the client's first render: the
// app itself renders only after mount (page.tsx's clientReady), so nothing
// themed is hydrated from a server-side guess.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    typeof window === 'undefined' ? 'system' : readThemePreference()
  )
  const [systemDark, setSystemDark] = useState(systemPrefersDark)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(DARK_QUERY)
    const onChange = () => setSystemDark(query.matches)
    query.addEventListener?.('change', onChange)
    return () => query.removeEventListener?.('change', onChange)
  }, [])
  const resolved = resolveTheme(preference, systemDark)
  useEffect(() => {
    applyThemeClass(resolved)
  }, [resolved])
  const setPreference = useCallback((next: ThemePreference) => {
    writeThemePreference(next)
    setPreferenceState(next)
  }, [])
  return <ThemeContext.Provider value={{ preference, resolved, setPreference }}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}

// sonner keeps its own light/dark styles; follow the app's theme rather than
// the system's when the user has picked one.
export function ThemedToaster() {
  const { resolved } = useTheme()
  return <Toaster position="bottom-right" richColors closeButton theme={resolved} />
}
