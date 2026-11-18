import { useCallback, useEffect, useRef, useState } from 'react'
import { baseline, createMotion, judge, judgeBlur, judgeLight } from './measure'
import { MIC, startListening } from './microphone'
import { createTally } from './tally'
import { createTipper, problems, statusLines, voiceProblems } from './tips'
import { VOICE, createVoice } from './voice'

// A stretch of typing: nobody looks at the camera while they type, so eye contact is not judged then.
const TYPING_MS = 1500
// A question that has just appeared is being read, eyes on the screen: eye contact is not judged yet.
const READ_MS = 6000
// One of the always-on lines changes only once what it would say has held this long, so it does not flicker.
const SETTLE_MS = 700

const EARLY_FRAMES = 20
const CAMERA = { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
// Before a weekly interview the picture has to be right, and stay right for this long, before Begin opens.
const STEADY_MS = 1200
// What has to be right in the picture for a weekly interview to begin.
const MUST_NOT = ['absent', 'cut', 'dim', 'backlit', 'blurred', 'others']

const NOTHING = { tip: null, better: null, problems: [], present: false, pictureOk: false, lines: [], facts: {}, sound: { heard: false, problem: null } }

const sameView = (a, b) =>
  a.tip === b.tip &&
  a.better === b.better &&
  a.present === b.present &&
  a.pictureOk === b.pictureOk &&
  a.sound.heard === b.sound.heard &&
  a.sound.problem === b.sound.problem &&
  a.facts.pace === b.facts.pace &&
  a.facts.fillers === b.facts.fillers &&
  a.problems.length === b.problems.length &&
  a.problems.every((p, i) => p === b.problems[i]) &&
  a.lines.length === b.lines.length &&
  a.lines.every((line, i) => line.text === b.lines[i].text && line.ok === b.lines[i].ok)

// True where the page itself is not allowed a camera, whatever the person answers: a page shown inside
// another page that has not passed the permission on, for example.
function cameraRuledOut() {
  try {
    const policy = document.permissionsPolicy || document.featurePolicy
    return policy?.allowsFeature?.('camera') === false
  } catch {
    return false
  }
}

const canDictate = typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)

// Phones and tablets give the microphone to one listener at a time. Dictation needs it more than the coach
// does, so on those the coach leaves the microphone alone and times speech from the words dictation delivers.
const oneListener =
  typeof navigator !== 'undefined' &&
  (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1))

// The coach. Everything happens in the browser: the camera is read a few times a second and the microphone
// a few dozen, each look is turned into a handful of numbers, and those numbers are all that is kept.
// No picture and no sound is saved or sent.
//
// In a practice interview it is a choice. In the weekly interview (`strict`) it is a condition: the
// interview cannot begin until the camera and the microphone are allowed and the picture is right, and the
// time spent off camera, turned away from the screen, or with a second face in view goes on the record.
//
//   status   off | asking (for the camera) | loading (the model) | on | blocked (camera refused) | failed
//            | unsupported (this page cannot use a camera at all)
//   mic      off | on | blocked (camera allowed, microphone refused) | none (no microphone to use)
//            | words (the microphone is left to dictation: pace and filler words only)
//   tip      the one thing worth saying now, or null (keys from tips.js); `facts` holds the numbers it quotes
//   better   the tip that has just been acted on, for a moment
//   lines    where the eyes are, how the person is sitting, how they sound: shown all the time while answering
//   problems everything that is wrong in the picture now (for the checklist before the interview)
//   sound    before the interview: has the microphone heard a voice, and is anything wrong with it
//   pictureOk  before the interview: the face is in the picture, lit, sharp and alone, and has been for a moment
export function useCoach({ strict = false } = {}) {
  const [status, setStatus] = useState('off')
  const [mic, setMic] = useState('off')
  const [view, setView] = useState(NOTHING)

  const video = useRef(null)
  const stream = useRef(null)
  const stopTracking = useRef(null)
  const stopListening = useRef(null)
  const wordClock = useRef(0)
  const wanted = useRef(false)
  const loaded = useRef(false) // the model was asked for at least once
  const micState = useRef('off')
  const live = useRef({
    base: null,
    tally: null, // set while an interview is being watched
    voice: null, // and what was heard over it
    check: createVoice(), // before the interview: only to see that the microphone hears a voice
    collecting: null, // frames gathered while the person is asked to look at the camera
    early: [],
    lastKeyAt: -Infinity,
    askedAt: -Infinity,
    dictating: false,
    reading: false,
    motion: createMotion(),
    tipper: createTipper(),
    heardNow: null, // the latest from voice.now()
    voiceFound: [],
    facts: {},
    sound: NOTHING.sound,
    soundFor: 0,
    shown: {}, // the always-on lines as they stand, and what each is waiting to change to
    wrongAt: -Infinity, // when the picture was last not good enough to begin on
    pictureOk: false,
  })

  // What the voice sounds like right now, looked at twice a second (not on every reading: that is 25 a second).
  const refreshVoice = useCallback(() => {
    const s = live.current
    if (s.tally && s.voice) {
      const now = s.voice.now()
      s.heardNow = now
      s.voiceFound = s.dictating && !s.reading ? voiceProblems(now) : []
      s.facts = { pace: now.pace == null ? null : Math.round(now.pace / 5) * 5, fillers: now.fillers, word: now.word }
    } else {
      const now = s.check.now()
      const heard = now.spoken >= 1.2
      const problem = !heard
        ? null
        : now.clipping
          ? 'loud'
          : now.level < VOICE.faint
            ? 'faint'
            : now.level - now.room < VOICE.clear
              ? 'noisy'
              : null
      s.sound = { heard, problem }
    }
  }, [])

  const onSound = useCallback(
    (reading, seconds) => {
      const s = live.current
      if (s.tally && s.voice) s.voice.hear(reading, seconds, s.dictating && !s.reading)
      else s.check.hear(reading, seconds, true)
      s.soundFor += seconds
      if (s.soundFor >= 0.5) {
        s.soundFor = 0
        refreshVoice()
      }
    },
    [refreshVoice],
  )

  const onFrame = useCallback((seen, light, seconds, aspect) => {
    const s = live.current
    if (s.collecting) s.collecting.push(seen)
    const watching = Boolean(s.tally)
    // The countdown did not catch a face (they looked away, or joined late): take the first few seconds
    // of the interview as where they sit instead.
    if (watching && !s.base && seen) {
      s.early.push(seen)
      if (s.early.length >= EARLY_FRAMES) s.base = baseline(s.early)
    }
    const flags = judge(seen, s.base)
    flags.light = judgeLight(light)
    flags.blurred = flags.present && judgeBlur(light)
    flags.restless = s.motion(seen, seconds, aspect)
    const now = performance.now()
    const typing = now - s.lastKeyAt <= TYPING_MS
    // looking down while the keys are going is looking at the keyboard, which is part of the interview
    if (typing && flags.offScreen === 'down') flags.offScreen = null
    const reading = s.reading || (!s.dictating && now - s.askedAt < READ_MS)
    // until there is something to compare with, where the eyes are cannot be judged
    const eyes = Boolean(s.base) && !typing && !reading
    const why = !s.base ? 'settling' : typing ? 'typing' : reading ? 'reading' : null
    const speaking = s.dictating && !s.reading && (s.heardNow ? s.heardNow.speaking || !s.heardNow.metered : true)
    if (watching) s.tally.add(flags, seconds, { eyes, speaking: eyes && speaking })

    // before the interview nobody is asked to look at the camera yet, so looking away is not a problem
    const found = problems(flags, { eyes: watching && eyes, strict: strict && watching })
    if (found.some((key) => MUST_NOT.includes(key))) s.wrongAt = now
    s.pictureOk = now - s.wrongAt >= STEADY_MS
    let said = { tip: null, better: null }
    let lines = []
    if (watching) {
      // the angle of the camera is something to set up beforehand, not to be told about mid-answer
      const wrong = [...found.filter((key) => key !== 'cameraLow' && key !== 'cameraHigh'), ...s.voiceFound]
      said = s.tipper(wrong, now)
      lines = statusLines({ flags, eyes, why, voice: s.heardNow, dictating: s.dictating, canDictate, mic: micState.current, strict }).map((line) => {
        const held = s.shown[line.key]
        // the voice line is already an average over many seconds: it has no flicker to wait out
        if (!held || line.key === 'voice') {
          s.shown[line.key] = { ...line, wants: line.text, since: now }
          return line
        }
        if (held.wants !== line.text) {
          held.wants = line.text
          held.since = now
        }
        if (held.text !== line.text && now - held.since >= SETTLE_MS) Object.assign(held, line)
        return { key: held.key, label: held.label, text: held.text, ok: held.ok }
      })
    }
    const next = { tip: said.tip, better: said.better, problems: found, present: flags.present, pictureOk: s.pictureOk, lines, facts: s.facts, sound: s.sound }
    setView((old) => (sameView(old, next) ? old : next))
  }, [strict])

  const release = useCallback(() => {
    stopTracking.current?.()
    stopTracking.current = null
    stopListening.current?.()
    stopListening.current = null
    clearInterval(wordClock.current)
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
    if (video.current) video.current.srcObject = null
  }, [])

  const turnOff = useCallback(() => {
    wanted.current = false
    release()
    micState.current = 'off'
    setMic('off')
    setStatus('off')
    setView(NOTHING)
  }, [release])

  const turnOn = useCallback(async () => {
    if (wanted.current) return
    if (!navigator.mediaDevices?.getUserMedia || cameraRuledOut()) {
      setStatus('unsupported') // nothing the person can allow: say so instead of asking
      return
    }
    wanted.current = true
    setStatus('asking')
    let media = null
    let heard = oneListener ? 'words' : 'on'
    try {
      // one question to the person for both. The microphone is for the voice tips
      media = await navigator.mediaDevices.getUserMedia({ video: CAMERA, audio: oneListener ? false : MIC })
    } catch (refusal) {
      if (oneListener) {
        wanted.current = false
        setStatus('blocked')
        return
      }
      // no microphone, or the microphone alone is blocked: the camera half of the coach still works
      heard = refusal?.name === 'NotAllowedError' || refusal?.name === 'SecurityError' ? 'blocked' : 'none'
      try {
        media = await navigator.mediaDevices.getUserMedia({ video: CAMERA, audio: false })
      } catch {
        wanted.current = false
        setStatus('blocked')
        return
      }
    }
    if (!wanted.current) {
      media.getTracks().forEach((track) => track.stop())
      return
    }
    if (strict && oneListener) {
      // The microphone is left to dictation on these devices, but the weekly interview still needs it
      // allowed before it begins, so that dictation never has to ask part-way through. Ask, then let go.
      try {
        const once = await navigator.mediaDevices.getUserMedia({ audio: true })
        once.getTracks().forEach((track) => track.stop())
      } catch (refusal) {
        heard = refusal?.name === 'NotAllowedError' || refusal?.name === 'SecurityError' ? 'blocked' : 'none'
      }
    }
    stream.current = media
    if (video.current) video.current.srcObject = media
    if (heard === 'on') {
      live.current.check = createVoice()
      live.current.sound = NOTHING.sound
      try {
        stopListening.current = startListening(media, onSound)
      } catch {
        stopListening.current = null
      }
      if (!stopListening.current) heard = 'none'
    }
    micState.current = heard
    setMic(heard)

    live.current.wrongAt = performance.now()
    live.current.pictureOk = false
    setStatus('loading')
    try {
      loaded.current = true
      const { startTracking } = await import('./tracker')
      const stop = await startTracking(() => video.current, onFrame)
      if (!wanted.current) {
        stop()
        return
      }
      stopTracking.current = stop
      setStatus('on')
    } catch (err) {
      if (import.meta.env.DEV) console.warn('The coach could not start:', err)
      wanted.current = false
      release()
      micState.current = 'off'
      setMic('off')
      setStatus('failed')
    }
  }, [onFrame, onSound, release, strict])

  // The <video> on the page. It is a different element on different screens: each one gets the same camera.
  const attach = useCallback((element) => {
    video.current = element
    if (element && stream.current && element.srcObject !== stream.current) {
      element.srcObject = stream.current
      element.play?.().catch(() => {})
    }
  }, [])

  // Ask the person to look at the camera for `ms`, and remember how they sat and where their eyes were.
  // Resolves true if they were seen well enough to compare against later.
  const settle = useCallback(
    (ms) =>
      new Promise((resolve) => {
        const s = live.current
        s.collecting = []
        setTimeout(() => {
          const frames = s.collecting || []
          s.collecting = null
          s.base = baseline(frames.slice(Math.floor(frames.length / 3))) // the first moments are them finding the lens
          resolve(Boolean(s.base))
        }, ms)
      }),
    [],
  )

  // With no microphone meter (refused, none, or given up to dictation), speaking time is taken from the
  // words dictation delivers.
  const timeByWords = useCallback(() => {
    const s = live.current
    clearInterval(wordClock.current)
    wordClock.current = setInterval(() => {
      if (!s.voice) return
      s.voice.hear(null, 0.1, s.dictating && !s.reading)
      s.soundFor += 0.1
      if (s.soundFor >= 0.5) {
        s.soundFor = 0
        refreshVoice()
      }
    }, 100)
  }, [refreshVoice])

  const begin = useCallback(() => {
    const s = live.current
    s.tally = createTally()
    s.voice = createVoice()
    s.tipper = createTipper()
    s.early = []
    s.shown = {}
    s.heardNow = null
    s.voiceFound = []
    s.facts = {}
    s.askedAt = performance.now()
    clearInterval(wordClock.current)
    if (!stopListening.current) timeByWords()
  }, [timeByWords])

  // Dictation could not get the microphone while the coach was listening to it. Dictation matters more:
  // the coach lets go, and carries on from the words alone. True if there was something to let go of.
  const releaseMic = useCallback(() => {
    if (!stopListening.current) return false
    stopListening.current()
    stopListening.current = null
    stream.current?.getAudioTracks().forEach((track) => track.stop())
    micState.current = 'words'
    setMic('words')
    if (live.current.tally) timeByWords()
    return true
  }, [timeByWords])

  // Seconds of speech the microphone has heard in this interview (for telling a quiet person from a starved dictation).
  const spoken = useCallback(() => live.current.voice?.now().spoken ?? 0, [])

  const nextQuestion = useCallback(() => {
    const s = live.current
    s.tally?.nextQuestion()
    s.voice?.nextQuestion()
    s.askedAt = performance.now()
  }, [])

  const typed = useCallback(() => {
    live.current.lastKeyAt = performance.now()
  }, [])

  // What was seen and heard during the question being answered now, to send with its answer (weekly):
  // seconds on camera, turned away, with a second face; and seconds of voice the microphone heard while
  // dictating (only where a microphone was timing it). Null when the coach is not watching.
  const seen = useCallback(() => {
    const s = live.current
    if (!s.tally) return null
    const out = { cam: s.tally.seen() }
    const now = s.voice?.now()
    if (now?.metered) out.talk = Math.round(now.talk * 10) / 10
    return out
  }, [])

  // True when the camera has stopped delivering a picture (unplugged, taken by another program).
  const lost = useCallback(() => {
    const track = stream.current?.getVideoTracks?.()[0]
    return Boolean(wanted.current && (!track || track.readyState === 'ended'))
  }, [])

  // The page tells the coach when the person is answering aloud, what dictation heard, and when the
  // question is being read out (which is not the person speaking).
  const dictating = useCallback((on) => {
    live.current.dictating = Boolean(on)
  }, [])

  const reading = useCallback((on) => {
    live.current.reading = Boolean(on)
  }, [])

  const heard = useCallback((finished, unfinished = '') => {
    const s = live.current
    // words that arrive while the question is being read out are the question, picked up from the speakers
    if (s.tally && s.voice && !s.reading) s.voice.words(finished, unfinished)
  }, [])

  // What was seen and heard over the interview, as numbers. Null if the coach was never on while it ran.
  const finish = useCallback(() => {
    const s = live.current
    clearInterval(wordClock.current)
    const summary = s.tally ? s.tally.summary() : null
    const sounded = s.voice ? s.voice.summary() : null
    s.tally = null
    s.voice = null
    if (!summary || summary.seconds < 5) return null
    if (sounded) {
      const { per_question: answers, ...rest } = sounded
      summary.voice = rest
      answers.forEach((answer, i) => {
        const row = summary.per_question[i]
        if (!row || !answer.talk) return
        for (const key of ['talk', 'pace', 'fillers', 'range']) if (answer[key] != null) row[key] = answer[key]
      })
    }
    return summary
  }, [])

  // Leaving the page lets go of the camera, the microphone and the model.
  useEffect(
    () => () => {
      wanted.current = false
      stopTracking.current?.()
      stopListening.current?.()
      clearInterval(wordClock.current)
      stream.current?.getTracks().forEach((track) => track.stop())
      if (loaded.current) import('./tracker').then(({ closeTracker }) => closeTracker()).catch(() => {})
    },
    [],
  )

  return {
    status,
    mic,
    canDictate,
    tip: view.tip,
    better: view.better,
    facts: view.facts,
    lines: view.lines,
    sound: view.sound,
    problems: view.problems,
    present: view.present,
    pictureOk: view.pictureOk,
    seen,
    lost,
    attach,
    turnOn,
    turnOff,
    settle,
    begin,
    nextQuestion,
    typed,
    dictating,
    reading,
    heard,
    releaseMic,
    spoken,
    finish,
  }
}
