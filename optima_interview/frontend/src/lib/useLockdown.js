import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'

const fullscreenWorks = () =>
  typeof document !== 'undefined' && Boolean(document.documentElement.requestFullscreen) && document.fullscreenEnabled !== false

// Keeps an interview in one window. While `active`, it notices when the candidate hides the tab,
// switches to another window, or drops out of full screen.
//
//   onLeave(how)   once each time they go: how is 'hidden', 'blur' or 'fullscreen'
//   onReturn(ms)   when they are back, with how long they were gone
//
// A website cannot stop someone leaving. It can only notice, say so, and keep count.
export function useLockdown({ active, onLeave, onReturn }) {
  const [away, setAway] = useState(null) // null, or how they left
  const fullWanted = useRef(false)
  const since = useRef(0)
  const promptUntil = useRef(0)
  const gone = useRef(null)

  const look = useEffectEvent(() => {
    if (!active) return
    const how = document.hidden
      ? 'hidden'
      : fullWanted.current && !document.fullscreenElement
        ? 'fullscreen'
        : !document.hasFocus()
          ? 'blur'
          : null
    if (how && !gone.current) {
      // a permission prompt the page itself caused (the microphone, for dictation) takes focus for a moment
      if (how === 'blur' && performance.now() < promptUntil.current) return
      gone.current = how
      since.current = performance.now()
      setAway(how)
      onLeave?.(how)
    } else if (!how && gone.current) {
      gone.current = null
      setAway(null)
      onReturn?.(Math.round(performance.now() - since.current))
    } else if (how && gone.current && how !== gone.current) {
      gone.current = how // back on the tab, say, but not yet back in full screen
      setAway(how)
    }
  })

  useEffect(() => {
    if (!active) {
      gone.current = null
      return undefined
    }
    let timer = 0
    // focus can leave and come straight back (a click on the page's own scrollbar): wait before judging
    const onBlur = () => {
      clearTimeout(timer)
      timer = setTimeout(look, 300)
    }
    document.addEventListener('visibilitychange', look)
    document.addEventListener('fullscreenchange', look)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', look)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', look)
      document.removeEventListener('fullscreenchange', look)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', look)
    }
  }, [active])

  // Go to full screen. Has to be called from a click. Resolves false where the browser has no full screen
  // (an iPhone, or a page shown inside another page): the interview then runs without it.
  const enter = useCallback(async () => {
    if (!fullscreenWorks()) {
      fullWanted.current = false
      return false
    }
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
      if (!document.fullscreenElement) {
        fullWanted.current = false // the browser said yes and did nothing: carry on without it
        return false
      }
      fullWanted.current = true
      // Where the browser allows it, Escape has to be held down to leave, so a stray tap does not count as leaving.
      navigator.keyboard?.lock?.(['Escape']).catch(() => {})
      return true
    } catch {
      fullWanted.current = false
      return false
    }
  }, [])

  const exit = useCallback(() => {
    fullWanted.current = false
    navigator.keyboard?.unlock?.()
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
  }, [])

  // The page is about to cause a browser prompt (asking for the microphone): losing focus to it is not leaving.
  const allowPrompt = useCallback((ms = 15000) => {
    promptUntil.current = performance.now() + ms
  }, [])

  return { away: active ? away : null, enter, exit, allowPrompt }
}
