import { useCallback, useEffect, useRef, useState } from 'react'
import type Hls from 'hls.js'
import * as client from '../data/client'

const LOAD_ERROR = 'The recording couldn’t be loaded from the Legislature’s archive.'

// Plays a hearing recording's HLS stream.
//
// Nothing exists until the first play: no media element, no hls.js chunk
// (it's large), no playlist request through our proxy to the Legislature's
// archive. Merely rendering a player — the dashboard does on every visit —
// costs nothing. (An idle <video> in every dashboard also crashed headless
// Chromium tabs under the parallel e2e suite.) Seeks before then only move
// the UI and set where loading will start.
//
// The element is a hidden <video>, not <audio>: freshly posted recordings
// only exist as a muxed video+audio stream. It's created and appended
// synchronously inside the click that starts playback, which keeps play()
// within the user gesture on iOS.
export function useHearingPlayer(audioUrl: string | null, durationSeconds: number) {
  const mediaRef = useRef<HTMLVideoElement | null>(null)
  const hlsRef = useRef<Hls | null>(null)
  const teardownRef = useRef<(() => void) | null>(null)
  const startAtRef = useRef(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setCurrentTime(0)
    setIsPlaying(false)
    setError(null)
    startAtRef.current = 0
    return () => {
      teardownRef.current?.()
      teardownRef.current = null
    }
  }, [audioUrl])

  // Creates the element and starts loading at startAtRef. Idempotent.
  const attach = useCallback((): Promise<void> => {
    if (mediaRef.current || !audioUrl) return Promise.resolve()
    const src = client.hearingMediaUrl(audioUrl)

    const media = document.createElement('video')
    media.setAttribute('playsinline', '')
    media.style.display = 'none'
    media.setAttribute('aria-hidden', 'true')
    const onTime = () => setCurrentTime(media.currentTime)
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    // Native HLS reports failures here; hls.js has its own ERROR event below.
    const onError = () => {
      if (!hlsRef.current) setError(LOAD_ERROR)
    }
    media.addEventListener('timeupdate', onTime)
    media.addEventListener('play', onPlay)
    media.addEventListener('pause', onPause)
    media.addEventListener('ended', onPause)
    media.addEventListener('error', onError)
    document.body.appendChild(media)
    mediaRef.current = media

    let cancelled = false
    teardownRef.current = () => {
      cancelled = true
      media.removeEventListener('timeupdate', onTime)
      media.removeEventListener('play', onPlay)
      media.removeEventListener('pause', onPause)
      media.removeEventListener('ended', onPause)
      media.removeEventListener('error', onError)
      hlsRef.current?.destroy()
      hlsRef.current = null
      media.pause()
      media.removeAttribute('src')
      media.load()
      media.remove()
      mediaRef.current = null
    }

    if (media.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS (Safari/iOS, newer Chrome).
      media.src = src
      media.currentTime = startAtRef.current
      return Promise.resolve()
    }

    return import('hls.js')
      .then(({ default: HlsCtor }) => {
        if (cancelled) return
        if (!HlsCtor.isSupported()) {
          setError('This browser can’t play hearing recordings.')
          return
        }
        const hls = new HlsCtor({
          startPosition: startAtRef.current,
          // The proxy sits behind the session cookie; in dev the API is a
          // different origin (localhost:4000), so send credentials.
          xhrSetup: (xhr) => {
            xhr.withCredentials = true
          },
        })
        hls.on(HlsCtor.Events.ERROR, (_event, data) => {
          if (data.fatal) setError(LOAD_ERROR)
        })
        hls.loadSource(src)
        hls.attachMedia(media)
        hlsRef.current = hls
      })
      .catch(() => setError('The audio player failed to load.'))
  }, [audioUrl])

  const play = useCallback(() => {
    if (!audioUrl) return
    const isFirstPlay = !mediaRef.current
    const attaching = attach()
    const media = mediaRef.current
    if (!media) return
    const start = () =>
      media.play().catch(() => {
        // Autoplay policy or a failed load; the error handlers cover the latter.
      })
    // Native HLS is ready synchronously, so play() stays inside the user
    // gesture; hls.js needs its chunk first, which desktop browsers allow.
    if (!isFirstPlay || media.src) start()
    else attaching.then(start)
  }, [audioUrl, attach])

  const toggle = useCallback(() => {
    const media = mediaRef.current
    if (media && !media.paused) media.pause()
    else play()
  }, [play])

  // UI state moves immediately (so transcript highlighting and the clock
  // respond even before anything has loaded); the element follows.
  const seek = useCallback(
    (seconds: number, opts: { play?: boolean } = {}) => {
      const t = Math.min(Math.max(seconds, 0), durationSeconds || seconds)
      setCurrentTime(t)
      startAtRef.current = t
      if (mediaRef.current) mediaRef.current.currentTime = t
      if (opts.play) play()
    },
    [durationSeconds, play],
  )

  return { currentTime, isPlaying, error, toggle, seek }
}

export type HearingPlayer = ReturnType<typeof useHearingPlayer>
