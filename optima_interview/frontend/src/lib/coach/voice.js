// How an answer sounded: pace, pauses, how much the pitch moved, how well the microphone heard it, and the
// filler words in what dictation wrote down. Fed with readings from sound.js and with the words dictation
// hears. Nothing here touches the microphone, and no sound is kept: only running totals.
import { semitones } from './sound.js'

// The limits behind every voice tip.
export const VOICE = {
  over: 9, // decibels above the room's own noise for a sound to count as speech
  overVoiced: 5, // ...or this much, when the sound is clearly a voice
  stay: 5, // once someone is speaking, this much above the noise keeps it counted as speech
  hang: 0.3, // seconds speech is taken to carry on through a gap (the stops inside words)
  join: 2, // a pause shorter than this is part of speaking; a longer one is time spent thinking
  longPause: 4, // a silence this long in the middle of an answer is worth a mention
  // Words a minute. Conversation runs at about 150. In 32,809 practice talks scored by VirtualSpeech,
  // 140 to 180 rated best, and ratings fell below 80 and above 180.
  pace: [110, 180],
  paceNow: [100, 190], // the live tip waits for a clearer miss than the report does
  // How far the pitch moved, in semitones (twelve to the octave), between the lowest and highest tenth of
  // the voice. Set from sixteen people reading aloud (the TIMIT sample): they span 3.2 to 7.7, middle 5.4.
  // The same recordings with three quarters of their melody removed span 1.1 to 1.8.
  range: [2.5, 4],
  faint: -55, // decibels: a voice the microphone hears below this is hard to make out at the other end
  clear: 14, // a voice less than this many decibels above the room's noise is competing with it
  clipped: 0.985, // a reading that reaches this is being cut off at the top
  // Filler words a minute. About one is ideal and the average speaker uses five (Zandan, Harvard Business
  // Review, 2018).
  fillers: [2, 4],
  wrapUp: 150, // seconds of talking in one answer after which it is time to land it
  minTalk: 20, // seconds of speaking before pace is put into a number
  minVoiced: 8, // seconds of voiced sound before pitch movement is
}

const FILLER_KEYS = ['um', 'uh', 'like', 'you know', 'i mean', 'basically', 'literally', 'actually', 'or something', 'or whatever', 'and stuff', 'yeah']
const HEDGE_KEYS = ['i think', 'i guess', 'i suppose', 'i feel like', 'maybe', 'kind of', 'sort of', 'not sure', 'a little bit', 'hopefully', 'pretty much', 'more or less', 'to be honest', 'if that makes sense', 'i would say']
export const KNOWN_WORDS = { fillers: FILLER_KEYS, hedges: HEDGE_KEYS }

const set = (words) => new Set(words.split(' '))
// "do you know", "as you know", "let you know" are not fillers; nor is "you know what I did"
const BEFORE_KNOW = set("do did if as when once until let lets let's would will might may should could can don't dont didn't didnt to that what how before after")
const AFTER_KNOW = set('what how that why who where when if whether about')
// "what kind of", "this sort of": a real kind, not a hedge
const BEFORE_KIND = set("what which this that these those a the some any same each every one another other different new right wrong best only all no my our their his her its your what's whatever")
const BEFORE_LIKE = set("and so but was were it's its that's thats i'm im he's she's we're they're")
const AFTER_LIKE = set('um uh basically literally really maybe so like')

export const countWords = (text) => (String(text || '').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length

// The filler words and hedges in a stretch of speech, as counts by word. Only clear cases count: "like" is
// counted where it is doing no work ("it was like", "and like"), not in "I would like" or "people like me".
export function countFillers(text) {
  const words = (String(text || '').toLowerCase().replace(/’/g, "'").match(/[a-z0-9][a-z0-9']*/g) || [])
  const fillers = {}
  const hedges = {}
  const add = (bag, key) => {
    bag[key] = (bag[key] || 0) + 1
  }
  const is = (i, ...phrase) => phrase.every((word, k) => words[i + k] === word)
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i]
    const before = words[i - 1]
    const after = (n) => words[i + n]
    if (/^(?:u+m+|u+h+m+|e+rm+|h+m+|m+h*m+)$/.test(w)) add(fillers, 'um')
    else if (/^(?:u+h+|e+r+|a+h+)$/.test(w)) add(fillers, 'uh')
    else if (w === 'like' && (BEFORE_LIKE.has(before) || AFTER_LIKE.has(after(1)) || is(i + 1, 'you', 'know') || is(i + 1, 'i', 'mean') || is(i + 1, 'kind', 'of') || is(i + 1, 'sort', 'of'))) add(fillers, 'like')
    else if (is(i, 'you', 'know') && !BEFORE_KNOW.has(before) && !AFTER_KNOW.has(after(2))) add(fillers, 'you know')
    else if (is(i, 'i', 'mean') && !['it', 'that', 'this', 'to', 'by', 'for'].includes(after(2))) add(fillers, 'i mean')
    else if (w === 'basically' || w === 'literally' || w === 'actually') add(fillers, w)
    else if (is(i, 'or', 'something') || is(i, 'or', 'whatever')) add(fillers, `or ${after(1)}`)
    else if (is(i, 'and', 'stuff')) add(fillers, 'and stuff')
    else if (is(i, 'so', 'yeah') || is(i, 'yeah', 'so') || is(i, 'yeah', 'no')) add(fillers, 'yeah')

    if (is(i, 'i', 'think') && !['about', 'of'].includes(after(2))) add(hedges, 'i think')
    else if (is(i, 'i', 'guess') || is(i, 'i', 'suppose')) add(hedges, `i ${after(1)}`)
    else if (is(i, 'i', 'feel', 'like')) add(hedges, 'i feel like')
    else if (w === 'maybe' || w === 'hopefully') add(hedges, w)
    else if ((is(i, 'kind', 'of') || is(i, 'sort', 'of')) && !BEFORE_KIND.has(before)) add(hedges, `${w} of`)
    else if (is(i, 'not', 'sure')) add(hedges, 'not sure')
    else if (is(i, 'a', 'little', 'bit')) add(hedges, 'a little bit')
    else if (is(i, 'pretty', 'much')) add(hedges, 'pretty much')
    else if (is(i, 'more', 'or', 'less')) add(hedges, 'more or less')
    else if (is(i, 'to', 'be', 'honest')) add(hedges, 'to be honest')
    else if (is(i, 'if', 'that', 'makes', 'sense')) add(hedges, 'if that makes sense')
    else if (is(i, 'i', 'would', 'say') || is(i, "i'd", 'say')) add(hedges, 'i would say')
  }
  return { fillers, hedges }
}

const total = (bag) => Object.values(bag).reduce((sum, n) => sum + n, 0)
const most = (bag) => Object.entries(bag).sort((a, b) => b[1] - a[1])[0] || null
const merge = (into, from) => {
  for (const [key, n] of Object.entries(from)) into[key] = (into[key] || 0) + n
}
const round1 = (value) => Math.round(value * 10) / 10

// Pitch is counted in quarter-semitone steps from 55 Hz up, which covers every speaking voice.
const STEPS = 160
const stepOf = (hz) => Math.min(STEPS - 1, Math.max(0, Math.round(semitones(hz) * 4)))

// The distance, in semitones, between the lowest tenth and the highest tenth of the pitches heard.
// Odd readings (a pitch read an octave out) sit in those tenths and so do not stretch it.
function spread(steps, count) {
  if (count < 1) return null
  let seen = 0
  let low = null
  let high = null
  for (let i = 0; i < STEPS; i += 1) {
    seen += steps[i]
    if (low === null && seen >= count * 0.1) low = i
    if (seen >= count * 0.9) {
      high = i
      break
    }
  }
  return low === null || high === null ? null : (high - low) / 4
}

const blank = () => ({
  talk: 0, // seconds speaking, pauses shorter than VOICE.join included
  speech: 0, // seconds of sound that was speech
  voiced: 0, // seconds in which a pitch was read
  words: 0,
  fillers: {},
  hedges: {},
  steps: new Uint32Array(STEPS),
  pitched: 0,
  longPauses: 0,
  longest: 0,
})

export function createVoice() {
  const all = blank()
  const questions = [blank()]
  let metered = false // readings are coming from the microphone, not only from words arriving

  // the room, and whether someone is speaking
  let floor = null
  let speaking = false
  let run = 0
  let runVoiced = false
  let quiet = 0
  let gap = 0 // seconds since speech last stopped
  let begun = false // this answer has had speech in it
  let sinceWords = 99

  // level, over the whole interview
  const levels = new Uint32Array(101) // readings of speech, by decibel below the top (0 to 100)
  let levelCount = 0
  let clippedCount = 0
  let floorSum = 0
  let floorCount = 0

  // for the tips given while speaking
  const recent = [] // the last pitches read, in quarter-semitone steps
  const marks = [] // { talk, words } once a second of talk, for the pace right now
  const fillerAt = [] // talk time of each filler
  let levelNow = null
  let clippingNow = 0 // the share of recent speech that hit the top of the scale
  let lastMark = 0
  let finalWords = 0
  let interimWords = 0

  const here = () => questions[questions.length - 1]

  const credit = (key, seconds) => {
    all[key] += seconds
    here()[key] += seconds
  }

  const startSpeech = (seconds) => {
    speaking = true
    if (begun && gap < VOICE.join) credit('talk', gap)
    else if (begun && gap >= VOICE.longPause) {
      all.longPauses += 1
      here().longPauses += 1
      all.longest = Math.max(all.longest, gap)
      here().longest = Math.max(here().longest, gap)
    }
    begun = true
    gap = 0
    credit('talk', seconds)
    credit('speech', seconds)
  }

  return {
    // One reading of the microphone (from sound.js), `seconds` after the last. Pass null where there is no
    // meter: speech is then taken from words arriving. `on` is false whenever the person is not answering
    // aloud (dictation is off, or the question is being read out), and nothing is counted.
    hear(reading, seconds, on = true) {
      const dt = Math.min(Math.max(seconds, 0), 0.25) // a stalled page must not count as a long silence
      sinceWords += dt
      metered = Boolean(reading) // which of the two is timing speech now: the microphone, or words arriving
      if (reading) {
        if (floor === null) floor = Math.min(reading.db, -35)
        else if (reading.db < floor) floor += (reading.db - floor) * Math.min(1, dt / 0.15)
        else floor += Math.min(reading.db - floor, dt * (speaking ? 0.2 : 3))
        floor = Math.max(-95, Math.min(-35, floor))
      }
      if (!on) {
        speaking = false
        run = 0
        quiet = 0
        runVoiced = false
        return
      }

      const pitch = reading ? reading.pitch : 0
      const loud = reading
        ? reading.db > floor + (speaking ? VOICE.stay : VOICE.over) || (pitch > 0 && reading.db > floor + VOICE.overVoiced)
        : sinceWords < 0.9
      if (loud) {
        run += dt
        quiet = 0
        if (pitch > 0 || !reading) runVoiced = true
      } else {
        quiet += dt
        if (quiet > 0.12) {
          run = 0
          runVoiced = false
        }
      }

      if (speaking) {
        credit('talk', dt)
        credit('speech', dt)
        if (quiet >= VOICE.hang) {
          // it stopped when the quiet began, not now: give that time back and count it as the pause
          speaking = false
          credit('talk', -quiet)
          credit('speech', -quiet)
          gap = quiet
        }
      } else if (run >= 0.08 && runVoiced) {
        startSpeech(Math.min(run, 0.5)) // a click or a knock is loud but brief and has no pitch: it never gets here
      } else {
        gap += dt
      }

      if (speaking && reading) {
        if (loud) {
          const below = Math.min(100, Math.max(0, Math.round(-reading.db)))
          levels[below] += 1
          levelCount += 1
          const cut = reading.peak >= VOICE.clipped ? 1 : 0
          clippedCount += cut
          clippingNow += (cut - clippingNow) * Math.min(1, dt / 3)
          levelNow = levelNow === null ? reading.db : levelNow + (reading.db - levelNow) * Math.min(1, dt / 4)
          floorSum += floor
          floorCount += 1
        }
        if (pitch > 0) {
          const step = stepOf(pitch)
          all.steps[step] += 1
          all.pitched += 1
          here().steps[step] += 1
          here().pitched += 1
          credit('voiced', dt)
          recent.push(step)
          if (recent.length > 500) recent.shift()
        }
      }

      if (all.talk - lastMark >= 1) {
        lastMark = all.talk
        marks.push({ talk: all.talk, words: finalWords + interimWords })
        if (marks.length > 40) marks.shift()
      }
    },

    // What dictation heard: `finished` is a phrase it has settled on (or ''), `unfinished` is the phrase it
    // is still changing its mind about.
    words(finished, unfinished = '') {
      if (finished) {
        const n = countWords(finished)
        finalWords += n
        all.words += n
        here().words += n
        const found = countFillers(finished)
        merge(all.fillers, found.fillers)
        merge(here().fillers, found.fillers)
        merge(all.hedges, found.hedges)
        merge(here().hedges, found.hedges)
        for (let i = total(found.fillers); i > 0; i -= 1) fillerAt.push(all.talk)
      }
      const before = interimWords
      interimWords = countWords(unfinished)
      if (finished || interimWords > before) sinceWords = 0
    },

    nextQuestion() {
      questions.push(blank())
      begun = false
      speaking = false
      gap = 0
      run = 0
      quiet = 0
      interimWords = 0
    },

    // How it sounds right now, for the tips given while speaking. Each is null until there is enough to go on.
    now() {
      let pace = null
      // the last twenty seconds or so of speaking: long enough that one quick sentence does not count as rushing
      const first = marks.find((m) => all.talk - m.talk <= 25)
      if (first && all.talk - first.talk >= 15) pace = ((finalWords + interimWords - first.words) / (all.talk - first.talk)) * 60
      let range = null
      if (recent.length >= 250) {
        const sorted = [...recent].sort((a, b) => a - b)
        range = (sorted[Math.floor(sorted.length * 0.9)] - sorted[Math.floor(sorted.length * 0.1)]) / 4
      }
      const lately = fillerAt.filter((t) => all.talk - t <= 60).length
      const favourite = most(all.fillers)
      return {
        metered,
        speaking,
        talk: here().talk, // seconds spoken in this answer
        spoken: all.talk,
        pace,
        range,
        level: levelNow,
        room: floor,
        clipping: levelCount >= 25 && clippingNow > 0.08,
        fillerRate: all.talk >= 45 ? lately / (Math.min(all.talk, 60) / 60) : null,
        fillers: lately, // in the last minute of speaking
        word: favourite ? favourite[0] : null, // the filler used most so far
      }
    },

    // The numbers kept with the interview. No sound and no words are part of it, apart from which of the
    // known filler words came up most.
    summary() {
      const numbers = (q) => {
        const out = { talk: Math.round(q.talk), words: q.words }
        if (q.talk >= VOICE.minTalk && q.words >= 25) out.pace = Math.round((q.words / q.talk) * 60)
        const range = q.voiced >= VOICE.minVoiced ? spread(q.steps, q.pitched) : null
        if (range !== null) out.range = round1(range)
        if (q.words >= 25) out.fillers = total(q.fillers)
        return out
      }
      const out = numbers(all)
      if (out.talk < 5 && out.words < 10) return null // nothing was said aloud
      out.heard = metered ? 'microphone' : 'words'
      if (all.words >= 25) {
        out.hedges = total(all.hedges)
        if (all.talk >= VOICE.minTalk) out.filler_rate = round1((total(all.fillers) / all.talk) * 60)
        const filler = most(all.fillers)
        if (filler) {
          out.filler_top = filler[0]
          out.filler_top_count = filler[1]
        }
        const hedge = most(all.hedges)
        if (hedge) {
          out.hedge_top = hedge[0]
          out.hedge_top_count = hedge[1]
        }
      }
      if (metered && levelCount >= 120) {
        // the level in the middle of all the speech heard
        let seen = 0
        let below = 0
        while (below < 100 && (seen += levels[below]) < levelCount / 2) below += 1
        const room = floorSum / floorCount
        out.level =
          clippedCount / levelCount > 0.03 ? 'loud' : -below < VOICE.faint ? 'faint' : -below - room < VOICE.clear ? 'noisy' : 'good'
      }
      out.long_pauses = all.longPauses
      if (all.longest > 0) out.longest_pause = Math.round(all.longest)
      out.longest_answer = Math.round(Math.max(...questions.map((q) => q.talk)))
      out.per_question = questions.map(numbers)
      return out
    },
  }
}
