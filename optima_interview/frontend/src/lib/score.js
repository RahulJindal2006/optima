// The match score, exactly as the backend asks Claude to build it
// (backend/claude_client.py, score_candidate_job_match).
export const PARTS = [
  {
    key: 'interview_performance_score',
    label: 'Interview performance',
    weight: 0.4,
    note: 'How well the questions were answered. Role-specific questions count most.',
  },
  {
    key: 'answer_relevance_score',
    label: 'Answer relevance',
    weight: 0.35,
    note: 'How closely the answers fit what this job involves.',
  },
  {
    key: 'profile_skills_score',
    label: 'Profile skills',
    weight: 0.1,
    note: 'Skills listed on the profile against the skills the job asks for.',
  },
  {
    key: 'ats_score',
    label: 'Resume',
    weight: 0.15,
    note: 'The resume against the job description and its skills.',
  },
]

// An application is created when a weekly interview scores this or more for a job.
export const SEND_AT = 40

export const composite = (values) => PARTS.reduce((sum, part, i) => sum + part.weight * (values[i] || 0), 0)

export const percent = (weight) => `${Math.round(weight * 100)}%`

// Scores arrive as floats (86.9). Show whole numbers.
export const whole = (n) => (n == null || Number.isNaN(Number(n)) ? null : Math.round(Number(n)))
