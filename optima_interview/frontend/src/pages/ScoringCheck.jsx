import { useRef, useState } from 'react'
import { getScoringCheck, runScoringCheck } from '../api/client'
import AppShell, { PageHead } from '../components/AppShell'
import { Field, Notice } from '../components/Bits'
import Scorecard from '../components/Scorecard'
import { LEVEL_NAME, MARK_NAME } from '../lib/score'
import '../styles/pages.css'

// For the site's owner. Grades a set of answers of known quality, many times over, on the live grader
// (backend/routers/scoring.py), and shows whether a score ever moves, whether each lands where an answer
// of that quality should, whether the answers to each question come out in order, and the scorecard
// behind each score. Every run makes real calls to Claude, so nothing starts until it is asked for.

const RUN_CHOICES = [5, 20, 50, 100]
const AT_ONCE = 4 // runs asked for in one request: small enough to finish well inside a server's time limit
// The five the check starts with ticked: one of each quality, across a general, a knowledge, a situation and a coding question.
const FIRST = ['team-strong', 'team-thin', 'testing-sound', 'campaign-sound', 'unique-strong']

// List prices in US dollars per million tokens (input, output), read from Anthropic's pricing page on
// 17 November 2026. Only used to turn tokens into a rough cost. Check your own invoice.
const PRICES = {
  'claude-sonnet-4-6': [3, 15],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-opus-5-5': [4, 20],
}

// What one call used on average over the first two runs of this check on the live grader (18 November 2026,
// claude-sonnet-4-6: 372 calls, 833,364 tokens in, 53,217 out, $1.37). Most of what is sent is the scorecard,
// which is read back from the cache after the first call. Only used to say roughly what a run will cost
// before it starts: the figure shown after a run comes from what that run really used.
const A_CALL = { fresh: 324, cached: 1916, out: 143 }

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const tidy = (n) => (Number(n) % 1 ? Number(n).toFixed(1) : String(Number(n)))
const count = (n) => Number(n).toLocaleString('en-CA')
const dollars = (price, fresh, cached, out) => ((fresh + cached * 0.1) * price[0] + out * price[1]) / 1e6
const blankRow = () => ({ scores: [], failed: 0, why: [], agree: [], kinds: {} })
const copyOf = (row) => ({ ...row, scores: [...row.scores], why: [...row.why], agree: [...row.agree], kinds: Object.fromEntries(Object.entries(row.kinds).map(([sign, kind]) => [sign, { ...kind }])) })

// One more run of an answer. Two runs are the same grading when every line of the scorecard got the same
// level and every point the same mark: `kinds` holds each different grading once, with how often it came up.
function record(row, run) {
  row.scores.push(run.score)
  if (run.ratings > 0) row.agree.push(run.agreement)
  const sign = JSON.stringify([Object.entries(run.levels || {}).sort(), run.marks || [], Boolean(run.manipulation)])
  if (!row.kinds[sign]) {
    row.kinds[sign] = { times: 0, score: run.score, manipulation: Boolean(run.manipulation), unsent: run.ratings === 0, card: run.card || null }
  }
  row.kinds[sign].times += 1
}

// The different gradings an answer was given. First the one behind the score it got most often (`most`),
// then the rest, the most frequent first.
const gradings = (row, most) =>
  Object.values(row?.kinds || {}).sort((a, b) => (b.score === most) - (a.score === most) || b.times - a.times || b.score - a.score)

function summarise(row, band) {
  if (!row || row.scores.length === 0) return null
  const counts = new Map()
  for (const s of row.scores) counts.set(s, (counts.get(s) || 0) + 1)
  const tally = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]) // the score seen most often first
  const low = Math.min(...row.scores)
  const high = Math.max(...row.scores)
  return {
    done: row.scores.length,
    low,
    high,
    most: tally[0][0],
    tally,
    steady: counts.size === 1,
    inBand: low >= band[0] && high <= band[1],
    agree: row.agree.length ? row.agree.reduce((a, b) => a + b, 0) / row.agree.length : null,
  }
}

// Within one question a better answer must never score below a worse one, on any run. A question is
// judged once two or more of its answers have been run.
function inOrder(ladders, byId) {
  const out = { judged: 0, held: 0, broken: [] }
  for (const ladder of ladders) {
    const steps = ladder.map((id) => byId[id]).filter((r) => r?.sum)
    if (steps.length < 2) continue
    const wrong = steps.slice(1).flatMap((worse, i) => (steps[i].sum.low < worse.sum.high ? [[steps[i], worse]] : []))
    out.judged += 1
    if (wrong.length === 0) out.held += 1
    out.broken.push(...wrong)
  }
  return out
}

// What one grading said, on one line: "answer solid | evidence partial | points covered, partly, partly, missing | clarity solid".
function said(kind) {
  if (kind.manipulation) return 'read as instructions aimed at the grader'
  if (kind.unsent) return 'too short to be an answer: not sent to the grader'
  if (!kind.card) return 'no scorecard came back with this run'
  return kind.card.lines.map((line) => (line.points ? `points ${line.points.map((p) => p.mark).join(', ')}` : `${line.key} ${line.level}`)).join(' | ')
}

// Where another grading of the same answer parted from the usual one, as sentences.
function differences(usual, other) {
  if (other.manipulation !== usual.manipulation) {
    return [other.manipulation ? 'It was read as instructions aimed at the grader.' : 'It was not read as instructions aimed at the grader.']
  }
  const out = []
  for (const line of usual.card?.lines || []) {
    const twin = (other.card?.lines || []).find((x) => x.key === line.key)
    if (!twin) continue
    if (line.points) {
      line.points.forEach((point, i) => {
        const mark = twin.points?.[i]?.mark
        if (mark && mark !== point.mark) out.push(`“${point.text}” was marked ${MARK_NAME[mark]}, not ${MARK_NAME[point.mark]}.`)
      })
    } else if (twin.level !== line.level) {
      out.push(`${line.label} was rated ${LEVEL_NAME[twin.level]}, not ${LEVEL_NAME[line.level]}.`)
    }
  }
  return out
}

// The whole result as plain text, to paste somewhere it can be kept or read by someone else.
function asText({ setup, runs, at, used, cost, results, order, steady, inBand, widest, refused }) {
  const finished = results.filter((r) => r.sum)
  const head = [
    `Optima scoring check${at ? `, ${at}` : ''}`,
    `${setup.model}, rubric ${setup.version}, ${setup.samples} rating${setup.samples === 1 ? '' : 's'} a run, ${runs} runs for each answer`,
    `${count(used.calls)} calls, ${count(used.input_tokens)} tokens in, ${count(used.cached_tokens)} more read from cache, ${count(used.output_tokens)} out` +
      (cost != null ? `, about $${cost.toFixed(2)} at list prices` : ''),
  ]
  if (refused) head.push(`Stopped at “${refused.at}”: Anthropic refused the calls. ${refused.reason}`)
  if (finished.length > 0) {
    head.push(
      `Same score on every run: ${steady} of ${finished.length}. Widest gap: ${tidy(widest)}. Where it should land: ${inBand} of ${finished.length}.` +
        (order.judged ? ` In order: ${order.held} of ${order.judged} questions.` : ''),
    )
  }
  const blocks = results.map(({ item, sum, row, failed }) => {
    const lines = [`${item.label} [${item.id}], should land ${item.band[0]} to ${item.band[1]}`]
    const why = (row?.why || []).map((reason) => `failed: ${reason}`)
    if (!sum) return [...lines, failed ? `could not be graded (${failed} failed)` : 'not run', ...why].join('\n')
    lines.push(`scores: ${sum.tally.map(([score, times]) => `${tidy(score)} (${times})`).join(', ')}${failed ? `, ${failed} failed` : ''}`)
    lines.push(...why)
    const kinds = gradings(row, sum.most)
    for (const kind of kinds) lines.push(`${kind.times} of ${sum.done}, score ${tidy(kind.score)}: ${said(kind)}`)
    if (sum.agree != null) lines.push(`the separate ratings agreed with the one kept on ${Math.round(sum.agree * 100)}% of lines`)
    const words = kinds[0].card
    if (words?.seen) lines.push(`seen: ${words.seen}`)
    if (words?.measure) lines.push(`measured: ${words.measure}`)
    if (words?.trace) lines.push(`trace: ${words.trace}`)
    if (words?.strength) lines.push(`worked: ${words.strength}`)
    if (words?.improve) lines.push(`would raise it: ${words.improve}`)
    return lines.join('\n')
  })
  return [head.join('\n'), ...blocks].join('\n\n')
}

// One answer, opened: the question, what was answered, the scorecard it was given most often, and
// what was different on the runs that were graded another way.
function Behind({ item, row, most, done }) {
  const kinds = gradings(row, most)
  const usual = kinds[0]
  return (
    <div className="check-why">
      <p className="check-q">{item.question}</p>
      {item.answer ? (
        item.question_type === 'code' ? (
          <pre className="prose answer code">{item.answer}</pre>
        ) : (
          <p className="prose answer">{item.answer}</p>
        )
      ) : (
        <p className="muted">Nothing was written.</p>
      )}

      {usual.manipulation ? (
        <Notice icon="alert">This was read as instructions aimed at the grader, so it scored 0.</Notice>
      ) : usual.card ? (
        <Scorecard rubric={usual.card} />
      ) : (
        usual.unsent && <p className="muted">Too short to be an answer, so it scored 0 without being sent to the grader.</p>
      )}

      {kinds.length > 1 && (
        <div className="check-other">
          <p>
            That is how {usual.times} of {done} runs graded it. The rest:
          </p>
          <ul>
            {kinds.slice(1).map((kind, i) => (
              <li key={i}>
                <strong>
                  {kind.times} of {done} scored {tidy(kind.score)}.
                </strong>{' '}
                {differences(usual, kind).join(' ')}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default function ScoringCheck() {
  const [key, setKey] = useState('')
  const [setup, setSetup] = useState(null)
  const [problem, setProblem] = useState('')
  const [chosen, setChosen] = useState(FIRST)
  const [runs, setRuns] = useState(20)
  const [rows, setRows] = useState({})
  const [ran, setRan] = useState({ ids: [], runs: 20, at: '' }) // what the result on the page was run with, and when it ended
  const [used, setUsed] = useState({ calls: 0, input_tokens: 0, cached_tokens: 0, output_tokens: 0 })
  const [state, setState] = useState('idle') // idle | loading | running | done | stopped
  const [waiting, setWaiting] = useState(0) // seconds Claude asked the check to hold off for, while it does
  const [copied, setCopied] = useState({ how: '', text: '' }) // how: '' | done | byhand (the browser would not copy: the text is shown instead)
  const [refused, setRefused] = useState(null) // { reason, at } when Anthropic refused the calls and the run was stopped for it
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
  const price = PRICES[setup?.model]
  const likely = price && calls > 0 ? dollars(price, A_CALL.fresh * calls, A_CALL.cached * calls, A_CALL.out * calls) : null

  const toggle = (id) => setChosen((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]))

  const start = async () => {
    stop.current = false
    setProblem('')
    setCopied({ how: '', text: '' })
    setRefused(null)
    setRows({})
    setRan({ ids: picked.map((c) => c.id), runs, at: '' })
    setUsed({ calls: 0, input_tokens: 0, cached_tokens: 0, output_tokens: 0 })
    setState('running')
    const totals = {}
    const show = () => setRows(Object.fromEntries(Object.entries(totals).map(([id, row]) => [id, copyOf(row)])))
    try {
      for (const item of picked) {
        totals[item.id] = blankRow()
        while (totals[item.id].scores.length + totals[item.id].failed < runs && !stop.current) {
          const left = runs - totals[item.id].scores.length - totals[item.id].failed
          const reply = await runScoringCheck(key.trim(), { case: item.id, runs: Math.min(AT_ONCE, left) })
          for (const run of reply.runs) {
            if (!run) totals[item.id].failed += 1
            else record(totals[item.id], run)
          }
          // a sentence for each run that could not be graded. The last is left out when it is the refusal that
          // stopped the run: that one is shown once, at the top of the result.
          totals[item.id].why.push(...(reply.failures || []).slice(0, reply.refused ? -1 : undefined))
          show()
          setUsed((was) => Object.fromEntries(Object.keys(was).map((k) => [k, was[k] + (reply.used?.[k] || 0)])))
          if (reply.refused) {
            // the key, the account's credit or a limit: the next call would be refused for the same reason,
            // so nothing more is sent, for this answer or the ones after it
            setRefused({ reason: reply.refused, at: item.label })
            stop.current = true
          } else if (reply.wait_seconds > 0 && !stop.current) {
            // a rate limit says nothing about the grader: wait as long as Claude asked, then carry on with the runs left
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
    setRan((was) => ({ ...was, at: new Date().toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) }))
  }

  // the result stays as it was run, whatever is ticked or chosen afterwards
  const results = cases
    .filter((c) => ran.ids.includes(c.id))
    .map((c) => ({ item: c, row: rows[c.id], sum: summarise(rows[c.id], c.band), failed: rows[c.id]?.failed || 0 }))
  const finished = results.filter((r) => r.sum)
  const anything = results.some((r) => r.sum || r.failed > 0) // something to show, even if it is only runs that failed
  const steady = finished.filter((r) => r.sum.steady).length
  const inBand = finished.filter((r) => r.sum.inBand).length
  const widest = finished.reduce((gap, r) => Math.max(gap, r.sum.high - r.sum.low), 0)
  const order = inOrder(setup?.ladders || [], Object.fromEntries(results.map((r) => [r.item.id, r])))
  const cost = price ? dollars(price, used.input_tokens, used.cached_tokens, used.output_tokens) : null
  const busy = state === 'running'

  const copy = async () => {
    const text = asText({ setup, runs: ran.runs, at: ran.at, used, cost, results, order, steady, inBand, widest, refused })
    try {
      await navigator.clipboard.writeText(text)
      setCopied({ how: 'done', text })
    } catch {
      setCopied({ how: 'byhand', text })
    }
  }

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
            <div className="check-all">
              <button type="button" className="btn secondary sm" onClick={() => setChosen(cases.map((c) => c.id))} disabled={busy || picked.length === cases.length}>
                Tick all
              </button>
              <button type="button" className="btn secondary sm" onClick={() => setChosen([])} disabled={busy || picked.length === 0}>
                Clear
              </button>
              <span>
                {picked.length} of {cases.length} ticked
              </span>
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
              This will make {count(calls)} calls to Claude{likely != null && `, about $${likely.toFixed(2)} at list prices`}, charged to
              your Anthropic account. Nothing is stored: every run grades from scratch.
            </p>
          </section>

          {(busy || anything) && (
            <section className="section">
              <div className="section-head">
                <h2>{busy ? 'Running' : state === 'done' ? 'Result' : 'Stopped part-way'}</h2>
                <p>
                  {count(used.calls)} calls, {count(used.input_tokens + used.cached_tokens)} tokens in
                  {used.cached_tokens > 0 && ` (${count(used.cached_tokens)} from cache)`}, {count(used.output_tokens)} out
                  {cost != null && used.calls > 0 && `, about $${cost.toFixed(2)} at list prices`}
                </p>
              </div>

              {waiting > 0 && (
                <p className="hint" role="status">
                  Claude asked for a pause (a rate limit). Carrying on in {waiting} seconds. Nothing is lost.
                </p>
              )}

              {refused && (
                <div className="check-stopped">
                  <Notice tone="stop" title="Anthropic refused the calls, so the run stopped.">
                    {refused.reason} It stopped at “{refused.at}”. Nothing more was sent
                    {finished.length > 0 ? ', and the scores already here stand.' : '.'}
                  </Notice>
                </div>
              )}

              {finished.length > 0 && (
                <dl className="check-sum">
                  <div className={steady === finished.length ? 'yes' : 'no'}>
                    <dt>Same score on every run</dt>
                    <dd>
                      {steady} of {finished.length} {finished.length === 1 ? 'answer' : 'answers'}
                    </dd>
                  </div>
                  <div>
                    <dt>Widest gap between two runs of one answer</dt>
                    <dd>{widest > 0 ? `${tidy(widest)} ${tidy(widest) === '1' ? 'point' : 'points'}` : 'None'}</dd>
                  </div>
                  <div className={inBand === finished.length ? 'yes' : 'no'}>
                    <dt>Landed where an answer of that quality should</dt>
                    <dd>
                      {inBand} of {finished.length} {finished.length === 1 ? 'answer' : 'answers'}
                    </dd>
                  </div>
                  {order.judged > 0 && (
                    <div className={order.held === order.judged ? 'yes' : 'no'}>
                      <dt>Better answers never scored below worse ones</dt>
                      <dd>
                        {order.held} of {order.judged} {order.judged === 1 ? 'question' : 'questions'}
                      </dd>
                    </div>
                  )}
                </dl>
              )}

              {order.broken.length > 0 && (
                <Notice tone="stop" title="Out of order.">
                  {order.broken
                    .map(([better, worse]) => `“${worse.item.label}” scored as high as ${tidy(worse.sum.high)} and “${better.item.label}” as low as ${tidy(better.sum.low)}.`)
                    .join(' ')}
                </Notice>
              )}

              {anything && !busy && (
                <div className="check-copy">
                  <button type="button" className="btn secondary sm" onClick={copy}>
                    Copy the result as text
                  </button>
                  <span role="status">{copied.how === 'done' && 'Copied.'}</span>
                  {copied.how === 'byhand' && (
                    <Field label="Your browser would not copy it. Select this and copy it yourself." htmlFor="check-text">
                      <textarea id="check-text" className="textarea" rows={8} readOnly value={copied.text} onFocus={(event) => event.target.select()} />
                    </Field>
                  )}
                </div>
              )}

              <div className="check-table" role="region" aria-label="Results, one row for each answer" tabIndex={0}>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Answer</th>
                      <th scope="col">Runs</th>
                      <th scope="col">Score (runs)</th>
                      <th scope="col">Same every run</th>
                      <th scope="col">Where it should land</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map(({ item, sum, failed }) => (
                      <tr key={item.id}>
                        <th scope="row">{item.label}</th>
                        <td>
                          {sum ? sum.done : 0} of {ran.runs}
                          {failed > 0 && `, ${failed} failed`}
                        </td>
                        <td>{sum ? (sum.steady ? tidy(sum.most) : sum.tally.map(([score, times]) => `${tidy(score)} (${times})`).join(', ')) : ''}</td>
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
              {results.some((r) => r.row?.why.length > 0) && (
                <Notice tone="stop" title="Some runs could not be graded.">
                  <ul className="check-failed">
                    {results
                      .filter((r) => r.row?.why.length > 0)
                      .map(({ item, row }) => (
                        <li key={item.id}>
                          {item.label}: {row.why.join(' ')}
                        </li>
                      ))}
                  </ul>
                  A run that fails is left out of the scores. In an interview, an answer that cannot be graded is left out of the
                  score and can be graded again.
                </Notice>
              )}
              <p className="hint">
                A stored grade never moves: the same answer always gets the grade it was first given. This check leaves the
                store out, to show how far a fresh grading can move. If scores move more than you want, set GRADER_SAMPLES to 5
                on the backend: each new answer is then rated five times.
              </p>
            </section>
          )}

          {finished.length > 0 && (
            <section className="section">
              <div className="section-head">
                <h2>Behind each score</h2>
                <p>The scorecard each answer was given most often</p>
              </div>
              <ul className="check-behind">
                {finished.map(({ item, sum, row }) => (
                  <li key={item.id}>
                    <details className="reveal">
                      <summary>
                        {item.label}: {tidy(sum.most)}
                        {(!sum.steady || !sum.inBand) && (
                          <span className="check-flag">{[!sum.steady && 'moved between runs', !sum.inBand && 'outside its range'].filter(Boolean).join(', ')}</span>
                        )}
                      </summary>
                      <Behind item={item} row={row} most={sum.most} done={sum.done} />
                    </details>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </AppShell>
  )
}
