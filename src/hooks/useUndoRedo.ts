'use client'

import { useEffect } from 'react'
import { useStore } from 'zustand'
import { redoCalculator, undoCalculator, useCalculator } from '@/store/calculator'

// Undo and redo of the calculation: whether there is anything to undo or
// redo, for the top bar's buttons, and the keys. Moved out of page.tsx as it
// was (spec 12.3).
export function useUndoRedo() {
  const canUndo = useStore(useCalculator.temporal, (s) => s.pastStates.length > 0)
  const canRedo = useStore(useCalculator.temporal, (s) => s.futureStates.length > 0)

  // Ctrl+Z / Ctrl+Y (and Ctrl+Shift+Z) for undo/redo of cargo & deck-layout
  // history. Skipped while focus is inside a text input/textarea/contentEditable
  // — those fields (width, weight, category, …) have their own native
  // browser undo stack, and hijacking Ctrl+Z there would fight it instead of
  // undoing whatever the user actually meant.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      const key = e.key.toLowerCase()
      if (key !== 'z' && key !== 'y') return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault()
        redoCalculator()
      } else if (key === 'z') {
        e.preventDefault()
        undoCalculator()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  return { canUndo, canRedo }
}
