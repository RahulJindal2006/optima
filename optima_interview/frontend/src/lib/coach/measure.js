// What one camera frame says about how someone is sitting and where they are looking.
// Plain arithmetic over MediaPipe's face landmarks: no camera and no page, so it can be checked with numbers.

const deg = (rad) => (rad * 180) / Math.PI

// Landmark numbers in MediaPipe's face mesh. The subject's right eye is on the left of the picture.
const FOREHEAD = 10
const CHIN = 152
const EYE_OUTER_R = 33
const EYE_INNER_R = 133
const EYE_INNER_L = 362
const EYE_OUTER_L = 263

// The limits behind every tip. Distances are shares of the picture unless they say otherwise.
export const RULES = {
  centre: 0.15, // how far the face may sit from the middle, as a share of the picture's width
  eyeLine: [0.2, 0.55], // the eyes belong in the upper part of the picture, about a third of the way down
  size: [0.22, 0.58], // forehead to chin as a share of the picture's height: less is over a metre away, more is too close
  tilt: 10, // degrees the head may lean to one side
  sink: 0.24, // how far the head may drop from where it started, in head heights
  leanIn: 1.25, // how much larger the face may get before it counts as leaning in
  headTurn: [16, 13], // degrees the head may turn sideways, and upwards, and still face the camera
  headDown: 16, // downwards gets a little more room: the screen is just under the lens
  eyeTurn: 0.38, // how far the eyes may slide (0 to 1) and still be on the camera
  // The angle the camera sees the face from, in degrees. A laptop on a desk looks up at the face,
  // which reads as the head tipped back. Wide limits: the model's own zero is only good to a few degrees.
  camera: [-28, 12],
  restless: 0.45, // head heights moved per second, smoothed
  dim: 65, // brightness of the face, 0 to 255
  backlit: 55, // how much brighter the background may be than the face
  // Away from the screen, for the record a weekly interview keeps. Wider than the limits for eye contact
  // above: reading the question, watching the answer appear and looking at the keyboard are all on the
  // screen side of these. Only a head or eyes turned well clear of the screen counts.
  // The face model reads a sideways turn as about two thirds of what it is (a head turned 30 degrees reads
  // as 20), so 20 here is a head turned about 30 degrees: past the edge of a screen, towards something beside it.
  offScreenTurn: [20, 28], // degrees the head may turn sideways, and upwards (looking up to think is common)
  offScreenDown: 32, // downwards: the keyboard is below the screen, a lap or a desk drawer is further
  offScreenEyes: 0.62, // how far the eyes may slide sideways
  blurred: 4, // sharpness of the face (see tracker.js) below which the picture is too soft to read
}

// Which way the head points, from the 4x4 matrix MediaPipe gives (column by column).
// The third column is the direction the face looks in, seen from the camera.
// Checked against pictures of a face turned by known amounts (tools: make_turns.py): yaw above zero is
// towards the right of the picture, pitch above zero is up and below zero is down.
function headTurn(matrix) {
  if (!matrix || matrix.length < 16) return { yaw: 0, pitch: 0 }
  const x = matrix[8]
  const y = matrix[9]
  const z = Math.abs(matrix[10])
  return { yaw: deg(Math.atan2(x, z)), pitch: deg(Math.atan2(y, Math.hypot(x, z))) }
}

// Where the eyes point within the head, from the eight "eye look" scores (0 to 1 each).
function eyeTurn(shapes) {
  if (!shapes || !shapes.length) return { gazeX: 0, gazeY: 0 }
  const score = {}
  for (const shape of shapes) {
    if (shape.categoryName.startsWith('eyeLook')) score[shape.categoryName] = shape.score
  }
  const v = (name) => score[name] || 0
  return {
    gazeX: (v('eyeLookOutLeft') - v('eyeLookInLeft') + v('eyeLookInRight') - v('eyeLookOutRight')) / 2,
    gazeY: (v('eyeLookUpLeft') + v('eyeLookUpRight') - v('eyeLookDownLeft') - v('eyeLookDownRight')) / 2,
  }
}

// Which face in the picture is the candidate's: the largest one. Returns its place in the list, or -1.
function nearest(faces, aspect) {
  let best = -1
  let bestSize = 0
  faces.forEach((points, i) => {
    if (!points || points.length < 468) return
    const size = Math.hypot((points[CHIN].x - points[FOREHEAD].x) * aspect, points[CHIN].y - points[FOREHEAD].y)
    if (size > bestSize) {
      best = i
      bestSize = size
    }
  })
  return best
}

// One frame, measured. Null when no face was found.
// `aspect` is the picture's width over its height: landmarks come as shares of each.
// When there is more than one face, the largest is measured and `faces` says how many there were.
export function observe(result, aspect = 4 / 3) {
  const all = result?.faceLandmarks || []
  const which = nearest(all, aspect)
  if (which < 0) return null
  const points = all[which]

  let minX = 1
  let maxX = 0
  let minY = 1
  let maxY = 0
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  const right = points[EYE_OUTER_R]
  const left = points[EYE_OUTER_L]
  const top = points[FOREHEAD]
  const chin = points[CHIN]

  return {
    box: [minX, minY, maxX, maxY],
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    eyeY: (right.y + left.y + points[EYE_INNER_R].y + points[EYE_INNER_L].y) / 4,
    size: Math.hypot((chin.x - top.x) * aspect, chin.y - top.y),
    cut: minX < 0.005 || maxX > 0.995 || minY < 0.005 || maxY > 0.995,
    roll: deg(Math.atan2(left.y - right.y, (left.x - right.x) * aspect)),
    ...headTurn(result.facialTransformationMatrixes?.[which]?.data),
    ...eyeTurn(result.faceBlendshapes?.[which]?.categories),
    faces: all.filter((face) => face && face.length >= 468).length,
  }
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// Where the person sat and looked while they were asked to look at the camera.
// Later frames are compared with this. Null if there were too few frames to trust.
export function baseline(observations) {
  const seen = observations.filter(Boolean)
  if (seen.length < 4) return null
  const of = (key) => median(seen.map((o) => o[key]))
  return { cy: of('cy'), size: of('size'), yaw: of('yaw'), pitch: of('pitch'), gazeX: of('gazeX'), gazeY: of('gazeY') }
}

// What is right and wrong in one frame. `base` may be null before the person has been asked to look at the camera.
export function judge(obs, base) {
  if (!obs) return { present: false }
  const from = base || { cy: obs.cy, size: obs.size, yaw: 0, pitch: 0, gazeX: 0, gazeY: 0 }

  const offCentre = Math.abs(obs.cx - 0.5) > RULES.centre
  const eyesLow = obs.eyeY > RULES.eyeLine[1]
  const eyesHigh = obs.eyeY < RULES.eyeLine[0]
  const close = obs.size > RULES.size[1]
  const far = obs.size < RULES.size[0]
  const tilted = Math.abs(obs.roll) > RULES.tilt
  const sunk = (obs.cy - from.cy) / from.size > RULES.sink
  const leaning = !close && obs.size / from.size > RULES.leanIn
  // where the head and the eyes have gone since they were on the camera
  const turned = obs.yaw - from.yaw
  const tipped = obs.pitch - from.pitch
  const slid = obs.gazeX - from.gazeX
  const lifted = obs.gazeY - from.gazeY
  const side = Math.abs(turned) > RULES.headTurn[0] || Math.abs(slid) > RULES.eyeTurn
  const down = tipped < -RULES.headDown || lifted < -RULES.eyeTurn
  const up = tipped > RULES.headTurn[1] || lifted > RULES.eyeTurn
  const facing = !side && !down && !up
  // turned well clear of the screen (for the weekly interview's record): judged the same way whether or
  // not the person is typing, which is why the limits are wide
  const offScreen =
    Math.abs(turned) > RULES.offScreenTurn[0] || Math.abs(slid) > RULES.offScreenEyes
      ? 'side'
      : tipped > RULES.offScreenTurn[1]
        ? 'up'
        : tipped < -RULES.offScreenDown
          ? 'down'
          : null

  return {
    present: true,
    away: facing ? null : side ? 'side' : down ? 'down' : 'up', // which way the eyes went
    offScreen, // null, or which way: 'side', 'up' or 'down'
    others: (obs.faces || 1) > 1, // a second face is in the picture
    // how far the head sits below where it started, in head heights (for sinking slowly over an interview)
    drop: base ? (obs.cy - base.cy) / base.size : null,
    // seen from below or from above: only judged while the person is more or less facing the camera
    cameraLow: Math.abs(obs.yaw) < 15 && obs.pitch > RULES.camera[1],
    cameraHigh: Math.abs(obs.yaw) < 15 && obs.pitch < RULES.camera[0],
    cut: obs.cut,
    offCentre,
    eyesLow,
    eyesHigh,
    close,
    far,
    tilted,
    sunk,
    leaning,
    facing,
    framed: !obs.cut && !offCentre && !eyesLow && !eyesHigh,
    distanceOk: !close && !far,
    upright: !tilted && !sunk && !leaning,
  }
}

// True when the face is too soft to read: a smeared lens, a cover over the camera, a camera out of focus.
// `light.sharp` is how much fine detail the face holds (tracker.js); it is missing where it could not be measured.
export function judgeBlur(light) {
  return light?.sharp != null && light.sharp < RULES.blurred
}

// How the face is lit, from the average brightness of the face and of everything around it (0 to 255).
export function judgeLight(light) {
  if (!light) return 'good'
  if (light.around - light.face > RULES.backlit && light.face < 120) return 'backlit'
  if (light.face < RULES.dim) return 'dim'
  return 'good'
}

// How fast the head is moving, smoothed over about a second, in head heights per second.
export function createMotion() {
  let last = null
  let speed = 0
  return (obs, seconds, aspect = 4 / 3) => {
    if (!obs || !last || seconds <= 0) {
      last = obs
      return speed > RULES.restless
    }
    const moved = Math.hypot((obs.cx - last.cx) * aspect, obs.cy - last.cy) / obs.size
    const weight = Math.min(1, seconds / 1.2)
    speed += (moved / seconds - speed) * weight
    last = obs
    return speed > RULES.restless
  }
}
