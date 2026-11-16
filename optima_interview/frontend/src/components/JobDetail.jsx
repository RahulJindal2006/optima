import { Facts, Skills } from './Bits'
import { formatPlainDate, formatSalary, formatTerm, jobFacts } from '../lib/format'

// One posting, the way a candidate reads it. `actions` go under the title.
export default function JobDetail({ job, actions, showQuestions = false, headingId }) {
  const details = [
    ['Starts', formatPlainDate(job.start_date)],
    ['Length', formatTerm(job.work_term)],
    ['Pay', formatSalary(job.salary_min, job.salary_max)],
    ['Education', job.education_required],
    ['Experience', job.experience_required],
    ['Certifications', job.certifications_required],
  ].filter(([, value]) => value)

  const questions = (job.specific_questions || []).filter(Boolean)

  return (
    <article className="job">
      <header className="job-head">
        {job.company_name && <p className="job-company">{job.company_name}</p>}
        <h2 id={headingId}>{job.title}</h2>
        <Facts items={[job.industry, ...jobFacts(job)]} />
        {actions && <div className="cluster job-actions">{actions}</div>}
      </header>

      {job.description && (
        <section>
          <h3>About the role</h3>
          <p className="prose">{job.description}</p>
        </section>
      )}

      {job.responsibilities && (
        <section>
          <h3>What you would do</h3>
          <p className="prose">{job.responsibilities}</p>
        </section>
      )}

      {job.required_skills?.length > 0 && (
        <section>
          <h3>Skills</h3>
          <Skills items={job.required_skills} />
        </section>
      )}

      {details.length > 0 && (
        <section>
          <h3>Details</h3>
          <dl className="pairs">
            {details.map(([label, value]) => (
              <div key={label} style={{ display: 'contents' }}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {showQuestions && (
        <section>
          <h3>Your questions</h3>
          {questions.length ? (
            <ol className="numbered">
              {questions.map((q, i) => (
                <li key={`${q}-${i}`}>{q}</li>
              ))}
            </ol>
          ) : (
            <p className="muted">None. The weekly interview uses its own questions for this role.</p>
          )}
        </section>
      )}

      {!job.description && !job.responsibilities && !job.required_skills?.length && details.length === 0 && (
        <p className="muted">This posting has no description yet.</p>
      )}
    </article>
  )
}
