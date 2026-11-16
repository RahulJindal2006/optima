import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import {
  abandonInterview,
  abandonOnClose,
  answerQuestion,
  beginInterview,
  checkIn,
  reportEvent,
  scoreInterview,
  speakText,
  startInterview,
} from '../api/client'
import { Notice } from '../components/Bits'
import CoachTile from '../components/coach/CoachTile'
import Digits from '../components/Digits'
import Icon from '../components/Icon'
import Logo from '../components/Logo'
import Modal from '../components/Modal'
import QuestionFrame from '../components/QuestionFrame'
import { useCoach } from '../lib/coach/useCoach'
import { INTERVIEWS_ENABLED, LIMITS } from '../lib/flags'
import { countWords, formatDay, parseTime, plural } from '../lib/format'
import { useLockdown } from '../lib/useLockdown'
import '../styles/interview.css'

const clock = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const Recognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null

// A key only this page knows. The server ties the interview to it, so no other page can carry it on.
const newAttempt = () =>
  window.crypto?.randomUUID
    ? window.crypto.randomUUID().replaceAll('-', '')
    : Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')

const CHECK_IN_MS = 20000
const SETTLE_SECONDS = 3

// Turns the server's refusal into something a person can act on.
function explain(err, weekly) {
  if (err.status === 429 && weekly) {
    const when = parseTime(/Next available:\s*(\S+)/.exec(err.message)?.[1])
    return {
      title: 'This week’s interview is already used',
      text: when ? `The next one opens ${formatDay(when.toISOString())}.` : 'A new one opens seven days after the last.',
    }
  }
  if (err.status === 429) {
    return {
      title: 'No practice interviews left today',
      text: `You can start ${LIMITS.practicePerDay} a day. The count starts again tomorrow.`,
    }
  }
  if (err.status === 502) {
    return { title: 'The questions could not be written', text: 'Nothing was used up. Try again in a moment.' }
  }
  if (err.status === 410) {
    return {
      title: 'This interview has closed',
      text: `It was not begun within ${LIMITS.beginWithinMinutes} minutes of its questions being written.`,
    }
  }
  if (err.status === 409) {
    return {
      title: 'This interview cannot be continued here',
      text: 'It is open in another window, or that window was closed. An interview can only be taken in the window that began it.',
    }
  }
  return { title: 'The interview could not start', text: err.message }
}

// The frame for the interview: no navigation, one way out.
function Frame({ kind, onLeave, rail, centered = false, children }) {
  return (
    <div className="iv-page">
      <header className="iv-bar">
        <div className="wrap">
          <Logo />
          <span className="iv-kind">{kind}</span>
          {onLeave && (
            <button type="button" className="btn quiet sm" onClick={onLeave}>
              Leave
            </button>
          )}
        </div>
      </header>
      <main className={`iv-main ${centered ? 'centered' : ''} ${rail ? 'with-rail' : ''}`}>
        <div className="iv-col">{children}</div>
        {rail && <aside className="iv-rail">{rail}</aside>}
      </main>
    </div>
  )
}

export default function InterviewPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { jobTitle, industry, sessionType = 'mock', favouriteJobIds = [] } = location.state || {}
  const weekly = sessionType === 'connecting'
  const valid = INTERVIEWS_ENABLED && (weekly ? favouriteJobIds.length > 0 : Boolean(jobTitle && industry))
  const kind = weekly ? 'Weekly interview' : `Practice: ${jobTitle || ''}`

  const [phase, setPhase] = useState('loading') // loading | ready | settling | interview | scoring | failed
  const [failure, setFailure] = useState(null)
  const [session, setSession] = useState(null) // { id, count, outline, locked, leavesAllowed, beginBy }
  const [question, setQuestion] = useState(null)
  const [answer, setAnswer] = useState('')
  const [answered, setAnswered] = useState(0)
  const [deadline, setDeadline] = useState(null)
  const [now, setNow] = useState(() => Date.now())
  const [starting, setStarting] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendProblem, setSendProblem] = useState('')
  const [scoreProblem, setScoreProblem] = useState('')
  const [lateNote, setLateNote] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [count, setCount] = useState(SETTLE_SECONDS)

  // leaving the window
  const [leaves, setLeaves] = useState(0)
  const [leftNotice, setLeftNotice] = useState(null) // weekly: shown over the page until acknowledged
  const [awayNote, setAwayNote] = useState(null) // practice: how long they were gone, as a note
  const [pasteNote, setPasteNote] = useState(false)

  const [readAloud, setReadAloud] = useState(true)
  const [speaking, setSpeaking] = useState(false)
  const [voiceWorks, setVoiceWorks] = useState(true)
  const [dictating, setDictating] = useState(false)
  const [dictationProblem, setDictationProblem] = useState('')

  const asked = useRef(false)
  const attempt = useRef(null)
  const sessionId = useRef(null)
  const begun = useRef(false) // a question has been shown
  const done = useRef(false) // every answer is in, or the interview is over: closing the page costs nothing
  const busy = useRef(false)
  const signals = useRef({ typed: 0, dictated: 0, pastes: 0 })
  const delivery = useRef(null)
  const audio = useRef(null)
  const audioUrl = useRef(null)
  const recognition = useRef(null)
  const spoken = useRef('')
  const answerBox = useRef(null)

  const coach = useCoach()
  const coachShown = !weekly && ['asking', 'loading', 'on'].includes(coach.status)
  const locked = Boolean(session?.locked)
  const left = deadline == null ? 0 : Math.max(0, Math.ceil((deadline - now) / 1000))
  const last = question != null && session != null && question.question_order === session.count - 1

  // ── The interview is over on the server (left too often, or closed elsewhere) ───────────────────
  const showResults = () => {
    done.current = true
    lock.exit()
    coach.turnOff()
    navigate(`/results/${sessionId.current}`, { replace: true })
  }

  const lock = useLockdown({
    active: phase === 'interview',
    onLeave: (how) => {
      setLeaves((n) => n + 1)
      if (!locked) return
      setLeftNotice({ how })
      reportEvent(sessionId.current, { attempt: attempt.current, type: 'left', how })
        .then((res) => {
          setLeaves(res.left_count)
          if (res.ended) showResults()
        })
        .catch((err) => {
          if (err.status === 410) showResults()
        })
    },
    onReturn: (ms) => {
      if (locked) reportEvent(sessionId.current, { attempt: attempt.current, type: 'returned', ms }).catch(() => {})
      else setAwayNote(Math.max(1, Math.round(ms / 1000)))
    },
  })

  // ── Starting: ask the server to write the questions, once ───────────────────────────────────────
  useEffect(() => {
    if (!valid || asked.current) return
    asked.current = true
    const payload = weekly
      ? { session_type: 'connecting', favourite_job_ids: favouriteJobIds }
      : { job_title: jobTitle, industry, session_type: 'mock' }
    startInterview(payload)
      .then((res) => {
        sessionId.current = res.session_id
        setSession({
          id: res.session_id,
          count: res.question_count,
          outline: res.outline,
          locked: res.rules.locked,
          leavesAllowed: res.rules.leaves_allowed,
          beginBy: Date.now() + res.begin_seconds_left * 1000,
        })
        setPhase('ready')
      })
      .catch((err) => {
        setFailure(explain(err, weekly))
        setPhase('failed')
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Voice: the question read aloud ──────────────────────────────────────────────────────────────
  const stopVoice = () => {
    if (audio.current) {
      audio.current.onended = null
      audio.current.onerror = null
      audio.current.pause()
      audio.current = null
    }
    if (audioUrl.current) {
      URL.revokeObjectURL(audioUrl.current)
      audioUrl.current = null
    }
    setSpeaking(false)
    coach.reading(false)
  }

  const speak = (text) => {
    stopVoice()
    speakText(text)
      .then((url) => {
        audioUrl.current = url
        const player = new Audio(url)
        audio.current = player
        player.onplay = () => {
          setSpeaking(true)
          coach.reading(true) // the coach must not take the question for the answer
        }
        player.onended = stopVoice
        player.onerror = stopVoice
        player.play().catch(stopVoice)
      })
      .catch(() => setVoiceWorks(false)) // no voice on this server: carry on without it
  }

  // ── Dictation: speech to text, in browsers that have it ─────────────────────────────────────────
  const stopDictation = () => {
    if (recognition.current) {
      recognition.current.onend = null
      recognition.current.stop()
      recognition.current = null
    }
    setDictating(false)
    coach.dictating(false)
  }

  // `again` is true when dictation is being restarted after the coach let go of the microphone:
  // what has been said so far is kept.
  const startDictation = (again = false) => {
    if (!Recognition || !question) return
    setDictationProblem('')
    const engine = new Recognition()
    engine.continuous = true
    engine.interimResults = true
    engine.lang = 'en-US'
    if (!again) spoken.current = answer
    const heardBefore = coach.spoken()
    let restart = false

    engine.onresult = (event) => {
      let interim = ''
      let settled = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const heard = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          spoken.current = `${spoken.current}${spoken.current ? ' ' : ''}${heard.trim()}`
          signals.current.dictated += heard.trim().length + 1
          settled += ` ${heard}`
        } else interim += heard
      }
      setAnswer(interim ? `${spoken.current}${spoken.current ? ' ' : ''}${interim}` : spoken.current)
      coach.heard(settled.trim(), interim) // for pace and filler words: counted, not kept
    }
    engine.onerror = (event) => {
      // Some browsers give the microphone to one listener at a time. If dictation got no sound while the
      // coach's meter was hearing speech, the coach lets go of the microphone and dictation starts again.
      const starved = event.error === 'audio-capture' || (event.error === 'no-speech' && coach.spoken() - heardBefore >= 1.5)
      if (starved && !again && coach.releaseMic()) {
        restart = true
        return
      }
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setDictationProblem('The microphone is blocked for this site. Allow it in your browser, or type your answer.')
      } else if (event.error === 'audio-capture') {
        setDictationProblem('Dictation could not hear the microphone. Check that it is plugged in, or type your answer.')
      }
    }
    engine.onend = () => {
      recognition.current = null
      if (restart) {
        startDictation(true)
        return
      }
      setAnswer(spoken.current)
      setDictating(false)
      coach.dictating(false)
    }

    recognition.current = engine
    lock.allowPrompt() // the browser may ask for the microphone: that is not leaving the interview
    engine.start()
    setDictating(true)
    coach.dictating(true)
  }

  // ── One question at a time ──────────────────────────────────────────────────────────────────────
  const show = (next) => {
    stopDictation()
    signals.current = { typed: 0, dictated: 0, pastes: 0 }
    setQuestion(next)
    setAnswer('')
    setSendProblem('')
    setPasteNote(false)
    setAwayNote(null)
    setDeadline(Date.now() + next.seconds_left * 1000)
    setNow(Date.now())
    if (readAloud && voiceWorks) speak(next.question_text)
    else stopVoice()
    requestAnimationFrame(() => answerBox.current?.focus())
  }

  const finish = async () => {
    done.current = true
    stopVoice()
    stopDictation()
    setDeadline(null)
    setScoreProblem('')
    setPhase('scoring')
    lock.exit()
    delivery.current ??= coach.finish()
    coach.turnOff()
    try {
      // scoring may take more than one request: this keeps asking until it is done
      await scoreInterview(sessionId.current, {
        attempt: attempt.current,
        ...(delivery.current ? { delivery: delivery.current } : {}),
      })
      navigate(`/results/${sessionId.current}`, { replace: true, state: { justFinished: true } })
    } catch (err) {
      setScoreProblem(err.message)
    }
  }

  // Send the answer on screen (empty counts as skipped) and move to the next question.
  const send = async () => {
    if (busy.current || !question) return
    busy.current = true
    stopVoice()
    stopDictation()
    setSending(true)
    setSendProblem('')
    const body = { attempt: attempt.current, question_id: question.id, answer }
    if (locked) body.signals = { ...signals.current }

    let res = null
    let refusal = null
    for (let tries = 0; tries < 4 && !res && !refusal; tries += 1) {
      try {
        res = await answerQuestion(sessionId.current, body)
      } catch (err) {
        if (err.status) refusal = err
        else await wait(1500) // offline: the server allows a short grace, so keep trying
      }
    }
    busy.current = false
    setSending(false)

    if (refusal?.status === 410) return showResults()
    if (refusal) {
      done.current = true
      setFailure(explain(refusal, weekly))
      setPhase('failed')
      return undefined
    }
    if (!res) {
      setSendProblem('Your answer could not be sent. Check your connection and try again.')
      return undefined
    }
    if (answer.trim() && !res.late) setAnswered((n) => n + 1)
    setLateNote(res.late)
    if (res.next) {
      coach.nextQuestion()
      show(res.next)
    } else {
      finish()
    }
    return undefined
  }

  const begin = async () => {
    if (starting) return
    setStarting(true)
    attempt.current ??= newAttempt()
    if (locked) await lock.enter() // must follow the click directly, or the browser refuses full screen
    if (coach.status === 'on') {
      setPhase('settling')
      setCount(SETTLE_SECONDS)
      const ticking = setInterval(() => setCount((n) => Math.max(1, n - 1)), 1000)
      await coach.settle(SETTLE_SECONDS * 1000)
      clearInterval(ticking)
    }
    try {
      const res = await beginInterview(sessionId.current, attempt.current)
      begun.current = true
      coach.begin()
      setPhase('interview')
      show(res.question)
    } catch (err) {
      lock.exit()
      coach.turnOff()
      setFailure(explain(err, weekly))
      setPhase('failed')
    }
    setStarting(false)
  }

  // The clock. When it reaches zero the answer on screen is sent and the next question starts.
  const tick = useEffectEvent(() => {
    const time = Date.now()
    setNow(time)
    if (phase === 'interview' && deadline != null && time >= deadline) send()
  })

  useEffect(() => {
    if (phase !== 'interview' && phase !== 'ready') return undefined
    const timer = setInterval(tick, phase === 'interview' ? 250 : 5000)
    return () => clearInterval(timer)
  }, [phase])

  // Tell the server the page is still open, and take its clock as the true one.
  const checkInNow = useEffectEvent(() => {
    checkIn(sessionId.current, attempt.current)
      .then((res) => {
        if (res.ended) showResults()
        else if (res.seconds_left != null && deadline != null && !busy.current) {
          const serverDeadline = Date.now() + res.seconds_left * 1000
          if (Math.abs(serverDeadline - deadline) > 3000) setDeadline(serverDeadline)
        }
      })
      .catch((err) => {
        if (err.status === 410) showResults()
      })
  })

  useEffect(() => {
    if (phase !== 'interview') return undefined
    const timer = setInterval(checkInNow, CHECK_IN_MS)
    return () => clearInterval(timer)
  }, [phase])

  // Closing or reloading the page part-way ends the interview. The browser asks first, and the
  // server is told as the page goes.
  useEffect(() => {
    if (phase !== 'interview') return undefined
    const warn = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [phase])

  useEffect(() => {
    const onHide = () => {
      if (begun.current && !done.current) abandonOnClose(sessionId.current)
    }
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      // left with the browser's back button: the page is gone, so the interview is over
      if (begun.current && !done.current) abandonInterview(sessionId.current).catch(() => {})
    }
  }, [])

  // Whatever happens, let go of the microphone, the audio and full screen on the way out.
  useEffect(
    () => () => {
      audio.current?.pause()
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current)
      if (recognition.current) {
        recognition.current.onend = null
        recognition.current.stop()
      }
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    },
    [],
  )

  if (!valid) return <Navigate to="/interview-hub" replace />

  const leave = async () => {
    stopVoice()
    stopDictation()
    lock.exit()
    coach.turnOff()
    if (begun.current && !done.current) {
      done.current = true
      await abandonInterview(sessionId.current).catch(() => {})
      navigate(weekly ? `/results/${sessionId.current}` : '/interview-hub?tab=practice', { replace: true })
    } else {
      navigate(weekly ? '/interview-hub' : '/interview-hub?tab=practice')
    }
  }

  const backToInterview = async () => {
    await lock.enter()
    setLeftNotice(null)
    requestAnimationFrame(() => answerBox.current?.focus())
  }

  const blockPaste = (event) => {
    if (!locked) return
    event.preventDefault()
    signals.current.pastes += 1
    setPasteNote(true)
    reportEvent(sessionId.current, { attempt: attempt.current, type: 'paste' }).catch(() => {})
  }

  const onType = (event) => {
    const value = event.target.value
    const native = event.nativeEvent
    const grew = value.length - answer.length
    // characters the person put there themselves; text set by a script does not count
    if (grew > 0 && native?.isTrusted !== false && !/Paste|Drop/.test(native?.inputType || '')) signals.current.typed += grew
    setAnswer(value)
    coach.typed()
  }

  const rail = coachShown ? (
    <CoachTile
      status={coach.status}
      mic={coach.mic}
      tip={coach.tip}
      better={coach.better}
      facts={coach.facts}
      lines={coach.lines}
      sound={coach.sound}
      problems={coach.problems}
      present={coach.present}
      attach={coach.attach}
      mode={phase === 'interview' ? 'live' : phase === 'settling' ? 'settle' : 'setup'}
      count={count}
    />
  ) : null

  // ── Screens ─────────────────────────────────────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <Frame kind={kind} centered>
        <div className="iv-wait" role="status">
          <span className="spinner" aria-hidden="true" />
          <h1>Writing your questions</h1>
          <p>
            {weekly
              ? 'They are built from the roles you saved. This usually takes under a minute.'
              : `For a ${jobTitle} role in ${industry}. This usually takes under a minute.`}
          </p>
        </div>
      </Frame>
    )
  }

  if (phase === 'failed') {
    return (
      <Frame kind={kind} centered>
        <div className="iv-wait">
          <h1>{failure.title}</h1>
          <p>{failure.text}</p>
          <Link to="/interview-hub" className="btn primary">
            Back to interviews
          </Link>
        </div>
      </Frame>
    )
  }

  if (phase === 'scoring') {
    return (
      <Frame kind={kind} centered>
        {scoreProblem ? (
          <div className="iv-wait">
            <h1>Scoring did not finish</h1>
            <p>{/saved/i.test(scoreProblem) ? scoreProblem : `${scoreProblem} Your answers are saved. Nothing is lost by trying again.`}</p>
            <button type="button" className="btn primary" onClick={finish}>
              Try again
            </button>
          </div>
        ) : (
          <div className="iv-wait" role="status">
            <span className="spinner" aria-hidden="true" />
            <h1>{weekly ? 'Scoring your interview' : 'Grading your answers'}</h1>
            <p>
              {weekly
                ? 'Each answer is graded, then the interview is scored against every open role in your field. Your answers are saved, so it is safe to wait here.'
                : 'Each answer gets a score and feedback. This can take a minute.'}
            </p>
          </div>
        )}
      </Frame>
    )
  }

  if (phase === 'ready' || phase === 'settling') {
    const code = session.outline.filter((q) => q.question_type === 'code').length
    const minutes = Math.round(session.outline.reduce((sum, q) => sum + q.seconds, 0) / 60)
    const minutesToBegin = Math.max(0, Math.ceil((session.beginBy - now) / 60000))
    const settling = phase === 'settling'

    return (
      <Frame kind={kind} onLeave={settling ? null : () => setLeaving(true)} rail={rail}>
        <div className="iv-ready">
          <h1>{settling ? 'Look at your camera' : 'Your interview is ready'}</h1>
          <p className="iv-ready-lead">
            {settling
              ? `The first question appears in ${count}.`
              : `${plural(session.count, 'question')}${code > 0 ? `, ${code} of them coding` : ''}. Up to ${minutes} minutes.`}
          </p>

          {!settling && (
            <>
              <ul className="plain-list">
                <li>
                  One question at a time. Five minutes each{code > 0 && ', ten for a coding question'}. When the time
                  is up, your answer is sent and the next question starts. You cannot go back.
                </li>
                <li>
                  Type your answers, or dictate them
                  {Recognition
                    ? '. Dictation is done by your browser, which may send the sound to its maker to be turned into text.'
                    : ' (dictation needs Chrome or Edge).'}
                </li>
                {weekly ? (
                  <>
                    <li>
                      The interview runs in full screen. Leaving it, switching tabs or switching windows is recorded.
                      You may do so {session.leavesAllowed} times. The next time ends the interview.
                    </li>
                    <li>Pasting is turned off.</li>
                    <li>
                      Closing or reloading the page ends the interview. An interview that ends early scores 0 and
                      sends nothing.
                    </li>
                    <li>Companies you apply to see whether you stayed in the interview.</li>
                  </>
                ) : (
                  <li>Afterwards you get a score and feedback for every answer.</li>
                )}
              </ul>

              <div className="iv-options">
                <label className="check">
                  <input type="checkbox" checked={readAloud} onChange={(event) => setReadAloud(event.target.checked)} />
                  Read each question aloud
                </label>

                {!weekly && (
                  <div className="iv-offer">
                    <div>
                      <h2>Camera and voice coach</h2>
                      <p>
                        Watches your eye contact and posture. Listens to your pace, tone and filler words when you
                        answer aloud. Worked out on this device: no video or sound is saved or sent.
                      </p>
                    </div>
                    {coachShown ? (
                      <button type="button" className="btn secondary" onClick={coach.turnOff}>
                        Turn off
                      </button>
                    ) : (
                      coach.status !== 'unsupported' && (
                        <button type="button" className="btn secondary" onClick={coach.turnOn}>
                          <Icon name="video" size={18} />
                          {coach.status === 'off' ? 'Turn on the coach' : 'Try again'}
                        </button>
                      )
                    )}
                  </div>
                )}
                {coach.status === 'blocked' && (
                  <Notice icon="alert">
                    The camera is blocked for this site. Allow it from the address bar, then try again. You can also
                    practise without the coach.
                  </Notice>
                )}
                {coach.status === 'unsupported' && (
                  <Notice icon="info">This page cannot use a camera here, so the coach is not available.</Notice>
                )}
                {coach.status === 'failed' && (
                  <Notice icon="alert">The coach could not load. You can practise without it, or try again.</Notice>
                )}
              </div>

              <div className="iv-go">
                <button type="button" className="btn primary lg" onClick={begin} disabled={starting || minutesToBegin === 0}>
                  {weekly ? 'Go full screen and begin' : 'Begin'}
                </button>
                <p className="hint">
                  {minutesToBegin === 0
                    ? 'The time to begin has run out.'
                    : `Begin within ${plural(minutesToBegin, 'minute')}. After that these questions close${weekly ? ' and this week’s interview is used' : ''}.`}
                </p>
              </div>
            </>
          )}
        </div>
        {leaving && <LeaveDialog weekly={weekly} begun={false} onStay={() => setLeaving(false)} onLeave={leave} />}
      </Frame>
    )
  }

  const words = countWords(answer)
  const urgent = left <= 30
  const leavesLeft = Math.max(0, (session.leavesAllowed ?? 0) - leaves)

  return (
    <Frame kind={kind} onLeave={() => setLeaving(true)} rail={rail}>
      {/* while the "you left" screen is up, the question behind it cannot be reached with the keyboard either */}
      <div
        className={locked ? 'no-copy' : undefined}
        onContextMenu={locked ? (event) => event.preventDefault() : undefined}
        inert={leftNotice ? true : undefined}
      >
        <QuestionFrame
          as="h1"
          index={question.question_order + 1}
          total={session.count}
          kind={question.question_type}
          question={question.question_text}
          urgent={urgent}
          timer={<Digits value={clock(left)} />}
          foot={
            <>
              <span>
                {answered} of {session.count} answered
                {locked && leaves > 0 && `. Left the interview ${leaves === 1 ? 'once' : `${leaves} times`}`}
              </span>
              <button type="button" className={`btn ${answer.trim() || last ? 'primary' : 'secondary'}`} onClick={send} disabled={sending}>
                {sending ? 'Sending' : last ? 'Finish interview' : answer.trim() ? 'Next question' : 'Skip question'}
              </button>
            </>
          }
        >
          <p className="sr-only" role="timer" aria-live="polite">
            {left === 60 ? 'One minute left.' : left === 10 ? 'Ten seconds left.' : ''}
          </p>

          {lateNote && (
            <Notice icon="clock">
              The last answer reached the server after its time was up, so it was not counted.
            </Notice>
          )}
          {awayNote != null && (
            <Notice icon="info">
              You left this window for {plural(awayNote, 'second')}. In the weekly interview that is recorded, and the
              third time ends it.
            </Notice>
          )}

          {speaking && (
            <div className="iv-voice">
              <Icon name="volume" size={18} />
              Reading the question aloud
              <button type="button" className="btn quiet sm" onClick={stopVoice}>
                Stop
              </button>
            </div>
          )}

          <div className="iv-answer">
            <label htmlFor="answer" className="sr-only">
              Your answer
            </label>
            <textarea
              id="answer"
              ref={answerBox}
              className={`textarea ${question.question_type === 'code' ? 'code' : ''}`}
              rows={10}
              value={answer}
              onChange={onType}
              onPaste={blockPaste}
              onDrop={blockPaste}
              readOnly={sending}
              placeholder={
                question.question_type === 'code'
                  ? 'Write your code or pseudocode here, and say how it works.'
                  : 'Type your answer here.'
              }
              spellCheck={question.question_type !== 'code'}
            />
            <div className="iv-tools">
              <div className="cluster">
                {Recognition && (
                  <button
                    type="button"
                    className={`btn secondary sm ${dictating ? 'live' : ''}`}
                    aria-pressed={dictating}
                    onClick={dictating ? stopDictation : () => startDictation()}
                  >
                    {dictating ? <span className="iv-rec" aria-hidden="true" /> : <Icon name="mic" size={16} />}
                    {dictating ? 'Stop dictating' : 'Dictate'}
                  </button>
                )}
                {voiceWorks && !speaking && (
                  <button type="button" className="btn quiet sm" onClick={() => speak(question.question_text)}>
                    <Icon name="volume" size={16} />
                    Read aloud
                  </button>
                )}
              </div>
              <span className="iv-words">
                {words} {words === 1 ? 'word' : 'words'}
                {question.question_type !== 'code' && <span className="muted">. 80 to 250 scores best</span>}
              </span>
            </div>
          </div>

          {pasteNote && (
            <Notice icon="alert">Pasting is turned off in the weekly interview. The attempt was recorded.</Notice>
          )}
          {dictationProblem && <Notice icon="alert">{dictationProblem}</Notice>}
          {sendProblem && <Notice tone="stop">{sendProblem}</Notice>}
        </QuestionFrame>
      </div>

      {leftNotice && (
        <div className="iv-away" role="alertdialog" aria-modal="true" aria-labelledby="away-title">
          <div>
            <h2 id="away-title">You left the interview</h2>
            <p>
              {leftNotice.how === 'fullscreen'
                ? 'You came out of full screen.'
                : leftNotice.how === 'hidden'
                  ? 'You switched to another tab or hid this window.'
                  : 'You switched to another window.'}{' '}
              It has been recorded.
            </p>
            <p className="iv-away-count">
              {leavesLeft === 0
                ? 'That was the last time allowed. Leaving again ends the interview with a score of 0.'
                : `You may leave ${leavesLeft === 1 ? 'once more' : `${leavesLeft} more times`}. After that, leaving ends the interview with a score of 0.`}
            </p>
            <p className="hint">The clock is still running.</p>
            <button type="button" className="btn primary lg" onClick={backToInterview} autoFocus>
              Back to the interview
            </button>
          </div>
        </div>
      )}

      {leaving && <LeaveDialog weekly={weekly} begun onStay={() => setLeaving(false)} onLeave={leave} />}
    </Frame>
  )
}

function LeaveDialog({ weekly, begun, onStay, onLeave }) {
  return (
    <Modal
      title={begun && weekly ? 'End this interview?' : 'Leave this interview?'}
      onClose={onStay}
      foot={
        <>
          <button type="button" className="btn secondary" onClick={onStay} data-autofocus>
            Stay
          </button>
          <button type="button" className="btn danger" onClick={onLeave}>
            {begun && weekly ? 'End interview' : 'Leave'}
          </button>
        </>
      }
    >
      <ul className="plain-list">
        {begun && weekly && <li>Leaving now ends it. It scores 0 and nothing is sent to any company.</li>}
        {begun && !weekly && <li>Your answers so far are not scored.</li>}
        {!begun && (
          <li>
            Your questions stay ready for {LIMITS.beginWithinMinutes} minutes from when they were written. Start the
            same interview again within that time to pick them up.
          </li>
        )}
        <li>
          {weekly
            ? 'This week’s interview stays used. The next one opens seven days after you started this one.'
            : 'This still counts as one of today’s three practice interviews.'}
        </li>
      </ul>
    </Modal>
  )
}
