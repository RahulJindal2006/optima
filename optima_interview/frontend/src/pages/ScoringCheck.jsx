import { useRef, useState } from 'react'
import { getScoringCheck, runScoringCheck } from '../api/client'
import AppShell, { PageHead } from '../components/AppShell'
import { Field, Notice } from '../components/Bits'
import '../styles/pages.css'

// For the site's owner. Grades a set of answers of known quality, many times over, on the live grader
// (backend/routers/scoring.py), and shows whether a score ever moves and whether each lands where an answer
// of that quality should. Every run makes real calls to Claude, so nothing starts until it is asked for.

const RUN_CHOICES = [5, 20, 50, 100]
const AT_ONCE = 4 // runs asked for in one request: small enough to finish well inside a server's time limit
// The five the check starts with ticked: one of each quality, across a general, a knowledge, a situation and a coding question.
const FIRST = ['team-strong', 'team-thin', 'testing-sound', 'campaign-sound', 'unique-strong']

// List prices in US dollars per million tokens (input, output), read from Anthropic's pricing page on
// 17 November 2026. Only used to turn the tokens a run really used into a rough cost. Check your own invoice.
const PRICES = {
  'claude-sonnet-4-6': [3, 15],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-opus-5-5': [4, 20],
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const tidy = (n) => (Number(n) % 1 ? Number(n).toFixed(1) : String(Number(n)))
const blankRow = () => ({ scores: [], failed: 0, agree: [] })

function summarise(row, band) {
  if (!row || row.scores.length === 0) return null
  const counts = new Map()
  for (const s of row.scores) counts.set(s, (counts.get(s) || 0) + 1)
  const [most, times] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  const low = Math.min(...row.scores)
  const high = Math.max(...row.scores)
  return {
    done: row.scores.length,
    low,
    high,
    most,
    share: times / row.scores.length,
    steady: counts.size === 1,
    inBand: low >= band[0] && high <= band[1],
    agree: row.agree.length ? row.agree.reduce((a, b) => a + b, 0) / row.agree.length : null,
  }
}

export default function ScoringCheck() {
  const [key, setKey] = useState('')
  const [setup, setSetup] = useState(null)
  const [problem, setProblem] = useState('')
  const [chosen, setChosen] = useState(FIRST)
  const [runs, setRuns] = useState(20)
  const [rows, setRows] = useState({})
  const [used, setUsed] = useState({ calls: 0, input_tokens: 0, cached_tokens: 0, output_tokens: 0 })
  const [state, setState] = useState('idle') // idle | loading | running | done | stopped
  const [waiting, setWaiting] = useState(0) // seconds Claude asked the check to hold off for, while it does
  const stop = useRef(false)

  const load = async (event) => {
    event.preventDefault()
    setProblem('')
    setState('loading')
    try {
      setSetup(await getScoringCheck(key.trim()))
      setState('idle')
    } catch (err) {
      setSetup(null)
      setProblem(err.status === 403 ? 'That key was not accepted. It is the ADMIN_KEY set on the backend.' : err.message)
      setState('idle')
    }
  }

  const cases = setup?.cases || []
  const picked = cases.filter((c) => chosen.includes(c.id))
  const calls = picked.reduce((sum, c) => sum + c.calls * runs, 0)

  const toggle = (id) => setChosen((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]))

  const start = async () => {
    stop.current = false
    setProblem('')
    setRows({})
    setUsed({ calls: 0, input_tokens: 0, cached_tokens: 0, output_tokens: 0 })
    setState('running')
    const totals = {}
    try {
      for (const item of picked) {
        totals[item.id] = blankRow()
        while (totals[item.id].scores.length + totals[item.id].failed < runs && !stop.current) {
          const left = runs - totals[item.id].scores.length - totals[item.id].failed
          const reply = await runScoringCheck(key.trim(), { case: item.id, runs: Math.min(AT_ONCE, left) })
          for (const run of reply.runs) {
            if (!run) totals[item.id].failed += 1
            else {
              totals[item.id].scores.push(run.score)
              if (run.ratings > 0) totals[item.id].agree.push(run.agreement)
            }
          }
          setRows({ ...totals, [item.id]: { ...totals[item.id] } })
          setUsed((was) => Object.fromEntries(Object.keys(was).map((k) => [k, was[k] + (reply.used?.[k] || 0)])))
          // a rate limit says nothing about the grader: wait as long as Claude asked, then carry on with the runs left
          if (reply.wait_seconds > 0 && !stop.current) {
            setWaiting(reply.wait_seconds)
            await pause(reply.wait_seconds * 1000)
            setWaiting(0)
          } else if (reply.runs.length === 0) {
            throw new Error('The server sent back no runs. Try again in a minute.')
          }
        }
        if (stop.current) break
      }
      setState(stop.current ? 'stopped' : 'done')
    } catch (err) {
      setProblem(err.message)
      setState('stopped')
    }
    setWaiting(0)
  }

  const results = picked.map((c) => ({ item: c, sum: summarise(rows[c.id], c.band), failed: rows[c.id]?.failed || 0 }))
  const finished = results.filter((r) => r.sum)
  const steady = finished.filter((r) => r.sum.steady).length
  const inBand = finished.filter((r) => r.sum.inBand).length
  const widest = finished.reduce((gap, r) => Math.max(gap, r.sum.high - r.sum.low), 0)
  const price = PRICES[setup?.model]
  const cost = price ? ((used.input_tokens + used.cached_tokens * 0.1) * price[0] + used.output_tokens * price[1]) / 1e6 : null
  const busy = state === 'running'

  return (
    <AppShell narrow>
      <PageHead title="Scoring check">
        Grades answers of known quality many times over on the live grader, and shows whether a score ever moves.
      </PageHead>

      <form className="stack check-key" onSubmit={load}>
        <Field label="Admin key" htmlFor="check-key" hint="The ADMIN_KEY set on the backend. It is sent with each request and kept nowhere.">
          <input
            id="check-key"
            className="input"
            type="password"
            autoComplete="off"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            disabled={busy}
          />
        </Field>
        <div>
          <button type="submit" className="btn secondary" disabled={!key.trim() || busy || state === 'loading'}>
            {setup ? 'Load again' : 'Load the check'}
          </button>
        </div>
      </form>

      {problem && <Notice tone="stop">{problem}</Notice>}

      {setup && (
        <>
          <section className="section">
            <div className="section-head">
              <h2>What to grade</h2>
              <p>
                {setup.model}, rubric {setup.version}, each answer rated {setup.samples === 1 ? 'once' : `${setup.samples} times`} a run
              </p>
            </div>
            <ul className="check-pick">
              {cases.map((c) => (
                <li key={c.id}>
                  <label className="check">
                    <input type="checkbox" checked={chosen.includes(c.id)} onChange={() => toggle(c.id)} disabled={busy} />
                    <span>
                      {c.label}
                      <small>
                        should land {c.band[0] === c.band[1] ? `at ${c.band[0]}` : `from ${c.band[0]} to ${c.band[1]}`}
                      </small>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="check-go">
              <Field label="Runs for each answer" htmlFor="check-runs">
                <select id="check-runs" className="select" value={runs} onChange={(event) => setRuns(Number(event.target.value))} disabled={busy}>
                  {RUN_CHOICES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </Field>
              {busy ? (
                <button type="button" className="btn secondary" onClick={() => (stop.current = true)}>
                  Stop
                </button>
              ) : (
                <button type="button" className="btn primary" onClick={start} disabled={picked.length === 0}>
                  Run the check
                </button>
              )}
            </div>
            <p className="hint">
              This will make {calls.toLocaleString('en-CA')} calls to Claude, and each one is charged to your Anthropic account.
              Nothing is stored: every run grades from scratch.
            </p>
          </section>

          {(busy || finished.length > 0) && (
            <section className="section">
              <div className="section-head">
                <h2>{busy ? 'Running' : state === 'done' ? 'Result' : 'Stopped part-way'}</h2>
                <p>
                  {used.calls.toLocaleString('en-CA')} calls, {(used.input_tokens + used.cached_tokens).toLocaleString('en-CA')} tokens in,{' '}
                  {used.output_tokens.toLocaleString('en-CA')} out
                  {cost != null && used.calls > 0 && `, about $${cost.toFixed(2)} at list prices`}
                </p>
              </div>

              {waiting > 0 && (
                <p className="hint" role="status">
                  Claude asked for a pause (a rate limit). Carrying on in {waiting} seconds. Nothing is lost.
                </p>
              )}

              {finished.length > 0 && (
                <p className={`check-verdict ${steady === finished.length ? 'ok' : ''}`}>
                  {steady} of {finished.length} answers got the same score on every run.{' '}
                  {widest > 0 ? `The widest gap between two runs of one answer was ${tidy(widest)} points.` : 'No score moved.'}{' '}
                  {inBand} of {finished.length} stayed where an answer of that quality should land.
                </p>
              )}

              <div className="check-table" role="region" aria-label="Results, one row for each answer" tabIndex={0}>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Answer</th>
                      <th scope="col">Runs</th>
                      <th scope="col">Lowest</th>
                      <th scope="col">Highest</th>
                      <th scope="col">Most often</th>
                      <th scope="col">Same every run</th>
                      <th scope="col">Where it should land</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map(({ item, sum, failed }) => (
                      <tr key={item.id}>
                        <th scope="row">{item.label}</th>
                        <td>
                          {sum ? sum.done : 0} of {runs}
                          {failed > 0 && `, ${failed} failed`}
                        </td>
                        <td>{sum ? tidy(sum.low) : ''}</td>
                        <td>{sum ? tidy(sum.high) : ''}</td>
                        <td>{sum ? `${tidy(sum.most)} (${Math.round(sum.share * 100)}%)` : ''}</td>
                        <td className={sum ? (sum.steady ? 'yes' : 'no') : ''}>{sum ? (sum.steady ? 'Yes' : 'No') : ''}</td>
                        <td className={sum ? (sum.inBand ? 'yes' : 'no') : ''}>
                          {item.band[0] === item.band[1] ? item.band[0] : `${item.band[0]} to ${item.band[1]}`}
                          {sum && (sum.inBand ? ': yes' : ': no')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="hint">
                A stored grade never moves: the same answer always gets the grade it was first given. This check leaves the
                store out, to show how far a fresh grading can move. If scores move more than you want, set GRADER_SAMPLES to 5
                on the backend: each new answer is then rated five times.
              </p>
            </section>
          )}
        </>
      )}
    </AppShell>
  )
}
