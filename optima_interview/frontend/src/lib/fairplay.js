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
  return lines
}
