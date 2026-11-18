import { Link } from 'react-router-dom'
import PublicNav from '../components/PublicNav'
import Logo from '../components/Logo'
import CoachDemo from '../components/landing/CoachDemo'
import HeroSheet from '../components/landing/HeroSheet'
import LeaveDemo from '../components/landing/LeaveDemo'
import Scene, { PlayedOnce } from '../components/landing/Scene'
import ScoreLab from '../components/landing/ScoreLab'
import { PanelFeedback, PanelQuestions } from '../components/landing/Panels'
import '../styles/landing.css'

const LINKS = [
  { href: '#how', label: 'How it works' },
  { href: '#score', label: 'The score' },
  { href: '#fair', label: 'Fair play' },
  { href: '#practice', label: 'Practice' },
  { href: '#companies', label: 'For companies' },
]

export default function Landing() {
  return (
    <div className="landing">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <PublicNav links={LINKS} />

      <main id="main">
        <section className="hero">
          <div className="wrap">
            <h1 className="display">
              One interview.
              <br />
              Every role that fits.
            </h1>
            <p className="lead">
              Answer sixteen questions once a week. Optima scores your answers against every open role in your field and
              applies for you wherever you score 40 or more.
            </p>
            <div className="hero-actions">
              <Link to="/register?role=candidate" className="btn primary lg">
                I’m looking for work
              </Link>
              <Link to="/register?role=company" className="btn secondary lg">
                I’m hiring
              </Link>
            </div>
            <HeroSheet />
          </div>
        </section>

        <Scene />

        <section id="score" className="band">
          <div className="wrap">
            <ScoreLab />
          </div>
        </section>

        <section id="fair" className="band">
          <div className="wrap split flip">
            <div className="split-copy">
              <h2>One window. One try.</h2>
              <p className="lead">
                The weekly interview runs in full screen with your camera on, one question at a time, on a clock the
                server keeps. Leaving the window is recorded, and the third time ends it. Time off camera or turned
                away from the screen costs points. Pasting is off. Companies see the record with every application.
              </p>
            </div>
            <figure className="stage">
              <figcaption className="sr-only">
                A live example of the record kept during a weekly interview. It counts the times you leave this page.
              </figcaption>
              <div>
                <LeaveDemo />
              </div>
              <p className="stage-note">Try it: switch tabs and come back.</p>
            </figure>
          </div>
        </section>

        <section id="practice" className="band">
          <div className="wrap split">
            <div className="split-copy">
              <h2>Practise first.</h2>
              <p className="lead">
                Run a mock interview for any role: six questions, plus two coding questions for technical roles. Each
                answer comes back scored line by line, with what you covered and what you missed. Up to three a day.
              </p>
              <Link to="/register?role=candidate" className="btn primary lg">
                Create a candidate account
              </Link>
            </div>
            <PlayedOnce alt="Feedback on one practice answer: a score of 74, three points covered and two missed." still>
              <PanelFeedback />
            </PlayedOnce>
          </div>
        </section>

        <section className="band" aria-labelledby="coach-title">
          <div className="wrap split flip">
            <div className="split-copy">
              <h2 id="coach-title">A coach in your camera.</h2>
              <p className="lead">
                On in every weekly interview, optional in practice. It watches your eye contact and posture, listens
                to your pace and your filler words, and says what to fix while you answer. It runs on your device: no
                video or sound is saved or sent.
              </p>
            </div>
            <figure className="stage">
              <figcaption className="sr-only">
                An example of the camera coach. Choosing a way of sitting shows the tip the coach gives.
              </figcaption>
              <div>
                <CoachDemo />
              </div>
              <p className="stage-note">Example. The real picture is your camera.</p>
            </figure>
          </div>
        </section>

        <section id="companies" className="band">
          <div className="wrap split">
            <div className="split-copy">
              <h2>Post a role. Read a shortlist.</h2>
              <p className="lead">
                Add up to five questions of your own. They take priority in the weekly interview of every candidate who
                saved your role. Applicants arrive ranked, each with a score, its four parts, the reasoning, and how
                the interview was taken.
              </p>
              <Link to="/register?role=company" className="btn primary lg">
                Create a company account
              </Link>
            </div>
            <PlayedOnce alt="A company’s own questions for a role: three written, room for two more." still>
              <PanelQuestions />
            </PlayedOnce>
          </div>
        </section>

        <section className="doors" aria-label="Create an account">
          <div className="wrap doors-in">
            <div className="door">
              <h2>Looking for work</h2>
              <p>Save the roles you want, practise, and take your first weekly interview.</p>
              <Link to="/register?role=candidate" className="btn on-dark lg">
                Create a candidate account
              </Link>
            </div>
            <div className="door">
              <h2>Hiring</h2>
              <p>Post a role, add your own questions, and read your first shortlist.</p>
              <Link to="/register?role=company" className="btn on-dark lg">
                Create a company account
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="foot">
        <div className="wrap foot-in">
          <Logo size={22} />
          <p>Built by Rahul Jindal and Ryan Vandersar. Interviews are scored by Claude, an AI model made by Anthropic.</p>
          <nav className="foot-links" aria-label="Account">
            <Link to="/login">Log in</Link>
            <Link to="/register">Create account</Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
