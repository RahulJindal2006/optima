import Icon from './Icon'

// The frame around one interview question: where you are, how long is left, the question.
// The live interview fills `children` with the answer box; the landing page with sample text.
export default function QuestionFrame({ index, total, kind = 'verbal', timer, question, children, foot, urgent, as: Heading = 'h2' }) {
  return (
    <div className="qf">
      <div className="qf-top">
        <span>
          Question {index} of {total}
          {kind === 'code' && <span className="tag line qf-kind">Code</span>}
        </span>
        <span className={`qf-timer ${urgent ? 'urgent' : ''}`}>
          <Icon name="clock" size={16} />
          {timer}
        </span>
      </div>
      <div className="qf-steps" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <i key={i} className={i < index - 1 ? 'done' : i === index - 1 ? 'now' : ''} />
        ))}
      </div>
      <Heading className="qf-q">{question}</Heading>
      {children}
      {foot && <div className="qf-foot">{foot}</div>}
    </div>
  )
}
