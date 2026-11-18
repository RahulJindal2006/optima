import { plural } from './format'

const times = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`)

const ENDED = {
  strikes: 'The interview ended early: the interview window was left a third time.',
  left: 'The interview ended early: the page was closed or left before the last question.',
  not_begun: 'The questions were written, but the interview was never begun.',
}

// What was recorded while a weekly interview was taken, as sentences.
export function fairPlayLines(record) {
  if (!record) return []
  const lines = []
  if (record.ended_reason && ENDED[record.ended_reason]) lines.push(ENDED[record.ended_reason])
  if (record.left_count > 0) {
    lines.push(
      `Left the interview window ${times(record.left_count)}${record.away_seconds > 0 ? `, for ${plural(record.away_seconds, 'second')} in all` : ''}.`,
    )
  }
  if (record.paste_attempts > 0) {
    lines.push(`Tried to paste ${times(record.paste_attempts)}. Pasting is off, so nothing was pasted.`)
  }
  if (record.late_answers > 0) {
    lines.push(`${plural(record.late_answers, 'answer')} arrived after the time was up and ${record.late_answers === 1 ? 'was' : 'were'} not counted.`)
  }
  if (record.manipulation_answers > 0) {
    lines.push(`${plural(record.manipulation_answers, 'answer')} contained instructions aimed at the grader and scored 0.`)
  }
  if (record.unexplained_answers > 0) {
    lines.push(`${plural(record.unexplained_answers, 'answer')} appeared in the page without being typed or dictated there.`)
  }
  if (record.voice_mismatch_answers > 0) {
    lines.push(`${plural(record.voice_mismatch_answers, 'answer')} came through dictation with almost no voice heard by the microphone.`)
  }
  for (const line of record.camera?.lines || []) {
    const cost = `${pointsOff(line.points)} off the interview score`
    if (line.key === 'off_camera') lines.push(`Off camera for ${share(line.share)} of the interview: ${cost}.`)
    if (line.key === 'looking_away') lines.push(`Turned away from the screen for ${share(line.share)} of the time on camera: ${cost}.`)
    if (line.key === 'second_person') lines.push(`A second person was in the picture for ${plural(line.seconds, 'second')}: ${cost}.`)
  }
  return lines
}

const share = (value) => `${Math.round((value || 0) * 100)}%`
const pointsOff = (value) => `${Number(value) % 1 ? Number(value).toFixed(1) : Number(value)} ${Number(value) === 1 ? 'point' : 'points'}`

// The camera's side of a clean record, as one sentence. Null on interviews from before the camera was required.
export function cameraLine(record) {
  const camera = record?.camera
  if (!camera || camera.off_camera == null) return null
  return `On camera for ${share(1 - camera.off_camera)} of the interview, facing the screen for ${share(1 - (camera.looking_away || 0))} of that.`
}
