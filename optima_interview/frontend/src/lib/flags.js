// Interviews were switched off on the live site on 1 May 2026: every start button showed
// "Interviews are currently disabled". That stays the default. They come back when the site
// is built with VITE_INTERVIEWS_ENABLED=true (set in .env.development for local work).
export const INTERVIEWS_ENABLED = import.meta.env.VITE_INTERVIEWS_ENABLED === 'true'

// Limits the backend enforces (backend/rubric.py, question_bank.py, interview_rules.py).
// Shown in the interface; changing them here changes nothing on the server.
export const LIMITS = {
  weeklyQuestions: 16, // the three below, added up
  weeklyGeneral: 6, // asked of everyone, the same for everyone in the same week
  weeklyRole: 8, // written from the saved roles
  weeklyLong: 2, // coding questions for technical roles, case questions for the rest
  weeklyMinutes: 44, // the most the clocks add up to (42 when the long questions are not coding)
  weeklyEveryDays: 7,
  practicePerDay: 3,
  practiceQuestions: 6, // two general and four about the role
  practiceCodeQuestions: 2,
  savedRoles: 10,
  ownQuestions: 5,
  desiredRoles: 5,
  seconds: { general: 120, role: 150, long: 300, code: 360 }, // the time each kind of question is given
  completeAt: 0.75, // answer fewer than this share of the questions and nothing is sent
  leavesAllowed: 2, // times a candidate may leave the weekly interview's window; the next one ends it
  beginWithinMinutes: 15,
}
