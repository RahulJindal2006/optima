import { useAuth } from '../context/AuthContext'
import AppShell, { PageHead } from '../components/AppShell'
import ScoreLab from '../components/landing/ScoreLab'
import { LIMITS } from '../lib/flags'
import { PARTS, SEND_AT, percent } from '../lib/score'
import '../styles/pages.css'

// Everything on this page is read from the backend's prompts and limits
// (backend/claude_client.py and backend/routers). If those change, change this page with them.

const ANSWER_PARTS = [
  {
    label: 'Key points covered',
    weight: '50%',
    text: 'Each question comes with three to five points a strong answer should make. This is how many of them yours made.',
  },
  {
    label: 'Depth of understanding',
    weight: '30%',
    text: 'Whether the answer shows you understand the topic, beyond naming it.',
  },
  {
    label: 'Answer quality',
    weight: '20%',
    text: 'Mostly length. Between 80 and 250 words is the range the grader is told to prefer. Under 30 words loses points; over 400 loses a few.',
  },
]

const BANDS = [
  { range: '90 to 100', text: 'Covers every key point, with depth and clear communication.' },
  { range: '82 to 90', text: 'Covers most key points with good understanding. The range a solid answer is meant to reach.' },
  { range: '72 to 82', text: 'Covers several key points, but lacks depth or misses important areas.' },
  { range: '55 to 72', text: 'Covers only a few key points, or lacks substance.' },
  { range: 'Below 55', text: 'Very incomplete, or off topic.' },
]

const LIMIT_ROWS = [
  ['Weekly interview', `${LIMITS.weeklyQuestions} questions, five minutes each. One every ${LIMITS.weeklyEveryDays} days.`],
  [
    'Practice interview',
    `${LIMITS.practiceQuestions} questions, plus ${LIMITS.practiceCodeQuestions} coding questions for technical roles (ten minutes each). ${LIMITS.practicePerDay} a day.`,
  ],
  ['Saved roles', `Up to ${LIMITS.savedRoles}. The weekly interview is built from them.`],
  ['A company’s own questions', `Up to ${LIMITS.ownQuestions} per role.`],
]

// Enforced by the server (backend/interview_rules.py) and the interview page.
const FAIR_PLAY = [
  ['One question at a time', 'Each question appears only when the one before it is answered, with its own clock kept on the server. You cannot see what is coming, and you cannot go back.'],
  ['Full screen', `The interview runs in full screen. Leaving it, switching tabs or switching windows is recorded. You may do so ${LIMITS.leavesAllowed} times; the next time ends the interview.`],
  ['No pasting', 'Pasting into an answer is turned off, and each attempt is recorded.'],
  ['Closing the page', 'An interview that is closed or left before the last question scores 0 and sends nothing. The week is still used.'],
  ['Writing to the grader', 'An answer that tries to give the grader instructions scores 0.'],
  ['What companies see', 'With each application, a company sees whether the interview was clean, or what was recorded.'],
]

const COACH = [
  ['What it watches', 'Whether your eyes are on the camera, whether you are sitting upright and level, where you are in the picture, and the light on your face.'],
  ['What it listens for', 'When you dictate an answer: how fast you speak, how much your pitch moves, how well the microphone hears you, long silences, and filler words.'],
  ['When', 'Only in practice interviews, and only if you turn it on.'],
  ['What is kept', 'Your camera and microphone are read on your own device. No video, picture or sound is saved or sent by the coach. The numbers shown in your results are the only thing kept.'],
  ['Eye contact', 'Judged only while you are not typing, and not while a new question is being read. Dictate an answer to get the measure that matters: eye contact while you speak.'],
  ['Dictation', 'Turning speech into text is done by your browser, not by Optima. Chrome and Edge send the sound to their makers’ servers to do it.'],
]

const ADVICE = {
  candidate: {
    title: 'What raises a score',
    items: [
      ['Make the points the question is after.', 'Half of an answer’s score is the key points it covers.'],
      ['Stay between 80 and 250 words.', 'Long enough to show how you think, short enough to stay on the question.'],
      ['Fill in your profile.', 'Skills and a resume are a quarter of every match score, and zero when missing.'],
    ],
  },
  company: {
    title: 'What makes the ranking better',
    items: [
      ['Write a specific description.', 'Every interview is scored against the text of your role.'],
      ['List the skills you need.', 'They are compared with the skills on each candidate’s profile.'],
      ['Add your own questions.', `Up to ${LIMITS.ownQuestions}. They take priority in the weekly interview of candidates who saved the role.`],
    ],
  },
}

export default function GradingRubric() {
  const { user } = useAuth()
  const advice = ADVICE[user.role === 'company' ? 'company' : 'candidate']

  return (
    <AppShell>
      <PageHead title="How scoring works">
        Two scores, both out of 100. One for each answer, and one for how well a whole interview fits a role.
      </PageHead>

      <section className="guide">
        <div className="guide-head">
          <h2>A score for every answer</h2>
          <p>Claude grades each answer on three things. The interview’s overall score is the average.</p>
        </div>
        <div className="guide-body">
          <ul className="rows weights">
            {ANSWER_PARTS.map((part) => (
              <li key={part.label}>
                <b>{part.weight}</b>
                <strong>{part.label}</strong>
                <p>{part.text}</p>
              </li>
            ))}
          </ul>
          <h3>What the grader is told each range means</h3>
          <dl className="bands">
            {BANDS.map((band) => (
              <div key={band.range}>
                <dt>{band.range}</dt>
                <dd>{band.text}</dd>
              </div>
            ))}
          </dl>
          <p className="hint">An answer shorter than 10 characters scores 0 without being graded.</p>
        </div>
      </section>

      <section className="guide">
        <div className="guide-head">
          <h2>A match score for every role</h2>
          <p>
            After a weekly interview, Claude scores the whole interview against each open role in the same field as the
            roles the candidate saved.
          </p>
        </div>
        <div className="guide-body">
          <ul className="rows weights">
            {PARTS.map((part) => (
              <li key={part.key}>
                <b>{percent(part.weight)}</b>
                <strong>{part.label}</strong>
                <p>{part.note}</p>
              </li>
            ))}
          </ul>
          <h3>What happens with the score</h3>
          <dl className="bands">
            <div>
              <dt>{SEND_AT} or more</dt>
              <dd>An application is sent to the company, with the score, its four parts and the reasoning.</dd>
            </div>
            <div>
              <dt>Below {SEND_AT}</dt>
              <dd>Nothing is sent to that company.</dd>
            </div>
            <div>
              <dt>80 or more</dt>
              <dd>The scorer is told to treat this as a strong match. Companies see a count of applicants at 65 and at 80.</dd>
            </div>
            <div>
              <dt>Scored again</dt>
              <dd>If a later weekly interview scores higher for the same role, the higher score replaces the old one.</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="guide lab-guide">
        <ScoreLab
          Heading="h2"
          title="Try the sum"
          lead="Move the four parts and see where the match score lands."
        />
      </section>

      <section className="guide">
        <div className="guide-head">
          <h2>Fair play in the weekly interview</h2>
          <p>
            Companies rely on the weekly interview, so it is taken under rules. Practice runs on the same clock, but
            nothing there is held against you.
          </p>
        </div>
        <div className="guide-body">
          <dl className="bands">
            {FAIR_PLAY.map(([label, text]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
          <p className="hint">
            These checks make cheating harder and leave a record. They cannot see a second device, and they do not
            claim to.
          </p>
        </div>
      </section>

      <section className="guide">
        <div className="guide-head">
          <h2>The coach</h2>
          <p>Tips on how you look and sound while you practise.</p>
        </div>
        <div className="guide-body">
          <dl className="bands">
            {COACH.map(([label, text]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="guide">
        <div className="guide-head">
          <h2>The limits</h2>
        </div>
        <div className="guide-body">
          <dl className="bands">
            {LIMIT_ROWS.map(([label, text]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="guide">
        <div className="guide-head">
          <h2>{advice.title}</h2>
        </div>
        <div className="guide-body">
          <ul className="rows advice">
            {advice.items.map(([lead, text]) => (
              <li key={lead}>
                <strong>{lead}</strong>
                <p>{text}</p>
              </li>
            ))}
          </ul>
          <p className="hint">Both scores are produced by Claude, an AI model made by Anthropic.</p>
        </div>
      </section>
    </AppShell>
  )
}
