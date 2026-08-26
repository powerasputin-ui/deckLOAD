'use client'

import { useRef, useState } from 'react'
import { Pause, Play, SkipForward, Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface VideoIntroProps {
  onEnter: () => void
}

// Browsers block unmuted autoplay almost universally, so the video must
// start muted to guarantee it actually plays on page load — the mute
// toggle lets the user turn sound on with one click, the standard
// trailer/hero-video pattern.
export function VideoIntro({ onEnter }: VideoIntroProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [paused, setPaused] = useState(false)
  const [muted, setMuted] = useState(true)
  const [showEnterCta, setShowEnterCta] = useState(false)

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
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        src="/videos/deckload-intro.mp4"
        poster="/videos/deckload-intro-poster.jpg"
        autoPlay
        muted={muted}
        playsInline
        onTimeUpdate={(e) => {
          if (e.currentTarget.currentTime >= 10 && !showEnterCta) setShowEnterCta(true)
        }}
        onEnded={onEnter}
      />

      <div className="absolute bottom-4 right-4 z-10 flex items-center gap-2">
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
          'absolute inset-x-0 bottom-24 flex justify-center transition-opacity duration-700',
          showEnterCta ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
      >
        <Button size="lg" onClick={onEnter}>
          Войти на сайт
        </Button>
      </div>
    </div>
  )
}
