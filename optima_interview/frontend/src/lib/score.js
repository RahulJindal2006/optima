// The match score, exactly as the backend builds it (backend/rubric.py: WEIGHTS and composite).
export const PARTS = [
  {
    key: 'interview_performance_score',
    label: 'Interview performance',
    weight: 0.4,
    note: 'The interview’s own score: every question counted by the time it was given, a skipped one as 0. The same for every role.',
  },
  {
    key: 'answer_relevance_score',
    label: 'Answer relevance',
    weight: 0.35,
    note: 'How far the answers show the work this job describes, and how many of the skills it asks for they show.',
  },
  {
    key: 'profile_skills_score',
    label: 'Profile skills',
    weight: 0.1,
    note: 'The share of the skills the job asks for that are on the profile’s list.',
  },
  {
    key: 'ats_score',
    label: 'Resume',
    weight: 0.15,
    note: 'How far the resume shows the work this job describes, and the skills it asks for.',
  },
]

// What a score for one answer means. An answer rated "solid" on every line lands at about this.
export const SOLID_AT = 75

// The five levels a line of the scorecard can reach (backend/rubric.py), lowest first.
export const LEVELS = ['none', 'weak', 'partial', 'solid', 'strong']
export const LEVEL_NAME = { none: 'None', weak: 'Weak', partial: 'Partial', solid: 'Solid', strong: 'Strong' }

// An application is created when a weekly interview scores this or more for a job.
export const SEND_AT = 40

export const composite = (values) => PARTS.reduce((sum, part, i) => sum + part.weight * (values[i] || 0), 0)

export const percent = (weight) => `${Math.round(weight * 100)}%`

// Scores arrive as floats (86.9). Show whole numbers.
export const whole = (n) => (n == null || Number.isNaN(Number(n)) ? null : Math.round(Number(n)))
