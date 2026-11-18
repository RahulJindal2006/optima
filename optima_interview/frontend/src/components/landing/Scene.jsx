import { useEffect, useRef, useState } from 'react'
import useMedia from '../../lib/useMedia'
import { paint, play } from '../../lib/paint'
import { PanelInterview, PanelScore, PanelSent, PanelShortlist } from './Panels'

const STEPS = [
  {
    title: 'Answer once',
    body: 'Save the roles you want. Once a week you get sixteen questions, most of them two to three minutes: six that everyone is asked, ten built from your roles. Type your answers or speak them.',
    Panel: PanelInterview,
    alt: 'The interview screen: question 9 of 16, a timer, and a typed answer.',
  },
  {
    title: 'Scored on four things',
    body: 'Each answer is graded line by line on a fixed scorecard, so the same answer to the same question always gets the same grade. Then every open role in your field gets a match score from four parts.',
    Panel: PanelScore,
    alt: 'A match score of 87 for one role, broken into its four weighted parts.',
  },
  {
    title: 'Sent where you fit',
    body: 'Score 40 or more for a role and your application goes to that company. Below 40, nothing is sent.',
    Panel: PanelSent,
    alt: 'Four roles on a score line. Three are past the line at 40 and marked sent, one is not.',
  },
  {
    title: 'Companies start with who fits',
    body: 'Each role gets a ranked list. Every applicant arrives with a score, the four parts behind it and the reasoning.',
    Panel: PanelShortlist,
    alt: 'A company’s list of four applicants for one role, ranked by score, with the reasoning for the first.',
  },
]

const clamp = (n) => Math.min(1, Math.max(0, n))
const HOLD = 0.72 // share of each step spent moving; the rest holds still

// Wide screens: the stage stays put while the page scrolls through the four steps.
function Pinned() {
  const scene = useRef(null)
  const panels = useRef([])
  const [step, setStep] = useState(0)

  useEffect(() => {
    const el = scene.current
    let frame = 0
    let shown = -1

    const measure = () => {
      const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bar')) || 0
      const rect = el.getBoundingClientRect()
      const travel = rect.height - (window.innerHeight - bar)
      return { travel, done: travel > 0 ? clamp((bar - rect.top) / travel) : 0 }
    }

    const update = () => {
      frame = 0
      const { done } = measure()
      const pos = done * STEPS.length
      const now = Math.min(STEPS.length - 1, Math.floor(pos))
      if (now !== shown) {
        shown = now
        setStep(now)
      }
      panels.current.forEach((node, i) => {
        // the first view starts part-way so the stage is never empty on arrival
        const q = i === 0 ? clamp((pos + 0.3) / (HOLD + 0.3)) : clamp((pos - i) / HOLD)
        paint(node, q)
      })
    }

    const request = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }

    update()
    window.addEventListener('scroll', request, { passive: true })
    window.addEventListener('resize', request)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', request)
      window.removeEventListener('resize', request)
    }
  }, [])

  const jump = (i) => {
    const el = scene.current
    const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bar')) || 0
    const top = window.scrollY + el.getBoundingClientRect().top - bar
    const travel = el.offsetHeight - (window.innerHeight - bar)
    window.scrollTo({ top: top + ((i + 0.86) / STEPS.length) * travel, behavior: 'smooth' })
  }

  return (
    <div className="scene" ref={scene} style={{ '--steps': STEPS.length }}>
      <div className="scene-pin">
        <div className="wrap scene-grid">
          <div className="scene-copy">
            <h2>From one interview to a shortlist.</h2>
            <ol className="scene-steps">
              {STEPS.map((s, i) => (
                <li key={s.title} className={i === step ? 'on' : ''}>
                  <button type="button" onClick={() => jump(i)} aria-current={i === step ? 'step' : undefined}>
                    <span className="scene-n">{i + 1}</span>
                    <span className="scene-t">{s.title}</span>
                  </button>
                  <div className="scene-body">
                    <div>
                      <p>{s.body}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="stage scene-stage">
            {STEPS.map(({ Panel, alt, title }, i) => (
              <figure
                key={title}
                className={`scene-panel ${i === step ? 'on' : ''}`}
                ref={(node) => {
                  panels.current[i] = node
                }}
                aria-hidden={i !== step}
              >
                <figcaption className="sr-only">{alt}</figcaption>
                <div aria-hidden="true">
                  <Panel />
                </div>
              </figure>
            ))}
            <p className="stage-note">Example data</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// One view that plays once when it scrolls into sight.
// It only starts from zero if it is still below the screen when the page opens,
// so nothing that is already visible ever blanks out.
function PlayedOnce({ children, alt, still }) {
  const ref = useRef(null)

  useEffect(() => {
    const node = ref.current
    if (still || !('IntersectionObserver' in window)) return undefined
    if (node.getBoundingClientRect().top < window.innerHeight) return undefined
    let cancel = () => {}
    paint(node, 0)
    const seen = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          seen.disconnect()
          cancel = play(node, 1500)
        }
      },
      { threshold: 0.2 },
    )
    seen.observe(node)
    return () => {
      seen.disconnect()
      cancel()
      paint(node, 1)
    }
  }, [still])

  return (
    <figure className="stage" ref={ref}>
      <figcaption className="sr-only">{alt}</figcaption>
      <div aria-hidden="true">{children}</div>
      <p className="stage-note">Example data</p>
    </figure>
  )
}

// Narrow or short screens, and anyone who asked for less motion: the steps in a column.
function Stacked({ still }) {
  return (
    <div className="wrap steps-stack">
      <h2>From one interview to a shortlist.</h2>
      <ol>
        {STEPS.map(({ Panel, alt, title, body }, i) => (
          <li key={title}>
            <div className="step-copy">
              <span className="scene-n">{i + 1}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </div>
            <PlayedOnce alt={alt} still={still}>
              <Panel />
            </PlayedOnce>
          </li>
        ))}
      </ol>
    </div>
  )
}

export default function Scene() {
  const roomy = useMedia('(min-width: 980px) and (min-height: 640px)')
  const still = useMedia('(prefers-reduced-motion: reduce)')
  return (
    <section id="how" className="how" aria-label="How it works">
      {roomy && !still ? <Pinned /> : <Stacked still={still} />}
    </section>
  )
}

export { PlayedOnce }
