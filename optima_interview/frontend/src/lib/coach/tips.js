// The words the coach uses: one short tip while you answer, and a few notes afterwards.
// The advice follows what interview coaches teach for video: look into the lens, camera at eye level,
// sit an arm's length away with your eyes about a third of the way down the picture, light in front of you,
// speak at a pace a listener can follow, and pause instead of filling the gap.
import { DRIFT } from './tally.js'
import { VOICE } from './voice.js'

// Live tips, most important first:
//   [problem, how long it has to last before it is mentioned (ms), how often it may be said in one interview (0: as needed)]
// The wait means a glance away or a shift in the chair never sets one off.
const LIVE = [
  ['absent', 2000, 0],
  ['cut', 2500, 0],
  ['dim', 5000, 0],
  ['backlit', 5000, 0],
  ['loud', 2000, 0],
  ['close', 3000, 0],
  ['far', 3000, 0],
  ['offCentre', 3000, 4],
  ['eyesLow', 4000, 4],
  ['eyesHigh', 4000, 4],
  ['faint', 6000, 3],
  ['awaySide', 4000, 5],
  ['awayDown', 5000, 5],
  ['awayUp', 6000, 3],
  ['fast', 3000, 4],
  ['slow', 6000, 3],
  ['sunk', 4000, 4],
  ['leaning', 4000, 4],
  ['tilted', 4000, 3],
  ['long', 0, 0],
  ['fillers', 0, 3],
  ['flat', 6000, 3],
  ['restless', 6000, 2],
]

// Without these being right nothing else can be judged, so they are said at once and stay up until fixed.
const URGENT = new Set(['absent', 'cut', 'dim', 'backlit', 'loud', 'close', 'far'])

// How the coach paces itself, in milliseconds. A coach that talks all the time gets ignored.
export const PACING = {
  read: 4000, // a tip stays up at least this long, so it can be read
  said: 12000, // after this long it has been said: it comes down even if nothing changed
  better: 2500, // how long "Better" is shown once a tip has been acted on
  between: 6000, // quiet between one tip and a different one
  rest: 45000, // before the same tip is given again
  restUrgent: 8000,
}

// Each tip: what to do, then one line on what was noticed. A line may be worked out from `facts`
// ({ pace, fillers, word }) when it quotes a number.
export const TIP_TEXT = {
  absent: ['Move into the picture', 'The camera cannot find your face.'],
  cut: ['Move toward the middle', 'Part of your face is outside the picture.'],
  dim: ['Add light in front of you', 'Your face is too dark to read.'],
  backlit: ['Turn to face the light', 'The light is behind you, so your face is in shadow.'],
  close: ['Sit back a little', 'About an arm’s length from the camera.'],
  far: ['Come a little closer', 'Your face is small in the picture.'],
  offCentre: ['Move to the middle', 'You are off to one side.'],
  eyesLow: ['Sit taller, or tilt the screen down', 'Your eyes should be about a third of the way down the picture.'],
  eyesHigh: ['Tilt the screen up a little', 'Your head is close to the top edge.'],
  cameraLow: ['Raise the camera to eye level', 'It is looking up at you. A few books under the laptop will do.'],
  cameraHigh: ['Lower the camera to eye level', 'It is looking down on you.'],
  sunk: ['Sit back up', 'You are lower in the picture than when you started.'],
  leaning: ['Sit back in your chair', 'You are leaning in toward the screen.'],
  tilted: ['Level your head', 'It is leaning to one side.'],
  awaySide: ['Eyes back to the camera', 'You are looking off to the side.'],
  awayDown: ['Lift your eyes to the camera', 'You are looking down. Glance up as you make your point.'],
  awayUp: ['Come back to the camera', 'Looking up to think is fine. Finish the sentence to the lens.'],
  restless: ['Sit still for a moment', 'You are shifting around in the picture.'],
  fast: ['Slow down', (f) => `About ${f.pace} words a minute. Take a breath at each full stop.`],
  slow: ['Pick up the pace', (f) => `About ${f.pace} words a minute. Shorten the gaps between sentences.`],
  faint: ['Speak up', 'The microphone can barely hear you. Move closer if you can.'],
  loud: ['Ease back from the microphone', 'Your voice is being cut off at the top.'],
  noisy: ['Find a quieter spot', 'The room is nearly as loud as your voice.'],
  flat: ['Put more life in your voice', 'It has stayed on one note. Lean on the word that matters most.'],
  fillers: [
    (f) => (f.word ? `Pause instead of “${f.word}”` : 'Pause instead of filling the gap'),
    (f) => `${f.fillers} filler words in the last minute. A silent beat sounds surer.`,
  ],
  long: ['Start wrapping up', 'You have been talking for over two minutes. Land the result.'],
}

export function tipText(key, facts = {}) {
  const [title, text] = TIP_TEXT[key]
  const say = (line) => (typeof line === 'function' ? line(facts) : line)
  return [say(title), say(text)]
}

// What is said for a moment when a tip has been acted on. A tip with no line here just goes away.
export const BETTER_TEXT = {
  absent: 'In the picture',
  cut: 'In the picture',
  dim: 'Good light',
  backlit: 'Good light',
  close: 'Good distance',
  far: 'Good distance',
  offCentre: 'Well framed',
  eyesLow: 'Well framed',
  eyesHigh: 'Well framed',
  sunk: 'Sitting well',
  leaning: 'Sitting well',
  tilted: 'Sitting well',
  awaySide: 'Eyes on the camera',
  awayDown: 'Eyes on the camera',
  awayUp: 'Eyes on the camera',
  restless: 'Steady',
  fast: 'Good pace',
  slow: 'Good pace',
  faint: 'Good level',
  loud: 'Good level',
  flat: 'More life in your voice',
}

// Which problems a frame has, as the keys used above.
// `eyes` is false while looking away says nothing: before the interview, while typing, while reading a question.
export function problems(flags, { eyes = true } = {}) {
  if (!flags.present) return ['absent']
  const found = []
  for (const key of ['cut', 'close', 'far', 'offCentre', 'eyesLow', 'eyesHigh', 'cameraLow', 'cameraHigh', 'sunk', 'leaning', 'tilted', 'restless']) {
    if (flags[key]) found.push(key)
  }
  if (flags.light === 'dim') found.push('dim')
  if (flags.light === 'backlit') found.push('backlit')
  if (eyes && !flags.facing) found.push(flags.away === 'down' ? 'awayDown' : flags.away === 'up' ? 'awayUp' : 'awaySide')
  return found
}

// Which problems the voice has right now. `now` is what voice.js reports; nothing is said until it has
// heard enough to be sure, and pace is left alone where the room is too noisy to time speech well.
export function voiceProblems(now) {
  if (!now) return []
  const found = []
  const clear = !now.metered || now.level === null || now.level - now.room >= VOICE.clear
  if (now.clipping) found.push('loud')
  if (now.metered && now.spoken >= 6 && now.level !== null && now.level < VOICE.faint) found.push('faint')
  if (now.pace !== null && clear) {
    if (now.pace > VOICE.paceNow[1]) found.push('fast')
    else if (now.pace < VOICE.paceNow[0]) found.push('slow')
  }
  if (now.range !== null && now.range < VOICE.range[0]) found.push('flat')
  if (now.fillerRate !== null && now.fillerRate >= 6) found.push('fillers')
  if (now.talk >= VOICE.wrapUp) found.push('long')
  return found
}

// Decides what, if anything, to say now. Call it with everything that is wrong (`found`) and the time (ms).
// Returns { tip, better }: the tip to show, or the tip that has just been put right, or neither.
export function createTipper() {
  const since = {} // when each problem began
  const told = {} // key -> { times, ended }
  let showing = null // { key, from }
  let praised = null // { key, until }
  let lastEnded = -Infinity

  const due = (key, hold, limit, now) => {
    if (since[key] == null || now - since[key] < hold) return false
    const past = told[key]
    if (!past) return true
    if (limit && past.times >= limit) return false
    return now - past.ended >= (URGENT.has(key) ? PACING.restUrgent : PACING.rest)
  }

  const next = (now, urgentOnly) => {
    for (const [key, hold, limit] of LIVE) {
      if (urgentOnly && !URGENT.has(key)) continue
      if (!URGENT.has(key) && now - lastEnded < PACING.between) continue
      if (due(key, hold, limit, now)) return key
    }
    return null
  }

  const show = (key, now) => {
    showing = { key, from: now }
    praised = null
    told[key] = { times: (told[key]?.times || 0) + 1, ended: Infinity }
    return { tip: key, better: null }
  }

  const end = (now) => {
    told[showing.key].ended = now
    lastEnded = now
    showing = null
  }

  return (found, now) => {
    for (const key of Object.keys(since)) if (!found.includes(key)) delete since[key]
    for (const key of found) since[key] ??= now

    if (showing) {
      const still = found.includes(showing.key)
      const age = now - showing.from
      if (!still && age >= PACING.read) {
        const fixed = showing.key
        end(now)
        if (BETTER_TEXT[fixed]) praised = { key: fixed, until: now + PACING.better }
      } else if (still && age >= PACING.said && !URGENT.has(showing.key)) {
        end(now) // it has been said. Repeating it now would be nagging
      } else {
        // something that cannot wait may take the place of something that can
        const urgent = URGENT.has(showing.key) ? null : next(now, true)
        if (!urgent) return { tip: showing.key, better: null }
        end(now)
        return show(urgent, now)
      }
    }

    if (praised) {
      const urgent = next(now, true)
      if (urgent) return show(urgent, now)
      if (now < praised.until) return { tip: null, better: praised.key }
      praised = null
    }

    const key = next(now, false)
    return key ? show(key, now) : { tip: null, better: null }
  }
}

// The three lines the coach shows all the time while you answer: where your eyes are, how you are sitting,
// and how you sound. Each is { key, label, text, ok } with ok true, false, or null when it cannot be judged.
export function statusLines({ flags, eyes, why, voice, dictating, canDictate, mic }) {
  const lines = []
  if (!flags?.present) {
    lines.push({ key: 'eyes', label: 'Eyes', text: 'Out of the picture', ok: false })
    lines.push({ key: 'posture', label: 'Posture', text: 'Out of the picture', ok: false })
  } else {
    if (!eyes) {
      const text = why === 'typing' ? 'Not judged while you type' : why === 'reading' ? 'Not judged while you read' : 'Finding where you look'
      lines.push({ key: 'eyes', label: 'Eyes', text, ok: null })
    } else if (flags.facing) {
      lines.push({ key: 'eyes', label: 'Eyes', text: 'On the camera', ok: true })
    } else {
      const text = flags.away === 'down' ? 'Looking down' : flags.away === 'up' ? 'Looking up' : 'Off to the side'
      lines.push({ key: 'eyes', label: 'Eyes', text, ok: false })
    }
    const posture = flags.sunk ? 'Sunk in the chair' : flags.leaning ? 'Leaning in' : flags.tilted ? 'Head tilted' : null
    lines.push({ key: 'posture', label: 'Posture', text: posture || 'Upright', ok: !posture })
  }

  let sound
  if (!canDictate) sound = { text: 'Needs dictation, which this browser lacks', ok: null }
  else if (!dictating) sound = { text: 'Press Dictate and answer aloud', ok: null }
  else if (voice?.pace != null) {
    const pace = Math.round(voice.pace / 5) * 5
    sound = { text: `About ${pace} words a minute`, ok: voice.pace >= VOICE.paceNow[0] && voice.pace <= VOICE.paceNow[1] }
  } else if (mic === 'on' && voice && !voice.speaking && voice.spoken < 1) sound = { text: 'Listening', ok: null }
  else sound = { text: 'Hearing you', ok: true }
  lines.push({ key: 'voice', label: 'Voice', ...sound })
  return lines
}

const percent = (value) => `${Math.round(value * 100)}%`
const quote = (word) => `“${word}”`
// "3.5 a minute", but "28 a minute": past ten the decimal is noise
const rate = (value) => (value >= 10 ? Math.round(value) : value)

// The share of time the eyes were on the camera worth reporting: while speaking if that was measured
// (the moment it matters), otherwise whenever it could be judged.
export const eyeShare = (summary) => (summary?.eye_speaking != null ? summary.eye_speaking : summary?.eye_contact)

// Holding eye contact 60 to 70% of the time is what reads as engaged (Noah Zandan of Quantified
// Communications, 2020). In recorded video interviews, looking a little below the lens did not cost
// candidates; looking to the side did (Basch and Melchers, Journal of Business and Psychology, 2024).
export const EYE_AIM = 0.6

// Notes for the results page. Returns
//   fixes  what to work on, most useful first: [{ key, title, text }]
//   good   what went well
//   notes  what could not be measured, and why
export function advise(summary) {
  const out = { fixes: [], good: [], notes: [] }
  if (!summary || (summary.seconds || 0) < 20) return out
  const fixes = []
  const fix = (weight, key, title, text) => fixes.push({ weight, key, title, text })
  const good = (key, title, text) => out.good.push({ key, title, text })
  const voice = summary.voice || null
  const eye = eyeShare(summary)
  const spoke = summary.eye_speaking != null

  if ((summary.in_frame ?? 1) < 0.9) {
    fix(
      9 + (0.9 - summary.in_frame) * 10,
      'frame',
      `You were out of the picture ${percent(1 - summary.in_frame)} of the time`,
      'Check where the camera points before you start, and stay where it can see you.',
    )
  }
  if (summary.light === 'backlit') {
    fix(8, 'light', 'The light was behind you', 'Sit facing a window or a lamp. Light from behind leaves your face in shadow.')
  } else if (summary.light === 'dim') {
    fix(8, 'light', 'Your face was hard to see', 'Put a lamp behind the camera, pointing at you, or sit facing a window.')
  }

  if (eye != null && eye < EYE_AIM) {
    const where =
      summary.away_mostly === 'down'
        ? 'They mostly went down, to the screen or to notes. Move what you are reading up beside the lens, and look into it as you finish each point.'
        : summary.away_mostly === 'side'
          ? 'They mostly went to one side. If that is a second screen, move this window under the camera.'
          : summary.away_mostly === 'up'
            ? 'They mostly went up while you thought. That is natural: come back to the lens before you finish the sentence.'
            : 'Put a small sticker beside the lens and talk to that, not to your own picture.'
    fix(
      7 + (EYE_AIM - eye) * 10,
      'eyes',
      `Your eyes were on the camera ${percent(eye)} of the time${spoke ? ' you were speaking' : ''}`,
      `${where} Aim for ${percent(EYE_AIM)} or more.`,
    )
  } else if (eye != null) {
    good('eyes', `Your eyes were on the camera ${percent(eye)} of the time${spoke ? ' you were speaking' : ''}`, 'That reads as attention. Keep it.')
  }

  if (voice?.level === 'faint') {
    fix(7.5, 'level', 'The microphone could barely hear you', 'An interviewer would strain to hear you too. Sit closer to the microphone and speak to the far wall.')
  } else if (voice?.level === 'loud') {
    fix(7.5, 'level', 'Your voice was hitting the top of the microphone’s range', 'It distorts at the other end. Move back a little, or turn the input volume down.')
  } else if (voice?.level === 'noisy') {
    fix(7, 'level', 'The room was nearly as loud as your voice', 'Find a quieter spot or use a headset. The microphone hears the room as well as it hears you.')
  }

  if (voice?.pace != null) {
    const [slow, fast] = VOICE.pace
    if (voice.pace > fast) {
      fix(
        6 + Math.min(3, (voice.pace - fast) / 20),
        'pace',
        `You spoke at about ${voice.pace} words a minute`,
        `That is fast enough to lose a listener. Aim for ${slow} to ${fast}: finish the sentence, breathe, then start the next.`,
      )
    } else if (voice.pace < slow) {
      fix(
        6 + Math.min(3, (slow - voice.pace) / 20),
        'pace',
        `You spoke at about ${voice.pace} words a minute`,
        `That is slow enough to sound unsure. Aim for ${slow} to ${fast}: keep the pauses between points, lose the ones inside sentences.`,
      )
    } else if (voice.pace >= 125 && voice.pace <= 170) {
      good('pace', `A steady ${voice.pace} words a minute`, 'Easy to follow.')
    }
  }

  if (voice?.filler_rate != null) {
    if (voice.filler_rate >= VOICE.fillers[1]) {
      fix(
        6 + Math.min(3, (voice.filler_rate - VOICE.fillers[1]) / 2),
        'fillers',
        `About ${rate(voice.filler_rate)} filler words a minute${voice.filler_top ? `, mostly ${quote(voice.filler_top)}` : ''}`,
        'One or two a minute goes unnoticed. When you feel one coming, stop and say nothing for a beat.',
      )
    } else if (voice.filler_rate <= VOICE.fillers[0] && (voice.words || 0) >= 100) {
      good('fillers', 'Hardly any filler words', voice.filler_rate > 0 ? `About ${voice.filler_rate} a minute.` : 'None that dictation caught.')
    }
  }

  if (summary.posture != null && summary.posture < 0.75) {
    fix(
      5 + (0.75 - summary.posture) * 10,
      'posture',
      `You sat upright and level ${percent(summary.posture)} of the time`,
      'Raise the screen until the camera is level with your eyes. It is the easiest way to stop sinking.',
    )
  } else if (summary.posture != null && summary.posture >= 0.9) {
    good('posture', 'You sat upright almost throughout', 'Nothing to change.')
  }

  if (voice?.range != null) {
    if (voice.range < VOICE.range[0]) {
      fix(
        5 + (VOICE.range[0] - voice.range),
        'range',
        'Your voice stayed close to one note',
        `Its pitch moved over about ${voice.range} semitones, where lively speech covers ${VOICE.range[1]} or more. Pick the word in each sentence that matters and lean on it.`,
      )
    } else if (voice.range >= VOICE.range[1]) {
      good('range', 'Your voice had life in it', `Its pitch moved over about ${voice.range} semitones.`)
    }
  }

  if (summary.distance_mostly === 'close') {
    fix(4, 'distance', 'You sat too close', 'An arm’s length from the camera shows your shoulders and leaves room for your hands.')
  } else if (summary.distance_mostly === 'far') {
    fix(4, 'distance', 'You sat too far back', 'Come closer until your head and shoulders fill the picture.')
  } else if (summary.centred != null && summary.centred < 0.75) {
    fix(2, 'framing', 'You drifted out of the middle', 'Keep your head in the middle of the picture, with your eyes about a third of the way down.')
  }

  // Eye contact is held in stretches with short glances away between them. A long look away breaks it,
  // whatever the total says.
  if ((summary.look_aways || 0) >= 3 || (summary.longest_away || 0) >= 10) {
    const where = summary.away_mostly === 'down' ? ' Your eyes went down.' : summary.away_mostly === 'side' ? ' Your eyes went to one side.' : ''
    fix(
      4 + Math.min(2, (summary.longest_away || 0) / 15),
      'glances',
      (summary.look_aways || 0) >= 3
        ? `You looked away for more than three seconds ${summary.look_aways} times`
        : `You looked away for ${summary.longest_away} seconds at a stretch`,
      `${(summary.look_aways || 0) >= 3 && summary.longest_away ? `The longest was ${summary.longest_away} seconds.` : ''}${where} Looking away to think is fine. Come back to the lens before you finish the sentence.`.trim(),
    )
  }
  if ((voice?.longest_answer || 0) >= 180) {
    const minutes = Math.round(voice.longest_answer / 30) / 2
    fix(4, 'length', `Your longest answer ran ${minutes} minutes`, 'Most answers land best in one to two. Lead with the result, then give one example.')
  }
  if ((voice?.long_pauses || 0) >= 2) {
    fix(
      3,
      'pauses',
      `You stopped for four seconds or more ${voice.long_pauses} times mid-answer`,
      'A pause to think is fine before you start. Mid-answer, say what you are doing: “Let me think about that for a second.”',
    )
  }
  if (summary.steady != null && summary.steady < 0.7) {
    fix(3, 'steady', 'You moved around a lot', 'Plant both feet and rest your hands on the desk between gestures.')
  }
  if ((summary.drift || 0) >= DRIFT) {
    fix(
      3,
      'drift',
      'You sank lower as the interview went on',
      `By the end you sat about ${percent(summary.drift)} of a head lower than at the start. Sit right back in the chair so it holds you up.`,
    )
  }
  if ((voice?.hedges || 0) >= 6 && voice.talk > 0 && (voice.hedges / voice.talk) * 60 >= 2) {
    fix(
      2,
      'hedges',
      `You hedged ${voice.hedges} times${voice.hedge_top ? `, mostly ${quote(voice.hedge_top)}` : ''}`,
      'Say what happened without the cushion: “We cut the load time in half”, not “I think we kind of cut it”.',
    )
  }

  fixes.sort((a, b) => b.weight - a.weight)
  out.fixes = fixes.map(({ key, title, text }) => ({ key, title, text }))

  if (eye == null) {
    out.notes.push({
      key: 'eyes-unmeasured',
      title: 'Eye contact was not measured',
      text: 'It is judged only while you are not typing. Dictate an answer next time to get a number.',
    })
  }
  if (!voice) {
    out.notes.push({
      key: 'voice-unmeasured',
      title: 'Your voice was not measured',
      text: 'Answer out loud with Dictate to get your pace, your tone and your filler words.',
    })
  } else if (voice.heard === 'words' && voice.level == null && voice.range == null) {
    out.notes.push({
      key: 'voice-words',
      title: 'Volume and pitch were not measured',
      text: 'The microphone was not available to the coach, so pace was timed from dictation alone.',
    })
  }
  return out
}
