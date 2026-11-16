// Adds up what the coach saw over an interview, and turns it into the handful of numbers that are kept.
// Time is counted in seconds. Nothing here touches the camera.

const blank = () => ({
  watched: 0, // seconds the camera was being read
  inFrame: 0, // seconds a face was in the picture
  upright: 0,
  framed: 0,
  distanceOk: 0,
  close: 0,
  far: 0,
  steady: 0,
  eyeTime: 0, // seconds over which eye contact was judged (in the picture, not typing, not reading the question)
  facing: 0,
  speakTime: 0, // the part of that time spent speaking
  speakFacing: 0,
  side: 0, // seconds the eyes were away, by where they went
  down: 0,
  up: 0,
  lookAways: 0,
  longestAway: 0,
  dim: 0,
  backlit: 0,
})

const share = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 1000 : null)
const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length

// A glance away is normal. This long with the eyes elsewhere counts as looking away.
export const LOOK_AWAY_SECONDS = 3

// How far the head has to end up below where it began, in head heights, to be called sinking.
export const DRIFT = 0.1

export function createTally() {
  const total = blank()
  const questions = [blank()]
  let awayFor = 0
  // where the head sat, averaged over each ten seconds, to see whether it sank as the interview went on
  const heights = []
  let heightSum = 0
  let heightTime = 0

  return {
    // `flags` is what judge() said about a frame, plus restless and light. `seconds` is the time since the last frame.
    // `eyes` is false while eye contact cannot be expected: typing, or reading a question that has just appeared.
    // `speaking` is true while the person is answering aloud.
    add(flags, seconds, { eyes = true, speaking = false } = {}) {
      const dt = Math.min(Math.max(seconds, 0), 1) // a stalled tab must not count as a minute of slouching
      const now = questions[questions.length - 1]
      for (const sum of [total, now]) {
        sum.watched += dt
        if (flags.light === 'dim') sum.dim += dt
        if (flags.light === 'backlit') sum.backlit += dt
        if (!flags.present) continue
        sum.inFrame += dt
        if (flags.upright) sum.upright += dt
        if (flags.framed) sum.framed += dt
        if (flags.distanceOk) sum.distanceOk += dt
        if (flags.close) sum.close += dt
        if (flags.far) sum.far += dt
        if (!flags.restless) sum.steady += dt
        if (eyes) {
          sum.eyeTime += dt
          if (flags.facing) sum.facing += dt
          else if (flags.away) sum[flags.away] += dt
          if (speaking) {
            sum.speakTime += dt
            if (flags.facing) sum.speakFacing += dt
          }
        }
      }
      if (flags.present && eyes && !flags.facing) {
        const before = awayFor
        awayFor += dt
        if (before < LOOK_AWAY_SECONDS && awayFor >= LOOK_AWAY_SECONDS) {
          total.lookAways += 1
          now.lookAways += 1
        }
        if (awayFor > total.longestAway) total.longestAway = awayFor
        if (awayFor > now.longestAway) now.longestAway = awayFor
      } else {
        awayFor = 0
      }
      if (flags.present && flags.drop != null) {
        heightSum += flags.drop * dt
        heightTime += dt
        if (heightTime >= 10) {
          if (heights.length < 720) heights.push(heightSum / heightTime)
          heightSum = 0
          heightTime = 0
        }
      }
    },

    nextQuestion() {
      questions.push(blank())
      awayFor = 0
    },

    // The numbers that are sent with the interview and shown in the results. No picture is part of it.
    summary() {
      const light = total.backlit > 0.3 * total.watched ? 'backlit' : total.dim > 0.3 * total.watched ? 'dim' : 'good'
      const mostly =
        total.close > 0.3 * total.inFrame && total.close >= total.far
          ? 'close'
          : total.far > 0.3 * total.inFrame
            ? 'far'
            : 'good'
      const away = total.side + total.down + total.up
      const where = ['side', 'down', 'up'].find((key) => total[key] > 0.5 * away)
      // sinking: the last quarter of the interview against the first (needs two minutes to say anything)
      const quarter = Math.floor(heights.length / 4)
      const drift = quarter >= 3 ? mean(heights.slice(-quarter)) - mean(heights.slice(0, quarter)) : null
      const out = {
        seconds: Math.round(total.watched),
        watched_seconds: Math.round(total.eyeTime),
        in_frame: share(total.inFrame, total.watched),
        // under ten seconds of looking is too little to put a number on
        eye_contact: total.eyeTime >= 10 ? share(total.facing, total.eyeTime) : null,
        eye_speaking: total.speakTime >= 10 ? share(total.speakFacing, total.speakTime) : null,
        posture: share(total.upright, total.inFrame),
        centred: share(total.framed, total.inFrame),
        distance: share(total.distanceOk, total.inFrame),
        steady: share(total.steady, total.inFrame),
        look_aways: total.lookAways,
        longest_away: total.longestAway >= LOOK_AWAY_SECONDS ? Math.round(total.longestAway) : null,
        away_mostly: away >= 5 && where ? where : null,
        drift: drift === null ? null : Math.round(drift * 100) / 100,
        light,
        distance_mostly: mostly,
        per_question: questions.map((q) => ({
          seconds: Math.round(q.watched),
          in_frame: share(q.inFrame, q.watched),
          eye_contact: q.eyeTime >= 5 ? share(q.facing, q.eyeTime) : null,
          eye_speaking: q.speakTime >= 5 ? share(q.speakFacing, q.speakTime) : null,
          posture: share(q.upright, q.inFrame),
        })),
      }
      for (const key of Object.keys(out)) if (out[key] === null) delete out[key]
      for (const row of out.per_question) for (const key of Object.keys(row)) if (row[key] === null) delete row[key]
      return out
    },
  }
}
