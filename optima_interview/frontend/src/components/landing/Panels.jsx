import Icon from '../Icon'
import QuestionFrame from '../QuestionFrame'
import ScoreLine from '../ScoreLine'
import ScoreParts from '../ScoreParts'
import { LIMITS } from '../../lib/flags'
import { PARTS, SEND_AT } from '../../lib/score'
import { ANSWER, APPLICANTS, COMPANY_QUESTIONS, FEEDBACK, QUESTION, REASONING, ROLES } from './sample'

const TIMER = { __html: [...'01:42'].map((c) => (/\d/.test(c) ? `<span class="d">${c}</span>` : `<span>${c}</span>`)).join('') }
const WORDS = ANSWER.trim().split(/\s+/).length
const TOP = ROLES[0]
const SUM = PARTS.map((p, i) => `${p.weight.toFixed(2)} × ${TOP.parts[i]}`).join(' + ')
const TOTAL = PARTS.reduce((s, p, i) => s + p.weight * TOP.parts[i], 0).toFixed(1)

// Step 1: one question of the weekly interview.
export function PanelInterview() {
  return (
    <div className="panel-ui">
      <QuestionFrame
        as="p"
        index={9}
        total={LIMITS.weeklyQuestions}
        question={QUESTION}
        timer={<span className="digits" data-paint="timer" data-from={LIMITS.seconds.role} data-to={LIMITS.seconds.role - 48} dangerouslySetInnerHTML={TIMER} />}
        foot={
          <>
            <span>
              <span data-paint="words" data-text={ANSWER}>
                {WORDS}
              </span>{' '}
              words
            </span>
            <span className="btn primary sm">Next question</span>
          </>
        }
      >
        <div className="demo-answer">
          <span data-paint="type" data-text={ANSWER}>
            {ANSWER}
          </span>
          <i className="demo-caret" />
        </div>
      </QuestionFrame>
    </div>
  )
}

// Step 2: the four parts of one match score.
export function PanelScore() {
  return (
    <div className="panel-ui">
      <div className="match-head">
        <span className="who">
          <strong>{TOP.role}</strong>
          <span>{TOP.company}</span>
        </span>
        <span className="match-total" data-paint="count" data-to={TOP.score} data-d="0.24">
          {TOP.score}
        </span>
      </div>
      <ScoreParts values={TOP.parts} painted />
      <p className="match-sum fade on" data-paint="show" data-at="0.92">
        {SUM} = <b>{TOTAL}</b>, shown as {TOP.score}
      </p>
    </div>
  )
}

// Step 3: where the interview was sent.
export function PanelSent() {
  return (
    <div className="panel-ui">
      <div className="panel-title">
        <strong>This week’s interview</strong>
        <span>Scored against {ROLES.length} open roles</span>
      </div>
      <div className="sheet plain">
        <ul className="sheet-rows">
          {ROLES.map((r, i) => {
            const sent = r.score >= SEND_AT
            const delay = (i * 0.07).toFixed(2)
            return (
              <li className="sheet-row" key={r.role}>
                <div className="sheet-main">
                  <span className="sheet-who">
                    <strong>{r.role}</strong>
                    <span>{r.company}</span>
                  </span>
                  <span className="sheet-track">
                    <ScoreLine value={r.score} data-paint="line" data-to={r.score} data-d={delay} />
                  </span>
                  <span className="sheet-score" data-paint="count" data-to={r.score} data-d={delay}>
                    {r.score}
                  </span>
                  <span
                    className={`sheet-state fade on ${sent ? 'sent' : ''}`}
                    data-paint="show"
                    data-d={delay}
                    data-at={sent ? (SEND_AT / r.score).toFixed(2) : '0.98'}
                  >
                    {sent ? (
                      <>
                        <Icon name="check" size={16} />
                        Sent
                      </>
                    ) : (
                      'Not sent'
                    )}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

// Step 4: what the company sees for one role.
export function PanelShortlist() {
  return (
    <div className="panel-ui">
      <div className="panel-title">
        <strong>{TOP.role}</strong>
        <span>{APPLICANTS.length} applicants, best match first</span>
      </div>
      <ul className="rows">
        {APPLICANTS.map((a, i) => (
          <li className="people-row fade on" key={a.name} data-paint="show" data-at={(0.08 + i * 0.14).toFixed(2)}>
            <span className="people-rank">{i + 1}</span>
            <span className="avatar">{a.initials}</span>
            <span className="people-name">{a.name}</span>
            <ScoreLine value={a.score} />
            <span className="people-score">{a.score}</span>
            <span className={`tag ${a.status === 'New' ? '' : 'line'}`}>{a.status}</span>
          </li>
        ))}
      </ul>
      <div className="why fade on" data-paint="show" data-at="0.78">
        <span className="label">Why {APPLICANTS[0].name.split(' ')[0]} is first</span>
        <p>{REASONING}</p>
      </div>
    </div>
  )
}

// Practice: feedback on one answer.
export function PanelFeedback() {
  return (
    <div className="panel-ui">
      <div className="match-head">
        <span className="who">
          <span>Question 4 of 6</span>
          <strong className="feedback-q">{FEEDBACK.question}</strong>
        </span>
        <span className="match-total">{FEEDBACK.score}</span>
      </div>
      <p className="feedback-text">{FEEDBACK.text}</p>
      <div className="feedback-cols">
        <div>
          <span className="label">Covered</span>
          <ul className="points">
            {FEEDBACK.hit.map((t) => (
              <li className="hit" key={t}>
                <Icon name="check" size={18} />
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <span className="label">Missed</span>
          <ul className="points">
            {FEEDBACK.missed.map((t) => (
              <li className="missed" key={t}>
                <Icon name="minus" size={18} />
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

// Companies: a role's own questions.
export function PanelQuestions() {
  return (
    <div className="panel-ui">
      <div className="panel-title">
        <strong>Your questions</strong>
        <span>
          {COMPANY_QUESTIONS.length} of 5 used
        </span>
      </div>
      <ol className="rows own-questions">
        {COMPANY_QUESTIONS.map((q, i) => (
          <li key={q}>
            <span className="people-rank">{i + 1}</span>
            <span>{q}</span>
          </li>
        ))}
      </ol>
      <div className="own-add">
        <span className="input">Add a question</span>
        <span className="btn secondary">Add</span>
      </div>
    </div>
  )
}
