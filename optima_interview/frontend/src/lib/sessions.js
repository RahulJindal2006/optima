import { parseTime } from './format'

// The server allows three practice interviews per UTC day and counts every one that was started.
export function practiceUsedToday(sessions = []) {
  const now = new Date()
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return sessions.filter((s) => s.session_type === 'mock' && (parseTime(s.created_at)?.getTime() ?? 0) >= dayStart)
    .length
}

// When that count starts again, in the reader's own time.
export function practiceResetsAt() {
  const now = new Date()
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  return next.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

// Where an interview stands, for a line in a list.
//   scored   finished and scored            ended    a weekly interview that was closed or left: it scored 0
//   scoring  every answer is in             open     being taken in another window right now
//   left     a practice interview left part-way: no score
//   unbegun  the questions were written and Begin was never pressed: nothing was shown and nothing was used
export function sessionState(session) {
  if (session.ended_reason === 'not_begun') return 'unbegun'
  if (session.status === 'completed') return session.ended_reason ? 'ended' : 'scored'
  if (session.status === 'in_progress') return session.awaiting_scoring ? 'scoring' : 'open'
  return 'left'
}
