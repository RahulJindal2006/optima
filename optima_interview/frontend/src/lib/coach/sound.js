// What a short stretch of microphone sound says: how loud it is and, if it is a voiced sound, its pitch.
// Plain arithmetic over samples: no microphone and no page, so it can be checked against recordings.

// The limits behind the reading.
export const SOUND = {
  pitch: [65, 420], // Hz. A speaking voice sits inside this; outside it is not taken as pitch
  workRate: 16000, // samples a second the pitch is worked out at (the sound is thinned to about this)
  window: 0.025, // seconds of sound compared with itself, shifted, to find the pitch
  firstDip: 0.15, // how alike the sound and its shifted self must be to take the first match (0 is identical)
  voiced: 0.3, // with no such match, the best one still counts as a voice below this
  silence: -72, // decibels: quieter than this is nothing at all
}

// How many samples readSound needs at a given microphone rate (a power of two, as the browser's meter wants).
export function samplesNeeded(sampleRate) {
  const seconds = SOUND.window + 1 / SOUND.pitch[0] + 0.002
  let size = 256
  while (size < seconds * sampleRate) size *= 2
  return size
}

// Makes a reader for one microphone rate. The reader takes the latest samples (-1 to 1) and returns
//   db     how loud, in decibels below the loudest the microphone can report (0 is the top, -90 is silence)
//   peak   the largest sample, 0 to 1 (close to 1 means the sound is being cut off)
//   pitch  in Hz when the sound is a voice holding a note, otherwise 0
export function createSoundReader(sampleRate) {
  const thin = Math.max(1, Math.round(sampleRate / SOUND.workRate))
  const rate = sampleRate / thin
  const longest = Math.ceil(rate / SOUND.pitch[0]) // the shift that matches the lowest pitch
  const shortest = Math.max(2, Math.floor(rate / SOUND.pitch[1]))
  const span = Math.round(SOUND.window * rate)
  const need = span + longest + 1
  const work = new Float32Array(need)
  const unlike = new Float32Array(longest + 2)

  return (samples) => {
    const n = samples.length
    let sum = 0
    let squares = 0
    let peak = 0
    for (let i = 0; i < n; i += 1) {
      const v = samples[i]
      sum += v
      squares += v * v
      const size = v < 0 ? -v : v
      if (size > peak) peak = size
    }
    const mean = n ? sum / n : 0
    const rms = Math.sqrt(Math.max(0, n ? squares / n - mean * mean : 0))
    const db = rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100
    const out = { db, peak, pitch: 0 }
    if (db < SOUND.silence || Math.floor(n / thin) < need) return out

    // Thin the newest part of the sound to the working rate. Each kept sample is a weighted average of its
    // neighbours, which removes what is too high-pitched to survive the thinning.
    const start = n - need * thin
    for (let i = 0; i < need; i += 1) {
      const at = start + i * thin
      let total = 0
      let weight = 0
      for (let k = 1 - thin; k < thin; k += 1) {
        const j = at + k
        if (j < 0 || j >= n) continue
        const w = thin - (k < 0 ? -k : k)
        total += w * samples[j]
        weight += w
      }
      work[i] = total / weight - mean
    }

    // How unlike the sound is to itself moved along by each shift (the YIN method, de Cheveigné and
    // Kawahara 2002). A voice repeats once per cycle of its pitch, so the unlikeness dips at that shift.
    let running = 0
    let best = 0
    let bestValue = Infinity
    let found = 0
    unlike[0] = 1
    for (let shift = 1; shift <= longest; shift += 1) {
      let d = 0
      for (let j = 0; j < span; j += 1) {
        const gap = work[j] - work[j + shift]
        d += gap * gap
      }
      running += d
      const value = running > 0 ? (d * shift) / running : 1
      unlike[shift] = value
      if (shift < shortest) continue
      if (value < bestValue) {
        bestValue = value
        best = shift
      }
      if (!found && value < SOUND.firstDip) found = shift
      // once a match is found, follow it down to the bottom of its dip and stop
      if (found && shift > found && value > unlike[shift - 1]) {
        best = shift - 1
        bestValue = unlike[best]
        break
      }
    }
    if (!best || bestValue > (found ? SOUND.firstDip : SOUND.voiced)) return out

    // the true bottom of the dip lies between two shifts: fit a curve through the three around it
    let exact = best
    if (best > 1 && best < longest) {
      const a = unlike[best - 1]
      const b = unlike[best]
      const c = unlike[best + 1]
      const bend = a - 2 * b + c
      if (bend > 0) exact = best + (0.5 * (a - c)) / bend
    }
    const pitch = rate / exact
    if (pitch >= SOUND.pitch[0] && pitch <= SOUND.pitch[1]) out.pitch = pitch
    return out
  }
}

// Pitch as a count of semitones above a fixed low note, so that distances mean the same for a low voice
// and a high one. Twelve semitones is a doubling of the pitch.
export const semitones = (hz) => 12 * Math.log2(hz / 55)
