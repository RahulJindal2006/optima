// Listens to the microphone through the browser's own meter and looks at it a few times a second.
// No sound is recorded and none leaves the page: each look becomes three numbers (sound.js) and is gone.
import { createSoundReader, samplesNeeded } from './sound.js'

const EVERY_MS = 40

// What the microphone is asked for. Automatic gain is turned off because it would hide how loud the voice
// really is; echo cancelling stays on so the question being read aloud is not taken for the answer.
export const MIC = { echoCancellation: true, noiseSuppression: false, autoGainControl: false }

// Starts reading `stream` (a camera-and-microphone stream, or a microphone one).
// `onSound(reading, seconds)` is called about 25 times a second with what sound.js made of the latest stretch.
// Returns a function that stops it, or null where there is no microphone to read.
export function startListening(stream, onSound) {
  const Context = window.AudioContext || window.webkitAudioContext
  if (!Context || !stream?.getAudioTracks?.().length) return null

  const context = new Context()
  const source = context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()))
  const meter = context.createAnalyser()
  meter.fftSize = samplesNeeded(context.sampleRate)
  meter.smoothingTimeConstant = 0
  // A meter is only run while it leads somewhere, so it leads to the speakers through a volume of zero.
  // Nothing is played back.
  const silent = context.createGain()
  silent.gain.value = 0
  source.connect(meter)
  meter.connect(silent)
  silent.connect(context.destination)

  const samples = new Float32Array(meter.fftSize)
  const bytes = meter.getFloatTimeDomainData ? null : new Uint8Array(meter.fftSize) // older Safari
  const read = createSoundReader(context.sampleRate)
  let lastAt = 0

  const look = () => {
    if (context.state !== 'running') {
      context.resume?.().catch(() => {})
      lastAt = 0
      return
    }
    if (document.hidden) {
      lastAt = 0 // time the tab spent hidden is not time spent answering
      return
    }
    if (bytes) {
      meter.getByteTimeDomainData(bytes)
      for (let i = 0; i < bytes.length; i += 1) samples[i] = (bytes[i] - 128) / 128
    } else {
      meter.getFloatTimeDomainData(samples)
    }
    const now = performance.now()
    const reading = read(samples)
    if (import.meta.env.DEV) window.__mic = reading // for tests; not in the built site
    onSound(reading, lastAt ? (now - lastAt) / 1000 : 0)
    lastAt = now
  }
  const timer = setInterval(look, EVERY_MS)
  context.resume?.().catch(() => {})

  return () => {
    clearInterval(timer)
    try {
      source.disconnect()
      meter.disconnect()
      silent.disconnect()
    } catch {
      // already let go
    }
    context.close?.().catch(() => {})
  }
}
