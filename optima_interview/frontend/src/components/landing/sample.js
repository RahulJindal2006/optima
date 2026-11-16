// Everything shown in the landing page's product views is invented.
// The page says so next to each view.
import { composite } from '../../lib/score'

export const CANDIDATE = 'Maya Okafor'

export const ROLES = [
  { role: 'Frontend Engineer', company: 'Brightwater Labs', parts: [91, 88, 80, 78] },
  { role: 'Software Engineering Intern', company: 'Brightwater Labs', parts: [84, 79, 80, 72] },
  { role: 'Backend Engineer', company: 'Kestrel Freight', parts: [72, 64, 60, 58] },
  { role: 'Firmware Engineer', company: 'Kestrel Freight', parts: [38, 27, 20, 30] },
].map((r) => ({ ...r, score: Math.round(composite(r.parts)) }))

export const QUESTION = 'Walk me through how you would find and fix a slow page in a React app.'

export const ANSWER =
  'I would measure before changing anything. I would open the profiler to see which components re-render and why, then check the network tab for large bundles or slow requests. On my last project a product list re-rendered on every keystroke because the filter state lived too high in the tree, so I moved it down and memoised the rows. Then I would measure again to confirm the fix.'

export const APPLICANTS = [
  { name: 'Maya Okafor', initials: 'MO', score: 87, status: 'New' },
  { name: 'Priya Nair', initials: 'PN', score: 76, status: 'Viewed' },
  { name: 'Daniel Reyes', initials: 'DR', score: 70, status: 'New' },
  { name: 'Tom Lindqvist', initials: 'TL', score: 41, status: 'New' },
]

export const REASONING =
  'Specific, well-structured answers on React performance and testing. Listed skills cover most of what the role asks for, and the resume shows two relevant projects.'

export const FEEDBACK = {
  question: 'Tell me about a time you disagreed with a teammate. What did you do?',
  score: 74,
  text: 'A clear example with a real outcome. You explained your own reasoning well but said little about how you checked the other person’s view before deciding.',
  hit: ['Describes a specific situation', 'Explains their own reasoning', 'States the outcome'],
  missed: ['Shows they listened to the other view', 'Says what they would do differently'],
}

export const COMPANY_QUESTIONS = [
  'How would you find and fix a slow page in a React app?',
  'Tell us about something you built that other people actually used.',
  'What would you want to learn in your first three months here?',
]
