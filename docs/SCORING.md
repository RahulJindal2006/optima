# How Optima scores an interview

This is the long version. The short version for candidates and companies is the scoring guide in the app
(`/rubric`), which reads its numbers from the server, so the two cannot drift apart.

## The short of it

- Claude never gives a number. For each answer it picks one of five written levels on each line of a fixed
  scorecard, and marks each point the question looks for as covered, partly covered or missing.
- Every sum is done in code (`backend/rubric.py`), so the same levels always give the same score.
- Each new answer is rated three times and the middle rating on each line is kept. So is each role's fit.
- The result is stored under a fingerprint of the question and the answer. The same answer to the same
  question is never rated again: it gets the stored grade, whoever gives it and whenever.
- A skipped question scores 0 and counts in full. Answer fewer than three quarters of the questions and
  no application is sent.
- In a weekly interview, time off camera, time turned away from the screen and a second person in the
  picture take points off, up to 25.

## What was wrong before

The old grading was not hard-coded. It did call Claude, once per answer, and asked for a number from 0 to 100.
Three things made it soft and unrepeatable:

1. The prompt told the grader that a good answer "SHOULD score in the 82-90 range" and "Do not anchor low".
2. The match score for a role came from a second call that was shown only the questions that had been
   answered. Skipped questions were invisible to it, which is how two answers out of eight produced 47.
3. Nothing was stored against the answer, so the same answer could get a different number each time.

## One answer

### Spoken and written answers

| Line | Worth | What it asks |
|---|---|---|
| Answers the question | 20% | Does the answer deal with what was actually asked? |
| Evidence | 30% | Is there something specific behind the claims: a real example, or a worked detail? |
| Covers what the role needs | 35% | How many of the points this question looks for does the answer deal with? |
| Clear and organised | 15% | Could an interviewer follow it the first time through? |

### Coding questions

| Line | Worth | What it asks |
|---|---|---|
| Correct | 40% | Does the solution do what the question asks? |
| Approach | 20% | Is the method a sensible one, and does the candidate know what it costs? |
| Covers what the role needs | 20% | How many of the points this question looks for does the answer deal with? |
| Explained and readable | 20% | Could another person pick this up and work with it? |

### Levels and points

Each line except "Covers what the role needs" gets one of five levels: none 0, weak 25, partial 50, solid 75,
strong 100. Every level of every line has a written description (they are in `rubric.py` and shown in the app).
The grader is told to pick the lower level when an answer sits between two, to rate only what is in the answer,
and not to reward length. It is also shown three worked examples for each scorecard (a strong answer, a thin one
and one that is on the subject without answering), each with the ratings it should get. Interviewers call these
benchmarks. They are about a question the interview never asks, and a unit test checks that each scores where it
should.

"Covers what the role needs" is worked out from the three to five points each question is written with:
covered 1, partly 0.5, missing 0, averaged.

A line's points are its level times its worth. The answer's score is the sum of the lines, to one decimal place.

Four rules sit on top:

- **Blank.** Fewer than 5 words (8 characters of code) scores 0. No call is made.
- **Not an answer.** If the first line ("Answers the question" or "Correct") is rated none, the whole answer
  scores 0, and it does not count as answered.
- **On the subject, not an answer.** If the first line is rated weak, the answer cannot score above 35.
- **Text aimed at the grader.** An answer that asks for a score or tells the grader to ignore its instructions
  scores 0 and is flagged on the record.

What this means in practice: every line at solid with every point covered is 83.8. Every line at strong is 100.
A fair answer with a thin example and three points of five covered lands in the 50s or low 60s.

## Why the same answer gets the same grade

Three things, in order of how much they matter:

1. **The stored grade.** A grade is kept in the `grade_records` table under a SHA-256 fingerprint of the rubric
   version, the kind of question, the question, its points and the answer. Before anything is sent to Claude
   the fingerprint is looked up. If it is there, that grade is used. If two people finish at the same moment
   with the same new answer, the first grade written is the one both get.
2. **Three ratings, middle kept.** A new answer is rated `GRADER_SAMPLES` times (3 by default). On each line
   the middle level is kept. A single odd rating cannot move the result.
3. **Levels, not numbers.** Five described levels leave much less room to wander than a free number out of 100.

What counts as "the same answer": for spoken and written answers, capital letters, spacing and the punctuation
around words are ignored, because dictation gives little of them and none of them is graded. Anything inside a
word is kept (`1.3`, `didn't`) and so is any other symbol (`C++`, `C#`, `40%`). For code, everything is kept
except line endings and trailing spaces.

The stored grade holds nothing about who gave the answer.

Change a description, a weight or a rule in `rubric.py` and change `VERSION` with it. Grades stored under the
old version are left alone and new answers are graded afresh. Changing the model does not regrade anything by
itself: an answer already in the store keeps its grade. Change `VERSION` as well if you want a clean start.

## The interview score

Each question's score counts in proportion to the time it is given, so the questions that ask for more count
for more.

| Kind | Time | In a weekly interview |
|---|---|---|
| General (the same for everyone that week) | 2:00 | 6 |
| About the candidate's roles | 2:30 | 8 |
| Long: coding for technical roles, a case question otherwise | 6:00 or 5:00 | 2 |

That is 16 questions and 44 minutes for technical roles, 42 for the rest.

- A skipped question is a 0 in that sum.
- A question the grader could not rate after every retry is left out of the sum and shown as not scored. No
  score is made up for it.
- **Complete or not.** An interview is complete when at least three quarters of its questions were answered
  (12 of 16). An answer rated "not an answer" does not count. An incomplete interview is still scored and
  shown to the candidate, but it is not matched against roles and no application is sent.

### The camera's part (weekly interviews only)

| What | No points lost up to | All points lost from | Points |
|---|---|---|---|
| Off camera (share of the time on questions) | 5% | 30% | 10 |
| Turned away from the screen (share of the time on camera) | 10% | 40% | 10 |
| A second person in the picture | under 5 seconds | 5 seconds | 5 |

The points come off the interview score, to a most of 25. The time on questions is the server's own count.
Time the camera was not being read counts as off camera, so covering or unplugging it is not a way round.
Looking down while typing is not counted as turned away.

The browser works all of this out on the device. No video and no sound is ever sent or stored. What is sent
is numbers. With each answer: seconds watched, seconds a face was in the picture, seconds turned away, seconds
with a second face, and seconds of voice heard while dictating. At the end: the coach's summary (shares of the
time for eye contact, posture and the like), which only the candidate sees.

If dictated text arrives with far less voice heard than the words would take to say, the answer is flagged on
the record ("voice"). It is not marked down by itself.

## The match score for one role

| Part | Worth | Where it comes from |
|---|---|---|
| Interview performance | 40% | The interview score above. The same for every role. |
| Answer relevance | 35% | Half: one of five levels for how far the answers show this job's work. Half: the share of the posting's skills the answers show (shown 1, mentioned 0.5, absent 0). |
| Profile skills | 10% | The share of the posting's skills on the candidate's own list (listed 1, related 0.5, missing 0). |
| Resume | 15% | Half a level for how the resume fits the job, half the share of the posting's skills it shows. 0 with no resume. |

An application is sent when the match score is 40 or more. The two ratings behind a role (answers against the
posting, profile against the posting) are made three times with the middle kept, like an answer, and stored
under fingerprints too, so the same answers against the same posting always give the same match score. A role
that cannot be rated is left out and counted, not guessed.

## Checking it

- **Unit tests** for every rule and every sum: `cd backend && python -m unittest discover -s tests`.
- **The 100-person check.** `python consistency_check.py` runs the same answers from 100 people through the
  grader and fails if any score differs or if Claude is called for anyone after the first.
- **The live check.** `/scoring-check` in the app (it asks for the backend's `ADMIN_KEY`). It grades reference
  answers of known quality from scratch, as many times as asked, with the stored grade left out. For each
  answer it shows every score it was given and how many runs gave it, and whether it landed where an answer
  of that quality should. For each question it shows whether the better answers always scored higher. Behind
  each score it shows the scorecard the grader gave, and which lines changed on the runs that came out
  differently. The whole result can be copied as text. This is the one that tells you how steady the real
  model is.

The reference answers (`backend/reference_answers.py`, all invented) are four questions with five answers
each, from one a recruiter would call strong down to one that is off the subject: a general question every
candidate can be asked, a software question, a marketing question and a coding question. The coding answers
are run by the unit tests, so "works", "misses a case" and "has a bug" are facts, not opinions. There are also
two lists of fashionable words, one answer that tells the grader to give it full marks, and one blank.

### What has been measured, and what has not

Measured, with a stand-in for Claude that was made to disagree with itself (each line moved a level up or
down 15% of the time), 100 fresh gradings of each reference answer:

| Ratings per answer | How often the most common score came up |
|---|---|
| 1 | 37% to 59% |
| 3 | 78% to 90% |
| 5 | 89% to 98% |

With the stored grade in place, 100 of 100 people who gave the same sixteen answers got the same score on
every question, the same interview score and the same match scores, and Claude was called for the first
person only.

Measured on the live grader, once: 18 November 2026, `claude-sonnet-4-6`, rubric `2026.11-a`, three ratings a
run. Twenty reference answers (the set as it was then), each graded from scratch five times, 285 calls:

| | |
|---|---|
| Answers given the same score on all five runs | 18 of 20 |
| The two that moved | A list of words: 0 four times, 5 once. A middling answer: 53.8 four times, 49.4 once |
| Questions whose answers came out in order | 4 of 4 |
| Strong answers | 95.6 to 100 |
| Middling answers | 49.4 to 67.6 spoken, 80 for correct code with a one-line explanation |
| Thin answers | 16.3 spoken, 27.5 for code with a bug |
| Off the subject, instructing the grader, blank | 0 every time |
| Lists of words | 0 to 5 on a question about experience, 17.6 on a question about knowledge |
| Cost | $1.00 at list prices, about a third of a cent a call |

Two middling answers landed at about 50, just under the 52 that had been predicted as the lowest a middling
answer should get. Read against the scorecard, about 50 is a fair score for both, so the prediction was moved
to 45 and the grader was left as it was. About 87% of the tokens sent were read back from the cache (worked out
from the cost: the page did not show it then, and does now).

Five runs of each answer is a small sample. It shows the grader is steady in the main and where it is not; it
does not show how often a borderline answer moves.

Not measured: 100 fresh gradings of one answer on the real model, how the grader treats answers between
middling and strong (the "good" answers and the code that misses a case were added after this run), and
whether its levels land where a recruiter's would. The first two are a run of `/scoring-check`. The third
needs people reading graded answers against the level descriptions.

## Settings

All optional, on the backend:

| Variable | Default | What it does |
|---|---|---|
| `GRADER_SAMPLES` | 3 | How many times a new answer is rated. Use an odd number. 5 is steadier and costs more. |
| `GRADER_MODEL` | `CLAUDE_MODEL` | A different model for grading than for writing questions. |
| `GRADER_PARALLEL` | 6 | Calls to Claude running at once while an interview is scored. |
| `GRADER_WARM_SECONDS` | 240 | How long after a call the next ones are sent together. 0 sends one first every time. |
| `SCORE_SECONDS` | 30 | How long one grading call may take. |
| `ADMIN_KEY` | none | Needed to open `/scoring-check`. |

Calls for one weekly interview: 1 to write the questions, 3 for each answered question (48 when all sixteen
are answered), and 6 for each open role it is matched against (3 for the answers, 3 for the profile; the
profile's 3 are not repeated until the profile or the posting changes). Skipped questions and anything already
in the store cost nothing. `/scoring-check` shows the tokens a run really used. On the first live run a grading
call cost about a third of a cent (`claude-sonnet-4-6`, list prices, short reference answers). At that rate
the 48 calls for sixteen answers would come to roughly 17 cents before the roles are matched. That is an
estimate: longer answers cost more, and an interview has not been priced on the live site yet.

Two things keep that cheaper and inside the API's rate limits:

- **Reuse.** The scorecard is the same on every grading call, and one interview's answers are the same for
  every role. The API charges a tenth for a part it has seen in the last five minutes, and that part does not
  count towards the rate limit. A call sent at the same moment as the first gets none of that, so when nothing
  has been sent for a while one call goes alone and the rest follow together.
- **Slowing down.** When the API says to slow down (a rate limit, or the service is overloaded) that is not a
  failed grading. Nothing is given up on: the request reports that there is more to do, the page asks again,
  and one call is sent first to see whether the limit has lifted. Only the monthly spend cap is reported as a
  failure, because waiting does not help.

No sampling setting (temperature and the like) is sent: the newer models reject them. Repeatability comes from
the three things above, not from a setting.

## What the research says, and what was taken from it

- **Score each answer against written levels.** Structured interviews came out as the top-ranked selection
  method in a 2022 re-analysis of the evidence on what predicts job performance (mean validity .42). What makes an
  interview structured includes asking everyone the same questions, rating each answer on its own and using
  anchored rating scales. The US Office of Personnel Management describes the same thing: the same questions,
  "scored according to benchmarks of proficiency".
  Taken: the same general questions for everyone each week, one rating per answer, a written description for
  every level.
- **Add the ratings up by rule.** Combining ratings by a fixed formula predicted job performance better than
  an expert's overall judgement, by more than 50% in a meta-analysis of selection decisions.
  Taken: the grader never gives an overall mark. Code adds the lines up.
- **What employers say they look for.** In NACE's Job Outlook 2026 Spring Update (185 employers), the
  competencies rated most important for new graduates were communication, teamwork, professionalism and
  critical thinking.
  Taken: the general question bank (working with others, a setback, priorities, explaining something, a
  disagreement) and the "Clear and organised" line.
- **Short scales and described levels for a model that grades.** A 2026 study of grading scales found human
  and model graders agreed best on a 0 to 5 scale (better than 0 to 10 or 0 to 100). A 2026 framework for
  rubric grading with models is built on separate criteria, ordered levels, descriptions tied to what can be
  observed and more than one grader, and it notes that consistency is necessary but not sufficient.
  Taken: a short scale of five described levels, three ratings, and the limits below.

Sources:

- Sackett, Zhang, Berry and Lievens (2022). Revisiting meta-analytic estimates of validity in personnel
  selection. *Journal of Applied Psychology*, 107(11), 2040-2068. https://doi.org/10.1037/apl0000994
- Kuncel, Klieger, Connelly and Ones (2013). Mechanical versus clinical data combination in selection and
  admissions decisions: a meta-analysis. *Journal of Applied Psychology*, 98(6), 1060-1072.
  https://doi.org/10.1037/a0034156
- Campion, Palmer and Campion (1997). A review of structure in the selection interview. *Personnel
  Psychology*, 50(3), 655-702.
- US Office of Personnel Management, Structured Interviews.
  https://www.opm.gov/policy-data-oversight/assessment-and-selection/other-assessment-methods/structured-interviews
- NACE, Job Outlook 2026 Spring Update (survey of 12 February to 17 March 2026).
  https://naceweb.org/career-readiness/trends-and-predictions/employers-say-new-grads-are-largely-prepared-for-work-with-room-to-improve
- Li and others (2026). Grading Scale Impact on LLM-as-a-Judge: Human-LLM Alignment Is Highest on 0-5 Grading
  Scale. https://arxiv.org/abs/2601.03444
- Rao and Callison-Burch (2026). Autorubric: Unifying Rubric-based LLM Evaluation.
  https://arxiv.org/abs/2603.00077

## Limits

- **Consistent is not the same as right.** The stored grade guarantees that the same answer gets the same
  score. It does not show that the score is the one a good recruiter would give. That needs people reading
  graded answers, and it has not been done yet.
- **Nearly the same is not the same.** Change one word and the answer is graded afresh. Three ratings keep
  that close to the first grade, not identical to it.
- **Questions about the roles differ between candidates.** The six general questions are the same for
  everyone in a week. The other ten are written from the roles each candidate saved, so two candidates are
  compared on the same scorecard but not always on the same questions.
- **The camera can be wrong.** Poor light, glasses and an odd camera angle all make a face harder to read.
  That is why the first few percent cost nothing, why the most it can take is 25 points, and why the shares
  are on the record for a company to read rather than hidden in the score.
- **A model's grading can carry bias.** Nothing about the candidate except the answer is sent to the grader,
  and dictated answers are not marked down for spelling or punctuation. That reduces the risk. It does not
  measure it.
