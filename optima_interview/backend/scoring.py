"""Grading an interview: look each grade up, have what is new rated, keep the result.

Three things make a grade repeatable, in this order:
  1. The grader picks written levels, not a number (rubric.py), so there is little room to wander.
  2. A new answer is rated several times and the middle rating on each line is kept.
  3. The result is stored under a fingerprint of the question and the answer (the grade_records
     table). The same answer is never rated again: it gets the stored grade.
The third is the guarantee. The first two keep answers that are nearly the same close together.
"""
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional, Sequence, Tuple

from sqlalchemy.orm import Session

import claude_client
import models
import rubric

log = logging.getLogger("optima")


def _setting(name: str, default: int, low: int, high: int) -> int:
    try:
        return min(high, max(low, int(os.getenv(name, default))))
    except ValueError:
        return default


# How many times a new answer is rated. Three costs three calls and takes the middle of three.
# One is the cheapest and leans on the stored grade alone. Use an odd number.
SAMPLES = _setting("GRADER_SAMPLES", 3, 1, 7)
# How many calls to Claude run at the same time while an interview is scored.
PARALLEL = _setting("GRADER_PARALLEL", 6, 1, 16)

NO_ANSWER = "No answer was given, so this question scored 0."
MANIPULATION = "This answer contained instructions aimed at the grader, so it scored 0."


class _Busy:
    """Stands in for a grade that could not be had yet because Claude said to slow down.

    It is not a failure: nothing is wrong with the answer or the request. Whoever asked should wait
    `seconds` and ask again, and must never treat it as an answer that could not be graded.
    """

    def __init__(self, seconds: float):
        self.seconds = seconds

    def __repr__(self) -> str:
        return f"<busy, try again in {self.seconds:.0f}s>"


def is_busy(value: Any) -> bool:
    return isinstance(value, _Busy)


def wait_for(values: Sequence[Any]) -> float:
    """The longest wait asked for among `values`, in seconds. 0 when none of them is busy."""
    return max((value.seconds for value in values if is_busy(value)), default=0.0)


def _safely(call, *args, **kwargs):
    return _tried(call, args, kwargs, None)


def _tried(call, args, kwargs, why: Optional[List[str]]):
    """Make one call. A dict when it worked, busy when Claude said to slow down, None when it failed.
    When `why` is given, a sentence saying what went wrong is added to it for each failure."""
    try:
        return call(*args, **kwargs)
    except claude_client.Busy as err:
        log.info("Claude is busy: %s", err)
        return _Busy(err.seconds)
    except Exception as err:  # one failed rating must not sink the others
        log.warning("A rating failed: %s", err)
        if why is not None:
            why.append(claude_client.why(err))
        return None


# ── Sending calls so that the API can reuse what they share ──────────────────
# Calls that begin with the same text (the scorecard, or one interview's answers) are charged a tenth
# for that part once one of them has been answered, and that part stops counting towards the rate
# limit. A call sent at the same moment as the first gets none of that. So when nothing has been sent
# for a while, one call goes alone and the rest follow together.
# The API keeps the shared part for five minutes after its last use. Set GRADER_WARM_SECONDS to 0 to send one call first every time.
WARM_SECONDS = float(_setting("GRADER_WARM_SECONDS", 240, 0, 3300))
_warm: Dict[str, float] = {}
_warm_lock = threading.Lock()


def _is_warm(share: str) -> bool:
    with _warm_lock:
        return _warm.get(share, 0.0) > time.monotonic()


def _warmed(share: str) -> None:
    now = time.monotonic()
    with _warm_lock:
        _warm[share] = now + WARM_SECONDS
        for key in [key for key, until in _warm.items() if until <= now]:
            del _warm[key]


def _cooled(share: str) -> None:
    with _warm_lock:
        _warm.pop(share, None)


def _run_all(tasks: Sequence[Any], run, share_of) -> List[Any]:
    """Run every task and return the results in order. `share_of(task)` names what a task has in
    common with others. The first task of each share goes alone when that share is cold.

    If that first call is told to slow down, the rest of its share is not sent at all: each comes
    back busy. And a share that was told to slow down is cold again, so the next attempt starts
    with one call, not with all of them.
    """
    results: List[Any] = [None] * len(tasks)
    first_of: Dict[str, int] = {}
    for i, task in enumerate(tasks):
        first_of.setdefault(share_of(task), i)
    alone = [i for share, i in first_of.items() if not _is_warm(share) and sum(1 for t in tasks if share_of(t) == share) > 1]
    held: Dict[str, _Busy] = {}

    def note(i: int, result: Any) -> None:
        results[i] = result
        if isinstance(result, dict):
            _warmed(share_of(tasks[i]))
        elif is_busy(result):
            _cooled(share_of(tasks[i]))

    with ThreadPoolExecutor(max_workers=PARALLEL) as pool:
        for i, result in zip(alone, pool.map(lambda i: run(tasks[i]), alone)):
            note(i, result)
            if is_busy(result):
                held[share_of(tasks[i])] = result
        rest = [i for i in range(len(tasks)) if i not in alone]
        for i in rest:
            if share_of(tasks[i]) in held:
                results[i] = held[share_of(tasks[i])]
        go = [i for i in rest if share_of(tasks[i]) not in held]
        for i, result in zip(go, pool.map(lambda i: run(tasks[i]), go)):
            note(i, result)
    return results


# ── The stored grades ────────────────────────────────────────────────────────

def stored(db: Session, keys: Sequence[str]) -> Dict[str, dict]:
    wanted = [key for key in dict.fromkeys(keys) if key]
    if not wanted:
        return {}
    rows = db.query(models.GradeRecord).filter(models.GradeRecord.key.in_(wanted)).all()
    return {row.key: row.result for row in rows}


def keep(db: Session, key: str, kind: str, result: dict) -> dict:
    """Store a grade and return the one that stands.

    If a grade is already stored under this fingerprint (someone gave the same answer a moment
    ago, on another server), that one stands and this one is dropped: first in, kept for good.
    """
    values = dict(key=key, kind=kind, rubric_version=rubric.VERSION, model=claude_client.GRADER_MODEL, result=result)
    dialect = db.get_bind().dialect.name
    if dialect == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    elif dialect == "sqlite":
        from sqlalchemy.dialects.sqlite import insert
    else:
        insert = None
    if insert is not None:
        db.execute(insert(models.GradeRecord).values(**values).on_conflict_do_nothing(index_elements=["key"]))
    elif not db.query(models.GradeRecord.key).filter(models.GradeRecord.key == key).first():
        db.add(models.GradeRecord(**values))
    db.flush()
    row = db.query(models.GradeRecord).filter(models.GradeRecord.key == key).first()
    return row.result if row is not None else result


# ── One answer ───────────────────────────────────────────────────────────────

def _blank() -> Dict[str, Any]:
    return {
        "score": 0.0,
        "feedback": NO_ANSWER,
        "key_points_hit": [],
        "manipulation": False,
        "answered": False,
        "rubric": {"version": rubric.VERSION, "blank": True, "answered": False, "lines": [], "cap": "none"},
    }


def graded(record: dict, question_type: str, key_points: Sequence[str]) -> Dict[str, Any]:
    """A stored rating, turned into the score and the scorecard that are shown."""
    kind = "code" if question_type == "code" else "verbal"
    card = rubric.scorecard(kind, record["levels"], record["marks"], key_points)
    detail = {
        "version": rubric.VERSION,
        "lines": card["lines"],
        "cap": card["cap"],
        "answered": card["answered"],
        "seen": record.get("seen", ""),
        "limits": card.get("limits"),           # the least and the most an on-the-subject non-answer can score, when one of them applied
        "measure": record.get("measure", ""),   # the figure quoted from the answer, where the evidence was rated at the top
        "trace": record.get("trace", ""),       # for code: what the grader worked out the solution returns
        "strength": record.get("strength", ""),
        "improve": record.get("improve", ""),
        "samples": record.get("samples", 1),
        "agreement": record.get("agreement"),
    }
    if record.get("manipulation"):
        # text written for the grader, not for the question: it earns nothing and goes on the record
        detail.update({"answered": False, "cap": "manipulation"})
        return {"score": 0.0, "feedback": MANIPULATION, "key_points_hit": [], "manipulation": True, "answered": False, "rubric": detail}
    return {
        "score": card["score"],
        "feedback": rubric.feedback_text(card, record.get("strength", ""), record.get("improve", "")),
        "key_points_hit": [text for text, mark in zip(key_points, record["marks"]) if mark == "covered"],
        "manipulation": False,
        "answered": card["answered"],
        "rubric": detail,
    }


def rate(item: Tuple[str, str, Sequence[str], str], samples: int = SAMPLES, lenient: bool = False,
         pool: Optional[ThreadPoolExecutor] = None, why: Optional[List[str]] = None) -> Any:
    """Rate one answer afresh, `samples` times, and keep the middle rating on every line.

    Nothing is looked up and nothing is stored here. None when too few ratings came back to trust:
    at least two are needed (one, when only one was asked for or `lenient` is set). Busy (see
    is_busy) when they were too few because Claude said to slow down. Pass a list as `why` to be
    told, in a sentence each, what went wrong with any rating that failed.
    """
    text, question_type, key_points, answer = item
    kind = "code" if question_type == "code" else "verbal"
    calls = [(text, kind, list(key_points), answer)] * samples
    if pool is None:
        ratings = [_tried(claude_client.rate_answer, call, {}, why) for call in calls]
    else:
        ratings = list(pool.map(lambda call: _tried(claude_client.rate_answer, call, {}, why), calls))
    return _settled(ratings, lambda good: settle(good, kind, len(key_points), samples, lenient))


def _settled(ratings: Sequence[Any], settle_good) -> Any:
    """One result from several tries: the combined rating, None if it failed, busy if it has to wait."""
    final = settle_good([r for r in ratings if isinstance(r, dict)])
    if final is None and any(is_busy(r) for r in ratings):
        return _Busy(wait_for(ratings))
    return final


def settle(ratings: List[dict], kind: str, points: int, asked: int, lenient: bool = False) -> Optional[dict]:
    needed = 1 if (asked == 1 or lenient) else 2
    if len(ratings) < needed:
        return None
    return rubric.combine(ratings, kind, points)


def grade_answers(db: Session, items: Sequence[Tuple[str, str, Sequence[str], str]], lenient: bool = False) -> List[Any]:
    """A grade for each (question, kind, points to look for, answer).

    None where grading failed. Busy (see is_busy) where Claude said to slow down: ask again shortly.
    An answer too short to be one scores 0 without being sent anywhere. An answer that has been
    graded before gets its stored grade. The rest are rated, a few calls at a time, and stored.
    """
    out: List[Any] = [None] * len(items)
    keys: List[Optional[str]] = [None] * len(items)
    for i, (text, question_type, key_points, answer) in enumerate(items):
        if rubric.is_blank(answer, question_type):
            out[i] = _blank()
        else:
            keys[i] = rubric.answer_key(text, question_type, key_points, answer)

    known = stored(db, [key for key in keys if key])
    first: Dict[str, int] = {}   # the same answer twice in one batch is rated once
    for i, key in enumerate(keys):
        if key and key not in known:
            first.setdefault(key, i)

    waiting: Dict[str, _Busy] = {}
    if first:
        kind_of = lambda i: "code" if items[i][1] == "code" else "verbal"  # noqa: E731
        tasks = [(key, i) for key, i in first.items() for _ in range(SAMPLES)]
        ratings = _run_all(
            tasks,
            lambda task: _safely(claude_client.rate_answer, items[task[1]][0], items[task[1]][1], list(items[task[1]][2]), items[task[1]][3]),
            lambda task: "answer:" + kind_of(task[1]),   # every answer of one kind is rated against the same scorecard
        )
        for key, i in first.items():
            mine = [r for (k, _), r in zip(tasks, ratings) if k == key]
            final = _settled(mine, lambda good, i=i: settle(good, kind_of(i), len(items[i][2]), SAMPLES, lenient))
            if is_busy(final):
                waiting[key] = final
            elif final is not None:
                known[key] = keep(db, key, "answer", final)

    for i, key in enumerate(keys):
        if key and key in known:
            out[i] = graded(known[key], items[i][1], items[i][2])
        elif key and key in waiting:
            out[i] = waiting[key]
    return out


# ── The interview as a whole ─────────────────────────────────────────────────

def seconds_allowed(question: models.InterviewQuestion) -> int:
    return int(question.seconds or rubric.seconds_for(question.category, question.question_type))


def interview_card(questions: Sequence[models.InterviewQuestion], meta: Dict[str, dict], weekly: bool) -> Dict[str, Any]:
    """How the interview's score was reached: every question weighted by its time, skipped ones at 0,
    less what the camera cost (weekly interviews only)."""
    rows = []
    answered = 0
    for question in questions:
        about = meta.get(str(question.id)) or {}
        rows.append((seconds_allowed(question), None if about.get("ungraded") else (question.score or 0.0)))
        if (question.rubric or {}).get("answered"):
            answered += 1
    raw = rubric.interview_score(rows)
    card: Dict[str, Any] = {
        "version": rubric.VERSION,
        "raw": raw,
        "completion": rubric.completion(answered, len(questions)),
        "presence": None,
        "overall": raw,
    }
    if weekly:
        totals = {"seconds": 0.0, "w": 0.0, "p": 0.0, "a": 0.0, "o": 0.0}
        for question in questions:
            about = meta.get(str(question.id)) or {}
            # time on the question by the server's clock, never more than the question allowed
            spent = min(float(about.get("seconds") or 0), seconds_allowed(question) + rubric.GRACE_SECONDS)
            totals["seconds"] += spent
            cam = about.get("cam") or {}
            for key in ("w", "p", "a", "o"):
                totals[key] += min(float(cam.get(key) or 0), spent)
        card["presence"] = rubric.presence(totals["seconds"], totals["w"], totals["p"], totals["a"], totals["o"])
        card["overall"] = round(max(0.0, raw - card["presence"]["deduction"]), 1)
    return card


# ── One role ─────────────────────────────────────────────────────────────────

def _job(job: models.JobPosting) -> Dict[str, Any]:
    return {
        "title": job.title,
        "description": job.description or "",
        "responsibilities": job.responsibilities or "",
        "required_skills": list(job.required_skills or []),
    }


def fit_roles(db: Session, questions: Sequence[models.InterviewQuestion], meta: Dict[str, dict], candidate: models.User,
              jobs: Sequence[models.JobPosting], performance: float) -> List[Optional[dict]]:
    """The match score for each role, with its four parts.

    None where a role could not be rated. Busy (see is_busy) where Claude said to slow down.
    Interview performance is the interview's own score, the same for every role. How the answers fit
    a role, and how the profile fits it, are each rated like an answer (several times, the middle
    kept) and stored: the same answers against the same posting always give the same relevance, and
    a profile is not read again until it changes.
    """
    # an answer flagged as written for the grader is not shown to the next grader either
    transcript = [
        (q.question_text, "code" if q.question_type == "code" else "verbal",
         "" if (meta.get(str(q.id)) or {}).get("manipulation") else (q.user_answer or ""))
        for q in questions
    ]
    spoken = [{"question": text, "answer": answer} for text, _, answer in transcript]
    any_answer = any(not rubric.is_blank(answer, kind) for _, kind, answer in transcript)
    own_skills = [str(s) for s in (candidate.skills or []) if str(s).strip()]
    resume = (candidate.resume_text or "").strip()

    plans = []
    for job in jobs:
        about = _job(job)
        text = rubric.job_text(about["title"], about["description"], about["responsibilities"], about["required_skills"])
        plans.append({
            "job": about,
            "skills": len(about["required_skills"][: rubric.MAX_SKILLS]),
            "answers_key": rubric.answers_fit_key(text, transcript) if any_answer else None,
            "profile_key": rubric.profile_fit_key(text, own_skills, resume) if (own_skills or resume) else None,
        })

    known = stored(db, [p["answers_key"] for p in plans] + [p["profile_key"] for p in plans])
    tasks = []
    for p in plans:
        if p["answers_key"] and p["answers_key"] not in known:
            tasks.append(("fit-answers", p["answers_key"], p))
        if p["profile_key"] and p["profile_key"] not in known:
            tasks.append(("fit-profile", p["profile_key"], p))
    # two roles with the same posting share a fingerprint: rate it once
    tasks = list({key: (kind, key, p) for kind, key, p in tasks}.values())

    def run(task):
        kind, _, p = task
        if kind == "fit-answers":
            return _safely(claude_client.rate_answers_fit, p["job"], spoken)
        return _safely(claude_client.rate_profile_fit, p["job"], own_skills, resume)

    waiting: Dict[str, _Busy] = {}
    if tasks:
        # the answers are the same whichever role they are held against, and so is the profile:
        # the first call of each kind goes alone so that the others can reuse that part
        said = rubric.answers_fit_key([], transcript)
        about = rubric.profile_fit_key([], own_skills, resume)
        calls = [task for task in tasks for _ in range(SAMPLES)]
        ratings = _run_all(calls, run, lambda task: (said if task[0] == "fit-answers" else about))
        for kind, key, _ in tasks:
            mine = [r for (_, k, _), r in zip(calls, ratings) if k == key]
            combine = rubric.combine_answers_fit if kind == "fit-answers" else rubric.combine_profile_fit
            final = _settled(mine, lambda good, combine=combine: combine(good) if len(good) >= min(2, SAMPLES) else None)
            if is_busy(final):
                waiting[key] = final
            elif final is not None:
                known[key] = keep(db, key, kind, final)

    out: List[Any] = []
    for p in plans:
        if p["answers_key"] is None:
            answers = {"fit": "none", "skills": ["absent"] * p["skills"], "why": "No question was answered."}
        else:
            answers = known.get(p["answers_key"])
        if p["profile_key"] is None:
            profile = {"skills_listed": [], "skills_fit": None, "resume_fit": None, "resume_skills": [], "why": ""}
        else:
            profile = known.get(p["profile_key"])
        if answers is None or profile is None:
            held = [waiting[key] for key in (p["answers_key"], p["profile_key"]) if key in waiting]
            out.append(_Busy(wait_for(held)) if held else None)
            continue
        relevance = rubric.relevance_score(answers["fit"], answers["skills"])
        skills = rubric.skills_score(profile.get("skills_fit"), profile.get("skills_listed") or []) if own_skills else 0.0
        resume_part = rubric.resume_score(profile.get("resume_fit"), profile.get("resume_skills") or []) if resume else 0.0
        why = " ".join(part for part in (answers.get("why"), profile.get("why")) if part)
        out.append({
            "match_score": rubric.composite(performance, relevance, skills, resume_part),
            "interview_performance_score": round(performance, 1),
            "answer_relevance_score": relevance,
            "profile_skills_score": skills,
            "ats_score": resume_part,
            "reasoning": why[:1500],
        })
    return out
