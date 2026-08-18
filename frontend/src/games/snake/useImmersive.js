import { useEffect } from 'react'

/**
 * Strips the page back to the game while a match is running.
 *
 * The board on a phone is limited by the screen's WIDTH - a square 15x15 can
 * never be wider than the phone - so the way to make the game feel bigger is
 * not to find it more pixels, it is to remove everything sharing the screen
 * with it. This puts a class on <body>, because the nav bar it needs to hide
 * lives outside the page component.
 *
 * Fullscreen, where the browser offers it, is asked for separately: it is a
 * user's choice rather than something to spring on them, and iOS Safari does
 * not implement it for elements at all.
 */
export function useImmersive(active) {
  useEffect(() => {
    if (!active) return undefined
    document.body.classList.add('snake-immersive')
    return () => document.body.classList.remove('snake-immersive')
  }, [active])
}

/** Best effort - unsupported, refused or already exited are all fine. */
export function toggleFullscreen() {
  const el = document.documentElement
  try {
    if (document.fullscreenElement) document.exitFullscreen?.()
    else el.requestFullscreen?.()
  } catch {
    /* not available on this browser; immersive mode still applies */
  }
}
