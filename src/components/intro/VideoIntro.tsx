'use client'

import { useEffect, useRef, useState } from 'react'
import { Pause, Play, SkipForward, Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ShaderBackground } from '@/components/ui/neuro-noise'
import { cn } from '@/lib/utils'

interface VideoIntroProps {
  onEnter: () => void
}

// Bump this whenever the video/poster files under public/videos/ are
// replaced. Static files in public/ are served at a fixed URL with no
// automatic cache-busting (unlike Next's own hashed JS/CSS chunks) — after
// several redeploys that each put different content at the SAME
// /videos/deckload-intro.mp4 path, a returning visitor's browser could
// serve a stale disk-cached copy (or mix cached byte ranges from an older,
// shorter file with newer ones), which the reported "jumps straight to the
// site at 3–6s" symptom matches: the browser hit the end of what it had
// cached and fired a real `ended` event well before this file's true ~12s
// duration. A version query string forces a genuinely fresh cache entry
// per version instead of reusing whatever an old deploy left behind.
const INTRO_ASSET_VERSION = 'v5'

// Browsers block unmuted autoplay almost universally, so the video must
// start muted to guarantee it actually plays on page load — the mute
// toggle lets the user turn sound on with one click, the standard
// trailer/hero-video pattern.
export function VideoIntro({ onEnter }: VideoIntroProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [paused, setPaused] = useState(false)
  const [muted, setMuted] = useState(true)
  const [showEnterCta, setShowEnterCta] = useState(false)
  // Once the video finishes, it's swapped for an animated dark-blue shader
  // backdrop instead of freezing on the last frame — the user still has to
  // click "Войти на сайт" (or "Пропустить") explicitly, playback ending on
  // its own is no longer treated as entering.
  const [videoEnded, setVideoEnded] = useState(false)
  const stallTimerRef = useRef<number | null>(null)

  // Safety net for a stalled/buffering video (slow connection, a decode
  // hiccup, background hydration competing for the main thread — reported
  // live as "video freezes before the end, and then there's no way in"):
  // if playback stops making progress for a few seconds, show the CTA
  // early instead of leaving the visitor stuck on a frozen frame with only
  // the small corner controls. Cleared on every real timeupdate — only
  // fires if progress genuinely stops.
  const armStallFallback = () => {
    if (stallTimerRef.current !== null) return
    stallTimerRef.current = window.setTimeout(() => {
      stallTimerRef.current = null
      setShowEnterCta(true)
    }, 4000)
  }
  const clearStallFallback = () => {
    if (stallTimerRef.current === null) return
    window.clearTimeout(stallTimerRef.current)
    stallTimerRef.current = null
  }
  // Also arm on mount: if autoplay is blocked entirely (some browsers/
  // extensions/policies stop it before it ever starts), neither
  // `timeupdate` nor `waiting`/`stalled` ever fires, so the corner-case
  // catch-all above wouldn't trigger on its own — this covers it.
  useEffect(() => {
    armStallFallback()
    return clearStallFallback
  }, [])

  const togglePause = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      v.play()
      setPaused(false)
    } else {
      v.pause()
      setPaused(true)
    }
  }

  const toggleMute = () => {
    const v = videoRef.current
    if (!v) return
    v.muted = !v.muted
    setMuted(v.muted)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black">
      {!videoEnded ? (
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover"
          src={`/videos/deckload-intro.mp4?${INTRO_ASSET_VERSION}`}
          poster={`/videos/deckload-intro-poster.jpg?${INTRO_ASSET_VERSION}`}
          autoPlay
          muted={muted}
          playsInline
          preload="auto"
          onTimeUpdate={(e) => {
            clearStallFallback()
            if (e.currentTarget.currentTime >= 10 && !showEnterCta) setShowEnterCta(true)
          }}
          onWaiting={armStallFallback}
          onStalled={armStallFallback}
          onEnded={() => {
            clearStallFallback()
            setShowEnterCta(true)
            setVideoEnded(true)
          }}
          onError={() => {
            clearStallFallback()
            setShowEnterCta(true)
            setVideoEnded(true)
          }}
        />
      ) : (
        <ShaderBackground className="absolute inset-0 h-full w-full" />
      )}

      <div className="absolute bottom-4 right-4 z-10 flex items-center gap-2">
        {!videoEnded && (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="bg-black/40 text-white backdrop-blur hover:bg-black/60 hover:text-white"
              onClick={togglePause}
              aria-label={paused ? 'Продолжить' : 'Пауза'}
            >
              {paused ? <Play /> : <Pause />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="bg-black/40 text-white backdrop-blur hover:bg-black/60 hover:text-white"
              onClick={toggleMute}
              aria-label={muted ? 'Включить звук' : 'Выключить звук'}
            >
              {muted ? <VolumeX /> : <Volume2 />}
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="bg-black/40 text-white backdrop-blur hover:bg-black/60 hover:text-white"
          onClick={onEnter}
          aria-label="Пропустить"
        >
          <SkipForward />
        </Button>
      </div>

      <div
        className={cn(
          'absolute inset-0 z-20 flex items-center justify-center transition-opacity duration-700',
          showEnterCta ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
      >
        <button
          type="button"
          onClick={onEnter}
          className="text-3xl font-semibold tracking-wide text-white drop-shadow-lg transition-opacity hover:opacity-80 md:text-4xl"
        >
          Войти на сайт
        </button>
      </div>
    </div>
  )
}
