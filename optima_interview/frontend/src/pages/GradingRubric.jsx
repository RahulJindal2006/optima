import { useEffect, useState } from 'react'
import { getRubric } from '../api/client'
import AppShell, { PageHead } from '../components/AppShell'
import { Loading, Notice } from '../components/Bits'
import { Level } from '../components/Scorecard'
import ScoreLab from '../components/landing/ScoreLab'
import { useAuth } from '../context/AuthContext'
import { LIMITS } from '../lib/flags'
import { minutesOf } from '../lib/format'
import { PARTS, SEND_AT, percent } from '../lib/score'
import '../styles/pages.css'

// The scorecard, its weights and the rules that follow from it are read from the server (GET /scoring/rubric),
// which is the code that applies them. What is written out below is the part that code does not hold.

const share = (value) => `${Math.round(value * 100)}%`
const times = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : n === 3 ? 'three times' : `${n} times`)

// Enforced by the server (backend/interview_rules.py) and the interview page.
const FAIR_PLAY = [
  ['One question at a time', 'Each question appears only when the one before it is answered, with its own clock kept on the server. You cannot see what is coming, and you cannot go back.'],
  ['On camera', 'The camera and microphone are checked before the first question, and the interview cannot begin without them. Time off camera, time turned away from the screen and a second person in view are recorded and cost points.'],
  ['Full screen', `The interview runs in full screen. Leaving it, switching tabs or switching windows is recorded. You may do so ${LIMITS.leavesAllowed} times; the next time ends the interview.`],
  ['No pasting', 'Pasting into an answer is turned off, and each attempt is recorded.'],
  ['Closing the page', 'An interview that is closed or left before the last question scores 0 and sends nothing. The week is still used.'],
  ['Writing to the grader', 'An answer that tries to give the grader instructions scores 0.'],
  ['What companies see', 'With each application, a company sees whether the interview was clean, or what was recorded.'],
]

const COACH = [
  ['What it watches', 'Whether your eyes are on the camera, whether you are sitting upright and level, where you are in the picture, the light on your face, and whether the picture is sharp.'],
  ['What it listens for', 'When you dictate an answer: how fast you speak, how much your pitch moves, how well the microphone hears you, long silences, and filler words.'],
  ['When', 'In every weekly interview, where it is a condition of taking it. In practice interviews, only if you turn it on.'],
  ['What is kept', 'Your camera and microphone are read on your own device. No video, picture or sound is saved or sent. From a weekly interview three numbers are kept for the record: time on camera, time turned away from the screen, and time with a second face in view.'],
  ['Typing', 'Looking at the screen or the keyboard while you type is not turning away. Eye contact with the lens is only judged while you speak, and it is advice, not part of the score.'],
  ['Dictation', 'Turning speech into text is done by your browser, not by Optima. Chrome and Edge send the sound to their makers’ servers to do it.'],
]

const ADVICE = {
  candidate: {
    title: 'What raises a score',
    items: [
      ['Answer the question that was asked.', 'An answer that is on the subject but does not answer is a bad answer, however well it is put.'],
      ['Give one specific example.', 'What the situation was, what you did, and what came of it.'],
      ['Put a number on it.', 'How many, how much, how long, or by how much. The top level for evidence is only given when the answer has one.'],
      ['Answer every question.', 'A skipped one scores 0, and below three quarters answered nothing is sent.'],
      ['Fill in your profile.', 'Skills and a resume are a quarter of every match score, and zero when missing.'],
    ],
  },
  company: {
    title: 'What makes the ranking better',
    items: [
      ['Write a specific description.', 'Every interview is set against the text of your role.'],
      ['List the skills you need.', 'Each one is looked for in the answers, on the profile and in the resume.'],
      ['Add your own questions.', `Up to ${LIMITS.ownQuestions}. They take priority in the weekly interview of candidates who saved the role.`],
    ],
  },
}

// One scorecard: its lines, what each is worth, and the five levels each can reach.
function Card({ lines }) {
  return (
    <ul className="rows weights">
      {lines.map((line) => (
        <li key={line.key}>
          <b>{share(line.weight)}</b>
          <strong>{line.label}</strong>
          <p>{line.asks}</p>
          <details className="reveal levels">
            <summary>{line.levels ? 'The five levels' : 'How each point is marked'}</summary>
            <dl className="bands">
              {(line.levels || line.marks).map((step) => (
                <div key={step.name}>
                  <dt>{line.levels ? <Level level={step.name} /> : step.name === 'covered' ? 'Covered' : step.name === 'partly' ? 'In part' : 'Missing'}</dt>
                  <dd>
                    {step.meaning} <span className="muted">{line.levels ? `${step.points}% of the line.` : `${step.value * 100}% of the point.`}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        </li>
      ))}
    </ul>
  )
}

export default function GradingRubric() {
  const { user } = useAuth()
  const advice = ADVICE[user.role === 'company' ? 'company' : 'candidate']
  const [rules, setRules] = useState(null)
  const [problem, setProblem] = useState('')

  useEffect(() => {
    let live = true
    getRubric()
      .then((got) => live && setRules(got))
      .catch((err) => live && setProblem(err.message))
    return () => {
      live = false
    }
  }, [])

  const seconds = rules?.seconds || LIMITS.seconds
  const camera = rules?.presence

  return (
    <AppShell>
      <PageHead title="How scoring works">
        Two scores, both out of 100. One for each answer, and one for how well a whole interview fits a role.
      </PageHead>

      {rules?.bands && (
        <section className="guide">
          <div className="guide-head">
            <h2>What a score means</h2>
            <p>The scale is held to four bands, and a built-in check grades answers of each kind to see that they land in them.</p>
          </div>
          <div className="guide-body">
            <dl className="bands">
              {rules.bands.map((band) => (
                <div key={band.name}>
                  <dt>
                    {band.low} to {band.high}
                  </dt>
                  <dd>
                    <strong>{band.name}.</strong> {band.meaning}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      )}

      <section className="guide">
        <div className="guide-head">
          <h2>A scorecard for every answer</h2>
          <p>
            Each answer is rated the way a structured interview is scored: one line at a time, against written levels.
            Claude picks the level. It never gives a number. The sums are done by Optima’s own code.
          </p>
        </div>
        <div className="guide-body">
          {problem && <Notice tone="stop">The scorecard could not load. {problem}</Notice>}
          {!rules && !problem && <Loading>Loading the scorecard</Loading>}
          {rules && (
            <>
              <h3>Spoken and written answers</h3>
              <Card lines={rules.verbal} />
              <h3>Coding questions</h3>
              <Card lines={rules.code} />
              <h3>The rules that go with it</h3>
              <dl className="bands">
                <div>
                  <dt>Not an answer</dt>
                  <dd>
                    Blank, under {rules.min_words} words, a list of terms, or about something other than what was asked: 0,
                    however well it is put.
                  </dd>
                </div>
                <div>
                  <dt>On the subject only</dt>
                  <dd>
                    An answer that stays on the subject without answering the question scores between{' '}
                    {rules.floor_on_subject ?? 20} and {rules.cap_when_weak}, however badly or well it is put.
                  </dd>
                </div>
                <div>
                  <dt>The top level for evidence</dt>
                  <dd>
                    Needs a figure for what you did or what came of it. The grader has to copy it from your answer, and
                    Optima checks that the words are there. Without one, evidence stops at Solid.
                  </dd>
                </div>
                <div>
                  <dt>Length</dt>
                  <dd>Not scored. A longer answer is not a better one.</dd>
                </div>
                <div>
                  <dt>Spelling</dt>
                  <dd>Not scored, and nor are punctuation and capital letters. A dictated answer is read for what it says.</dd>
                </div>
              </dl>
            </>
          )}
        </div>
      </section>

      <section className="guide">
        <div className="guide-head">
          <h2>The same answer, the same grade</h2>
          <p>Two people who give the same answer to the same question get the same score, for as long as the scorecard stays as it is.</p>
        </div>
        <div className="guide-body">
          <dl className="bands">
            <div>
              <dt>Stored</dt>
              <dd>
                Every grade is kept under a fingerprint of the question and the answer. An answer that has been graded
                before is not graded again: it gets the stored grade.
              </dd>
            </div>
            <div>
              <dt>Rated {times(rules?.samples || 3)}</dt>
              <dd>
                A new answer is rated {times(rules?.samples || 3)}, and the middle rating on each line is the one kept.
                How your answers fit each role is rated the same way.
              </dd>
            </div>
            <div>
              <dt>What counts as the same</dt>
              <dd>
                The same words. Capital letters, spacing and the punctuation around words make no difference to a
                spoken or written answer. In code they do.
              </dd>
            </div>
            <div>
              <dt>Checked</dt>
              <dd>
                A built-in check grades answers of known quality 100 times over and reports whether any score moves.
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="guide">
        <div className="guide-head">
          <h2>The score for the interview</h2>
          <p>Every question counts, by the time it is given. A question you skip counts as 0.</p>
        </div>
        <div className="guide-body">
          <dl className="bands">
            <div>
              <dt>General questions</dt>
              <dd>{minutesOf(seconds.general)} minutes each. Everyone is asked the same ones in the same week.</dd>
            </div>
            <div>
              <dt>About the role</dt>
              <dd>{minutesOf(seconds.role)} minutes each. Written from the roles you saved.</dd>
            </div>
            <div>
              <dt>Long questions</dt>
              <dd>
                {minutesOf(seconds.long)} minutes for a case question, {minutesOf(seconds.code)} for a coding question. They count
                for the most.
              </dd>
            </div>
            <div>
              <dt>Unanswered</dt>
              <dd>
                Answer fewer than three quarters of the questions and nothing is sent to any company, whatever the score.
              </dd>
            </div>
            {camera && (
              <div>
                <dt>The camera</dt>
                <dd>
                  Weekly interviews only. Off camera for more than {share(camera.off_camera.free)} of the time costs up to{' '}
                  {camera.off_camera.points} points, all of them at {share(camera.off_camera.full)}. Turned away from the
                  screen for more than {share(camera.looking_away.free)} costs up to {camera.looking_away.points}, all of
                  them at {share(camera.looking_away.full)}. A second person in view for {camera.second_person.seconds}{' '}
                  seconds or more costs {camera.second_person.points}.
                </dd>
              </div>
            )}
          </dl>
        </div>
      </section>

      <section className="guide">
        <div className="guide-head">
          <h2>A match score for every role</h2>
          <p>
            After a weekly interview, it is set against each open role in the same field as the roles the candidate
            saved.
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
              <dt>65 and 80</dt>
              <dd>Companies see a count of applicants at 65 or more, and at 80 or more.</dd>
            </div>
            <div>
              <dt>Scored again</dt>
              <dd>If a later weekly interview scores higher for the same role, the higher score replaces the old one.</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="guide lab-guide">
        <ScoreLab Heading="h2" title="Try the sum" lead="Move the four parts and see where the match score lands." />
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
            These checks make cheating harder and leave a record. A camera can be wrong about where someone is looking,
            which is why it costs a few points and never ends an interview.
          </p>
        </div>
      </section>

      <section className="guide">
        <div className="guide-head">
          <h2>The coach</h2>
          <p>Tips on how you look and sound while you answer.</p>
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
            <div>
              <dt>Weekly interview</dt>
              <dd>
                {LIMITS.weeklyQuestions} questions: {LIMITS.weeklyGeneral} general, {LIMITS.weeklyRole} about the roles you
                saved, {LIMITS.weeklyLong} long. Up to {LIMITS.weeklyMinutes} minutes. One every {LIMITS.weeklyEveryDays} days.
              </dd>
            </div>
            <div>
              <dt>Practice interview</dt>
              <dd>
                {LIMITS.practiceQuestions} questions, plus {LIMITS.practiceCodeQuestions} coding questions for technical
                roles. {LIMITS.practicePerDay} a day.
              </dd>
            </div>
            <div>
              <dt>Saved roles</dt>
              <dd>Up to {LIMITS.savedRoles}. The weekly interview is built from them.</dd>
            </div>
            <div>
              <dt>A company’s own questions</dt>
              <dd>Up to {LIMITS.ownQuestions} per role.</dd>
            </div>
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
          <p className="hint">
            Levels are picked by Claude, an AI model made by Anthropic. Every number is worked out from them by Optima’s
            own code.
          </p>
        </div>
      </section>
    </AppShell>
  )
}
