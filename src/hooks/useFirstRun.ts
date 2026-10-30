'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'

// The first visit (spec 10.1, 10.2): the start screen, then the five-step
// tour. A visitor who knew the interface before stage 2 gets a one-time note
// instead. Moved out of page.tsx as it was (spec 12.3).

// Once a visitor leaves the start screen, this survives reloads/new tabs so
// it doesn't open every time they come back — the last calculation does.
// The key is the intro video's: whoever saw the video doesn't get the start
// screen on their own.
const INTRO_SEEN_KEY = 'deckload-intro-seen'

// Separate flag from INTRO_SEEN_KEY on purpose — the start screen and the
// product tour are different first-run experiences with independent "seen"
// states: skipping the tour shouldn't bring the start screen back, and vice
// versa.
const TOUR_SEEN_KEY = 'deckload-tour-seen'

// The one-time note for those who knew the interface before stage 2: they've
// seen the old tour, so the new one doesn't start on its own (spec 13, stage
// 2). Whoever has been through the new tour doesn't need it.
const UI_UPDATE_HINT_SEEN_KEY = 'deckload-ui-update-hint-seen'

// Touching window.localStorage at all throws (SecurityError) when the browser
// blocks site data for this page — and the intro/tour flags are read during
// render, so an unguarded read used to replace the whole app with an error
// page. Without storage the flags simply aren't remembered between visits.
function readSeenFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}
function writeSeenFlag(key: string): void {
  try {
    window.localStorage.setItem(key, '1')
  } catch {
    // not remembered across visits — nothing else depends on it
  }
}

const getTourSeenSnapshot = () => readSeenFlag(TOUR_SEEN_KEY)
const getTourSeenServerSnapshot = () => false
const getUiUpdateHintSeenSnapshot = () => readSeenFlag(UI_UPDATE_HINT_SEEN_KEY)
// The server can't know: say "seen", so nothing is shown before hydration.
const getUiUpdateHintSeenServerSnapshot = () => true

// useSyncExternalStore (not useState+useEffect) to read this: it's the hook
// React designed exactly for "a value that lives outside React and may
// differ between the server-rendered snapshot and the real client value" —
// it renders `false` (getServerSnapshot) for the initial/server-matching
// pass with no hydration-mismatch warning, then transparently re-renders
// with the real localStorage value right after hydration. A plain
// useState+useEffect pair would need its own three-state dance (null while
// unchecked) to get the same guarantee, and calling setState directly
// inside the effect body trips react-hooks/set-state-in-effect.
const noopSubscribe = () => () => {}
const getIntroSeenSnapshot = () => readSeenFlag(INTRO_SEEN_KEY)
const getIntroSeenServerSnapshot = () => false

export function useFirstRun() {
  // false for the server render AND the hydration pass that must match it,
  // true from the first real client render on. The two "seen" flags below
  // report `false` during that first pass no matter what localStorage says,
  // so on their own they can't tell "visitor hasn't seen it" from "haven't
  // been able to read it yet" — which flashed the first-run screen at every
  // returning visitor and, wherever `entered` was already true on that pass,
  // armed the product tour a second time.
  const clientReady = useSyncExternalStore(noopSubscribe, () => true, () => false)
  const introSeen = useSyncExternalStore(noopSubscribe, getIntroSeenSnapshot, getIntroSeenServerSnapshot)
  // A same-session "just left the start screen" flag — the snapshot above
  // only reflects localStorage from a PAST visit; localStorage.setItem in
  // handleCloseStart doesn't itself trigger a re-render (noopSubscribe
  // never fires), so entering this session is tracked separately.
  const [justEntered, setJustEntered] = useState(false)
  // «?» → «Показать стартовый экран» opens it again on demand — this
  // overrides both the localStorage "seen" flag and justEntered until the
  // visitor leaves it again.
  const [replayStart, setReplayStart] = useState(false)
  // NEXT_PUBLIC_SKIP_INTRO is inlined as a constant at build time —
  // identical on server and client, so it's safe to read directly here.
  // Set ONLY in vitest.config.ts's test environment, so the unit suite
  // renders the calculator directly (the e2e suite seeds the "seen"
  // localStorage flags instead — see playwright.config.ts).
  const entered = !replayStart && (process.env.NEXT_PUBLIC_SKIP_INTRO === '1' || introSeen || justEntered)
  const handleCloseStart = () => {
    writeSeenFlag(INTRO_SEEN_KEY)
    setJustEntered(true)
    setReplayStart(false)
  }
  const handleShowStart = () => setReplayStart(true)
  const tourSeen = useSyncExternalStore(noopSubscribe, getTourSeenSnapshot, getTourSeenServerSnapshot)
  const [tourActive, setTourActive] = useState(false)
  // Auto-arm the tour once per mount as soon as we know both `entered` and
  // `tourSeen` for real. Deliberately NOT a "compare previous `entered`"
  // transition check (this file's usual pattern, e.g. PhotoCropDialog.tsx's
  // prevBitmap): that only fires on a false→true EDGE, which a returning
  // visitor who already has INTRO_SEEN_KEY set from a past visit (so
  // `entered` is already true on the very first render, no edge to catch)
  // would never cross — this simpler "haven't auto-triggered yet" guard
  // fires correctly whether `entered` starts true or becomes true later.
  const [tourAutoTriggered, setTourAutoTriggered] = useState(false)
  if (clientReady && entered && !tourSeen && !tourAutoTriggered) {
    setTourAutoTriggered(true)
    setTourActive(true)
  }
  const handleCloseTour = () => {
    writeSeenFlag(TOUR_SEEN_KEY)
    writeSeenFlag(UI_UPDATE_HINT_SEEN_KEY)
    setTourActive(false)
  }
  const handleShowTour = () => setTourActive(true)
  const uiUpdateHintSeen = useSyncExternalStore(noopSubscribe, getUiUpdateHintSeenSnapshot, getUiUpdateHintSeenServerSnapshot)
  useEffect(() => {
    if (!clientReady || !entered || !tourSeen || uiUpdateHintSeen) return
    writeSeenFlag(UI_UPDATE_HINT_SEEN_KEY)
    toast.info('Интерфейс обновлён', {
      // One toast even if this runs twice (React's dev double effects).
      id: 'ui-update-hint',
      description: 'Где что теперь — в «?» → «Пройти тур».',
      duration: 15000,
      action: { label: 'Пройти тур', onClick: () => setTourActive(true) },
    })
  }, [clientReady, entered, tourSeen, uiUpdateHintSeen])
  // Opened from «?», not on the first visit: its buttons then make new
  // calculations rather than taking over the first one (spec 10.1).
  return { clientReady, entered, startFromHelp: replayStart, handleCloseStart, handleShowStart, tourActive, handleCloseTour, handleShowTour }
}
