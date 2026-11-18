// Reads the camera with MediaPipe's face landmarker, inside the browser. No picture leaves the page.
// This file is loaded only when someone turns the coach on.
//
// @mediapipe/tasks-vision is pinned to 0.10.35 on purpose. From 1.0 the library reports usage figures to
// Google and asks you to get each user's consent first. 0.10.35 is the last version that reports nothing,
// which is what lets the page say that nothing leaves the device. Read its privacy notice before upgrading.
import loaderUrl from '@mediapipe/tasks-vision/vision_wasm_internal.js?url'
import binaryUrl from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'
import { observe } from './measure'

// The model (about 4 MB). Google hosts it. To serve your own copy, put the file in public/ and set
// VITE_FACE_MODEL_URL to its path.
const MODEL_URL =
  import.meta.env.VITE_FACE_MODEL_URL ||
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task'

const EVERY_MS = 140 // about seven looks a second is plenty for posture, and easy on a laptop
const LIGHT_EVERY_MS = 1000
const SLOW_MS = 60 // a look that takes longer than this means a slow machine: look half as often

let ready = null

// The model runs on the processor. That is a little slower than the graphics card but behaves the same in every browser.
export function loadTracker() {
  ready ||= import('@mediapipe/tasks-vision')
    .then(({ FaceLandmarker }) =>
      FaceLandmarker.createFromOptions(
        { wasmLoaderPath: loaderUrl, wasmBinaryPath: binaryUrl },
        {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
          runningMode: 'VIDEO',
          numFaces: 2, // the second is only counted: a weekly interview records when someone else is in the picture
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        },
      ),
    )
    .catch((err) => {
      ready = null // let a second try start from scratch
      throw err
    })
  return ready
}

export function closeTracker() {
  ready?.then((tracker) => tracker.close()).catch(() => {})
  ready = null
}

// Average brightness of the face and of everything around it, from a thumbnail of the frame.
function measureLight(pen, video, seen) {
  const W = pen.canvas.width
  const H = pen.canvas.height
  pen.drawImage(video, 0, 0, W, H)
  const { data } = pen.getImageData(0, 0, W, H)
  const box = seen?.box
  let face = 0
  let faceCount = 0
  let around = 0
  let aroundCount = 0
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 4
      const brightness = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      if (box && x / W >= box[0] && x / W <= box[2] && y / H >= box[1] && y / H <= box[3]) {
        face += brightness
        faceCount += 1
      } else {
        around += brightness
        aroundCount += 1
      }
    }
  }
  const all = (face + around) / (faceCount + aroundCount)
  return { face: faceCount ? face / faceCount : all, around: aroundCount ? around / aroundCount : all }
}

// How much fine detail the face holds. The spread of the differences between each point and its neighbours
// (the variance of a Laplacian) over a small grey copy of the face, as a share of the spread of the face's
// own brightness, times 100. Dividing by the second makes it a measure of sharpness alone: a dim picture
// has less of both and scores the same as a bright one. Measured on test pictures: a sharp face scores
// about 40, a slightly soft and noisy one about 25, one blurred by 2 pixels about 8, by 4 pixels under 2.
// Null when there is no face.
const SHARP_SIDE = 64

function measureSharpness(pen, video, seen) {
  const box = seen?.box
  if (!box) return null
  const sx = Math.max(0, box[0]) * video.videoWidth
  const sy = Math.max(0, box[1]) * video.videoHeight
  const sw = (Math.min(1, box[2]) - Math.max(0, box[0])) * video.videoWidth
  const sh = (Math.min(1, box[3]) - Math.max(0, box[1])) * video.videoHeight
  if (sw < 24 || sh < 24) return null
  const N = SHARP_SIDE
  pen.drawImage(video, sx, sy, sw, sh, 0, 0, N, N)
  const { data } = pen.getImageData(0, 0, N, N)
  const grey = new Float32Array(N * N)
  for (let i = 0; i < N * N; i += 1) grey[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
  let sum = 0
  let squares = 0
  let count = 0
  let light = 0
  let lightSquares = 0
  for (let y = 1; y < N - 1; y += 1) {
    for (let x = 1; x < N - 1; x += 1) {
      const i = y * N + x
      const edge = 4 * grey[i] - grey[i - 1] - grey[i + 1] - grey[i - N] - grey[i + N]
      sum += edge
      squares += edge * edge
      light += grey[i]
      lightSquares += grey[i] * grey[i]
      count += 1
    }
  }
  const detail = squares / count - (sum / count) ** 2
  const contrast = lightSquares / count - (light / count) ** 2
  return (100 * detail) / (contrast + 1)
}

// Starts reading the camera. `getVideo` returns the <video> on the page now (it can change between screens).
// `onFrame(seen, light, seconds, aspect)` is called a few times a second: `seen` is null when no face was found.
// Returns a function that stops it.
export async function startTracking(getVideo, onFrame) {
  const tracker = await loadTracker()
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 48
  const pen = canvas.getContext('2d', { willReadFrequently: true })
  const close = document.createElement('canvas')
  close.width = SHARP_SIDE
  close.height = SHARP_SIDE
  const closePen = close.getContext('2d', { willReadFrequently: true })

  let stopped = false
  let timer = 0
  let lastAt = 0
  let lightAt = 0
  let light = null
  let cost = 20

  const look = () => {
    if (stopped) return
    const video = getVideo()
    const now = performance.now()
    if (video && video.readyState >= 2 && video.videoWidth && !document.hidden) {
      const aspect = video.videoWidth / video.videoHeight
      let seen = null
      try {
        const result = tracker.detectForVideo(video, now)
        seen = observe(result, aspect)
        cost += (performance.now() - now - cost) * 0.2
        // for tests; not in the built site
        if (import.meta.env.DEV) window.__coach = { cost: Math.round(cost), seen, light, points: result.faceLandmarks?.[0] || null }
      } catch {
        // one unreadable frame is not worth stopping for
      }
      if (now - lightAt >= LIGHT_EVERY_MS) {
        try {
          light = measureLight(pen, video, seen)
          light.sharp = measureSharpness(closePen, video, seen)
        } catch {
          light = null
        }
        lightAt = now
      }
      onFrame(seen, light, lastAt ? (now - lastAt) / 1000 : 0, aspect)
      lastAt = now
    } else {
      lastAt = 0 // time the tab spent hidden is not time on camera
    }
    timer = setTimeout(look, cost > SLOW_MS ? EVERY_MS * 2 : EVERY_MS)
  }
  look()

  return () => {
    stopped = true
    clearTimeout(timer)
  }
}
