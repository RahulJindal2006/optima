// Interviews were switched off on the live site on 1 May 2026: every start button showed
// "Interviews are currently disabled". That stays the default. They come back when the site
// is built with VITE_INTERVIEWS_ENABLED=true (set in .env.development for local work).
export const INTERVIEWS_ENABLED = import.meta.env.VITE_INTERVIEWS_ENABLED === 'true'

// Limits the backend enforces. Shown in the interface; changing them here changes nothing on the server.
export const LIMITS = {
  weeklyQuestions: 8,
  weeklyEveryDays: 7,
  practicePerDay: 3,
  practiceQuestions: 6,
  practiceCodeQuestions: 2,
  savedRoles: 10,
  ownQuestions: 5,
  desiredRoles: 5,
  verbalSeconds: 5 * 60,
  codeSeconds: 10 * 60,
  leavesAllowed: 2, // times a candidate may leave the weekly interview's window; the next one ends it
  beginWithinMinutes: 15,
}
