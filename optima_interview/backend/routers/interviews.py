import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from database import get_db
import models
import schemas
import auth as auth_utils
import claude_client
import interview_rules as rules
from question_bank import SUPPORTED_INDUSTRIES, get_roles_for_industry

router = APIRouter(prefix="/interviews", tags=["interviews"])
log = logging.getLogger("optima")

# How many answers (or jobs) are sent to Claude at the same time when an interview is scored.
SCORERS = 4

# Scoring is done in steps that are each saved, so it can stop and carry on:
# one request starts new steps for this long, then reports back, and the page asks again.
# A step under way is finished first (four answers, or four roles), so a request can outlast
# this by one step. On a host that stops requests early, set it to 1: one step a request.
SCORING_BUDGET_SECONDS = float(os.getenv("SCORING_BUDGET_SECONDS", "50"))
# A request that was scoring and has saved nothing for this long is taken to have died.
SCORING_LOCK_SECONDS = 90
# After this many requests that each left something unscored, what can be scored is accepted.
MAX_SCORING_TRIES = 3
# A practice interview is also scored against the open roles in its field (see _match_practice).
# Set MATCH_PRACTICE_INTERVIEWS=0 to skip that and save the calls.
MATCH_PRACTICE = os.getenv("MATCH_PRACTICE_INTERVIEWS", "1").strip().lower() not in ("0", "false", "no", "off")
# The most roles one weekly interview is written from (the most a candidate can save).
MAX_WEEKLY_ROLES = 10

QUESTIONS_FAILED = "The questions could not be written. Nothing was used up: try again in a moment."
SCORING_FAILED = "Scoring could not finish just now. Your answers are saved: try again in a moment."
COULD_NOT_GRADE = "This answer could not be graded, so it is left out of your score."


# ── Helpers ───────────────────────────────────────────────────────────────────

def _questions(db: Session, session_id: int) -> List[models.InterviewQuestion]:
    return (
        db.query(models.InterviewQuestion)
        .filter(models.InterviewQuestion.session_id == session_id)
        .order_by(models.InterviewQuestion.question_order)
        .all()
    )


def _owned(db: Session, session_id: int, user: models.User) -> models.InterviewSession:
    session = db.query(models.InterviewSession).filter(
        models.InterviewSession.id == session_id,
        models.InterviewSession.user_id == user.id,
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Interview session not found")
    return session


def _served(question: models.InterviewQuestion, run: models.InterviewRun, now: datetime) -> schemas.QuestionServed:
    return schemas.QuestionServed(
        id=question.id,
        question_text=question.question_text,
        question_type=question.question_type,
        question_order=question.question_order,
        seconds=rules.seconds_for(question.question_type),
        seconds_left=rules.seconds_left(run.served_at, question.question_type, now),
    )


def _end_early(db: Session, session: models.InterviewSession, run: Optional[models.InterviewRun], reason: str) -> None:
    """Close an interview that was not finished.

    A weekly interview that ends early scores 0 and sends nothing; the week stays used.
    A practice interview is simply marked as left: it has no score.
    """
    if run is not None:
        run.ended_reason = reason
    if run is not None and rules.is_locked(session.session_type):
        session.status = "completed"
        session.overall_score = 0.0
        session.completed_at = datetime.utcnow()
    else:
        session.status = "abandoned"
    db.commit()


def _settle(db: Session, session: models.InterviewSession) -> None:
    """Close an interview whose page has gone away. Called when the candidate next asks for anything."""
    if session.status != "in_progress":
        return
    run = session.run
    now = datetime.utcnow()
    if run is None:
        # started before interviews were tracked: there is nothing to continue
        if now > session.created_at + timedelta(seconds=rules.BEGIN_WITHIN_SECONDS):
            _end_early(db, session, None, "left")
        return
    if not run.begun_at:
        if now > session.created_at + timedelta(seconds=rules.BEGIN_WITHIN_SECONDS):
            _end_early(db, session, run, "not_begun")
        return
    questions = _questions(db, session.id)
    if run.current_order >= len(questions):
        return  # every answer is in; it only needs scoring
    current = questions[run.current_order]
    out_of_time = now > run.served_at + timedelta(
        seconds=rules.seconds_for(current.question_type) + rules.GRACE_SECONDS + 60
    )
    silent = now > (run.last_seen_at or run.begun_at) + timedelta(seconds=rules.SILENT_AFTER_SECONDS)
    if out_of_time or silent:
        _end_early(db, session, run, "left")


def settle_stale(db: Session, user: models.User) -> None:
    open_sessions = (
        db.query(models.InterviewSession)
        .filter(
            models.InterviewSession.user_id == user.id,
            models.InterviewSession.status == "in_progress",
        )
        .all()
    )
    for session in open_sessions:
        _settle(db, session)


def _live_run(session: models.InterviewSession, attempt: Optional[str]) -> models.InterviewRun:
    """The run behind a request from the interview page, or an error saying why it cannot continue."""
    run = session.run
    if session.status != "in_progress":
        raise HTTPException(status_code=410, detail="This interview has ended.")
    if run is None or not run.begun_at:
        raise HTTPException(status_code=409, detail="This interview has not begun.")
    if not attempt or attempt != run.attempt_key:
        raise HTTPException(
            status_code=409,
            detail="This interview is open in another window, or was closed. It cannot be continued here.",
        )
    return run


def _waiting_to_begin(db: Session, user: models.User, session_type: str, payload) -> Optional[models.InterviewSession]:
    """An interview of this kind whose questions are written but which has not begun, if there is one."""
    cutoff = datetime.utcnow() - timedelta(seconds=rules.BEGIN_WITHIN_SECONDS)
    query = db.query(models.InterviewSession).filter(
        models.InterviewSession.user_id == user.id,
        models.InterviewSession.session_type == session_type,
        models.InterviewSession.status == "in_progress",
        models.InterviewSession.created_at >= cutoff,
    )
    if session_type == "mock":
        query = query.filter(
            models.InterviewSession.job_title == payload.job_title,
            models.InterviewSession.industry == payload.industry,
        )
    for session in query.order_by(models.InterviewSession.created_at.desc()).all():
        if session.run is not None and session.run.begun_at is None:
            return session
    return None


def _start_response(session: models.InterviewSession, questions: List[models.InterviewQuestion]) -> schemas.InterviewStartResponse:
    waited = (datetime.utcnow() - session.created_at).total_seconds()
    return schemas.InterviewStartResponse(
        session_id=session.id,
        job_title=session.job_title,
        industry=session.industry,
        session_type=session.session_type,
        question_count=len(questions),
        outline=[
            schemas.OutlineItem(question_order=i, question_type=q.question_type, seconds=rules.seconds_for(q.question_type))
            for i, q in enumerate(questions)
        ],
        rules=schemas.InterviewRules(
            locked=rules.is_locked(session.session_type),
            leaves_allowed=rules.LEAVES_ALLOWED,
            begin_within_seconds=rules.BEGIN_WITHIN_SECONDS,
            grace_seconds=rules.GRACE_SECONDS,
        ),
        begin_seconds_left=max(0, int(rules.BEGIN_WITHIN_SECONDS - waited)),
    )


def _results(session: models.InterviewSession, questions: List[models.InterviewQuestion]) -> schemas.InterviewResultResponse:
    run = session.run
    meta = (run.answers_meta or {}) if run else {}
    awaiting = bool(
        session.status == "in_progress" and run and run.begun_at and questions and run.current_order >= len(questions)
    )
    shown = []
    # Until an interview is over, its questions and the points they look for are not handed out.
    for question in questions if session.status != "in_progress" else []:
        result = schemas.QuestionResult.model_validate(question)
        about = meta.get(str(question.id)) or {}
        result.seconds = about.get("seconds")
        result.late = bool(about.get("late"))
        result.flagged = "manipulation" if about.get("manipulation") else "unexplained" if about.get("unexplained") else None
        shown.append(result)
    return schemas.InterviewResultResponse(
        session_id=session.id,
        job_title=session.job_title,
        industry=session.industry,
        session_type=session.session_type,
        overall_score=session.overall_score,
        status=session.status,
        created_at=session.created_at,
        completed_at=session.completed_at,
        questions=shown,
        ended_reason=run.ended_reason if run else None,
        awaiting_scoring=awaiting,
        fair_play=rules.fair_play_summary(run, session.session_type),
        delivery=run.delivery if run and session.session_type == "mock" else None,
    )


@router.get("/can-connect", response_model=schemas.ConnectAvailability)
def can_connect(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth_utils.require_candidate),
):
    """Check if the candidate can start a new connecting interview (1 per 7 days)."""
    settle_stale(db, current_user)
    cutoff = datetime.utcnow() - timedelta(days=7)
    recent = (
        db.query(models.InterviewSession)
        .filter(
            models.InterviewSession.user_id == current_user.id,
            models.InterviewSession.session_type == "connecting",
            models.InterviewSession.created_at >= cutoff,
        )
        .order_by(models.InterviewSession.created_at.desc())
        .first()
    )
    if recent:
        next_available = (recent.created_at + timedelta(days=7)).isoformat()
        return schemas.ConnectAvailability(can_connect=False, next_available=next_available)
    return schemas.ConnectAvailability(can_connect=True)


@router.get("/roles", response_model=List[str])
def list_roles_for_industry(industry: str = Query(...)):
    """Return up to 10 job titles for the given industry (used for mock interview setup)."""
    return get_roles_for_industry(industry)


@router.get("/industries", response_model=List[str])
def list_industries():
    return SUPPORTED_INDUSTRIES


@router.post("/start", response_model=schemas.InterviewStartResponse, status_code=status.HTTP_201_CREATED)
def start_interview(
    payload: schemas.InterviewStart,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth_utils.require_candidate),
):
    """Write the questions for an interview. None is shown until the candidate presses Begin."""
    session_type = payload.session_type or "mock"
    settle_stale(db, current_user)

    # Questions already written and Begin not yet pressed (the page was reloaded, say): hand the same
    # interview back instead of using up another one.
    waiting = _waiting_to_begin(db, current_user, session_type, payload)
    if waiting is not None:
        return _start_response(waiting, _questions(db, waiting.id))

    if session_type == "mock":
        # Enforce 3-per-day limit
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        mock_today = (
            db.query(models.InterviewSession)
            .filter(
                models.InterviewSession.user_id == current_user.id,
                models.InterviewSession.session_type == "mock",
                models.InterviewSession.created_at >= today_start,
            )
            .count()
        )
        if mock_today >= 3:
            raise HTTPException(
                status_code=429,
                detail="Daily mock interview limit reached (3 per day). Try again tomorrow.",
            )

    if session_type == "connecting":
        # Enforce 1-per-7-days limit
        cutoff = datetime.utcnow() - timedelta(days=7)
        recent = (
            db.query(models.InterviewSession)
            .filter(
                models.InterviewSession.user_id == current_user.id,
                models.InterviewSession.session_type == "connecting",
                models.InterviewSession.created_at >= cutoff,
            )
            .first()
        )
        if recent:
            next_available = (recent.created_at + timedelta(days=7)).isoformat()
            raise HTTPException(
                status_code=429,
                detail=f"Connecting interview limit reached. Next available: {next_available}",
            )

        # Fetch favourited jobs: each id once, and only roles this candidate has saved
        wanted = list(dict.fromkeys(payload.favourite_job_ids or []))[:MAX_WEEKLY_ROLES]
        if not wanted:
            raise HTTPException(status_code=400, detail="No favourite jobs provided for connecting interview")

        saved = {
            favourite.job_id
            for favourite in db.query(models.Favourite).filter(
                models.Favourite.candidate_user_id == current_user.id,
                models.Favourite.job_id.in_(wanted),
            )
        }
        favourite_jobs = (
            db.query(models.JobPosting)
            .filter(
                models.JobPosting.id.in_([job_id for job_id in wanted if job_id in saved]),
                models.JobPosting.is_active == True,
            )
            .all()
        )
        if not favourite_jobs:
            raise HTTPException(status_code=400, detail="No active jobs found in your favourites")
        favourite_jobs.sort(key=lambda job: wanted.index(job.id))

        # Build job dicts for Claude
        jobs_data = [
            {
                "title": j.title,
                "description": j.description,
                "required_skills": j.required_skills or [],
                "specific_questions": j.specific_questions or [],
                "company_name": j.company.name if j.company else "",
            }
            for j in favourite_jobs
        ]
        candidate_profile = {
            "skills": current_user.skills or [],
            "desired_roles": current_user.desired_roles or [],
        }

        try:
            questions_data = claude_client.generate_connecting_questions(jobs_data, candidate_profile)
        except Exception:
            log.exception("Writing the questions for a weekly interview failed")
            raise HTTPException(status_code=502, detail=QUESTIONS_FAILED)

        # For connecting sessions, store a representative job title and industry
        job_title = ", ".join(dict.fromkeys(j.title for j in favourite_jobs[:3]))
        industry = favourite_jobs[0].industry
        connecting_week = datetime.utcnow().strftime("%Y-W%V")

    else:  # mock
        try:
            questions_data = claude_client.generate_mock_questions(payload.job_title, payload.industry)
        except Exception:
            log.exception("Writing the questions for a practice interview failed")
            raise HTTPException(status_code=502, detail=QUESTIONS_FAILED)

        job_title = payload.job_title
        industry = payload.industry
        connecting_week = None

    # Create session
    session = models.InterviewSession(
        user_id=current_user.id,
        job_title=job_title,
        industry=industry,
        status="in_progress",
        session_type=session_type,
        connecting_week=connecting_week,
    )
    db.add(session)
    db.flush()

    # Persist questions
    db_questions = []
    for i, q in enumerate(questions_data):
        question = models.InterviewQuestion(
            session_id=session.id,
            question_text=q["question_text"],
            question_type=q["question_type"],
            key_points=q["key_points"],
            question_order=i,
        )
        db.add(question)
        db_questions.append(question)

    db.add(models.InterviewRun(session_id=session.id, current_order=0, strikes=0, events=[], answers_meta={}))
    db.commit()
    db.refresh(session)

    return _start_response(session, db_questions)


@router.post("/{session_id}/begin", response_model=schemas.InterviewBeginResponse)
def begin_interview(
    session_id: int,
    payload: schemas.InterviewBegin,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth_utils.require_candidate),
):
    """Show the first question and start its clock. Only the page that begins can continue."""
    session = _owned(db, session_id, current_user)
    _settle(db, session)
    if session.status != "in_progress":
        raise HTTPException(status_code=410, detail="This interview has ended.")
    run = session.run
    if run is None:
        raise HTTPException(status_code=410, detail="This interview can no longer be taken.")
    questions = _questions(db, session_id)
    if not questions:
        raise HTTPException(status_code=409, detail="This interview has no questions.")
    now = datetime.utcnow()

    if run.begun_at:
        # the same page asking again (its first request was lost on the way back) gets the same answer
        if payload.attempt == run.attempt_key and run.current_order < len(questions):
            return schemas.InterviewBeginResponse(
                question=_served(questions[run.current_order], run, now), question_count=len(questions)
            )
        raise HTTPException(
            status_code=409,
            detail="This interview is open in another window, or was closed. It cannot be opened twice.",
        )

    run.attempt_key = payload.attempt
    run.begun_at = now
    run.last_seen_at = now
    run.current_order = 0
    run.served_at = now
    db.commit()
    return schemas.InterviewBeginResponse(question=_served(questions[0], run, now), question_count=len(questions))


@router.post("/{session_id}/answer", response_model=schemas.AnswerResponse)
def answer_question(
    session_id: int,
    payload: schemas.AnswerIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth_utils.require_candidate),
):
    """Take the answer to the question being asked, then show the next one."""
    session = _owned(db, session_id, current_user)
    run = _live_run(session, payload.attempt)
    questions = _questions(db, session_id)
    now = datetime.utcnow()

    def reply(late: bool = False) -> schemas.AnswerResponse:
        following = questions[run.current_order] if run.current_order < len(questions) else None
        return schemas.AnswerResponse(
            next=_served(following, run, now) if following else None, answered=run.current_order, late=late
        )

    current = questions[run.current_order] if run.current_order < len(questions) else None
    if current is None or payload.question_id != current.id:
        # the answer just taken, sent again because its reply was lost: say the same thing, move nothing
        previous = questions[run.current_order - 1] if 0 < run.current_order <= len(questions) else None
        if previous is not None and payload.question_id == previous.id:
            return reply(late=bool((run.answers_meta or {}).get(str(previous.id), {}).get("late")))
        raise HTTPException(status_code=409, detail="That is not the question being asked.")

    late = rules.clock_ran_out(run.served_at, current.question_type, now)
    answer = "" if late else (payload.answer or "")[: rules.MAX_ANSWER_CHARS]
    signals = rules.clean_signals(payload.signals)
    about = {"seconds": int((now - run.served_at).total_seconds()), "late": late, **signals}
    if rules.unexplained_text(answer, signals):
        about["unexplained"] = True

    current.user_answer = answer
    run.answers_meta = {**(run.answers_meta or {}), str(current.id): about}
    run.current_order = run.current_order + 1
    run.served_at = now
    run.last_seen_at = now
    db.commit()
    return reply(late=late)


@router.post("/{session_id}/event", response_model=schemas.EventResponse)
def record_event(
    session_id: int,
    payload: schemas.EventIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth_utils.require_candidate),
):
    """Note that the candidate left the interview window, came back, or tried to paste."""
    session = _owned(db, session_id, current_user)
    run = _live_run(session, payload.attempt)
    if payload.type not in ("left", "returned", "paste"):
        raise HTTPException(status_code=400, detail="Unknown event type")
    now = datetime.utcnow()

    events = list(run.events or [])
    if len(events) < rules.MAX_EVENTS:
        event = {"type": payload.type, "at": now.isoformat(), "q": run.current_order}
        if payload.how in ("hidden", "blur", "fullscreen"):
            event["how"] = payload.how
        if payload.ms is not None and payload.ms >= 0:
            event["ms"] = int(min(payload.ms, 4 * 3600 * 1000))
        events.append(event)
        run.events = events
    run.last_seen_at = now

    if payload.type == "left" and rules.is_locked(session.session_type):
        run.strikes = (run.strikes or 0) + 1
        if run.strikes > rules.LEAVES_ALLOWED:
            _end_early(db, session, run, "strikes")
    db.commit()
    return schemas.EventResponse(
        left_count=run.strikes or 0,
        leaves_allowed=rules.LEAVES_ALLOWED,
        ended=session.status != "in_progress",
        ended_reason=run.ended_reason,
    )


@router.post("/{session_id}/ping", response_model=schemas.PingResponse)
def check_in(
    session_id: int,
    payload: schemas.PingIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth_utils.require_candidate),
):
    """The interview page says it is still open. The reply carries the server's clock."""
    session = _owned(db, session_id, current_user)
    run = session.run
    if session.status != "in_progress":
        return schemas.PingResponse(ended=True, ended_reason=run.ended_reason if run else None)
    run = _live_run(session, payload.attempt)
    now = datetime.utcnow()
    run.last_seen_at = now
    db.commit()
    questions = _questions(db, session_id)
    current = questions[run.current_order] if run.current_order < len(questions) else None
    return schemas.PingResponse(
        ended=False,
        seconds_left=rules.seconds_left(run.served_at, current.question_type, now) if current else None,
    )


def _abandon(db: Session, session_id: int, user: models.User):
    session = _owned(db, session_id, user)
    run = session.run
    if session.status == "in_progress":
        questions = _questions(db, session_id)
        every_answer_in = bool(run and run.begun_at and questions and run.current_order >= len(questions))
        if not every_answer_in:  # once every answer is in, closing the page costs nothing: scoring carries on
            _end_early(db, session, run, "left")
    return {"status": session.status, "ended_reason": run.ended_reason if run else None}


@router.post("/{session_id}/abandon")
def abandon_interview(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth_utils.require_candidate),
):
    """The candidate chose to leave. A weekly interview left part-way scores 0."""
    return _abandon(db, session_id, current_user)


@router.post("/{session_id}/closed")
async def page_closed(session_id: int, request: Request, db: Session = Depends(get_db)):
    """Sent by the browser as the interview page closes or reloads.

    A closing page can only send a plain body, with no headers of its own, so the sign-in token
    arrives as the body instead of in the Authorization header.
    """
    token = (await request.body()).decode("utf-8", "ignore").strip()[:4096]
    payload = auth_utils.decode_token(token)
    user = db.query(models.User).filter(models.User.id == int(payload["sub"])).first()
    if not user or user.role != "candidate":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    return _abandon(db, session_id, user)


def _safely(call, *args, **kwargs):
    try:
        return call(*args, **kwargs)
    except Exception:
        return None


def _batches(items: list, size: int):
    for at in range(0, len(items), size):
        yield items[at:at + size]


def _needs_grader(question: models.InterviewQuestion) -> bool:
    """False for an answer that is empty or a word or two: it scores 0 without being sent anywhere."""
    return len((question.user_answer or "").strip()) >= 10


def _grade_answers(db: Session, session: models.InterviewSession, run: models.InterviewRun,
                   questions: List[models.InterviewQuestion], deadline: float) -> bool:
    """Grade every answer that has no score yet, a few at a time, saving after each few.

    True when all of them are graded. False when the time allowed ran out first.
    Raises 502 when the grader failed, unless enough tries have been made to accept what there is.
    """
    meta = dict(run.answers_meta or {})
    failed = 0
    for batch in _batches([q for q in questions if q.score is None], SCORERS):
        if time.monotonic() >= deadline:
            break
        # only plain values cross into the worker threads
        work = [(q.question_text, q.question_type, list(q.key_points or []), q.user_answer or "") for q in batch]
        with ThreadPoolExecutor(max_workers=SCORERS) as pool:
            graded = list(pool.map(lambda args: _safely(claude_client.grade_answer, *args), work))
        for question, result in zip(batch, graded):
            if result is None:
                failed += 1
                continue
            if result.get("manipulation"):
                # text written for the grader, not for the question: it earns nothing and goes on the record
                result = {
                    "score": 0.0,
                    "feedback": "This answer contained instructions aimed at the grader, so it scored 0.",
                    "key_points_hit": [],
                }
                meta[str(question.id)] = {**(meta.get(str(question.id)) or {}), "manipulation": True}
            question.score = result["score"]
            question.feedback = result["feedback"]
            question.key_points_hit = result["key_points_hit"]
        run.answers_meta = meta
        run.finishing_at = datetime.utcnow()  # still at work
        db.commit()

    ungraded = [q for q in questions if q.score is None]
    if ungraded and not failed:
        return False  # nothing went wrong: there is simply more to do

    if ungraded:
        run.scoring_tries = (run.scoring_tries or 0) + 1
        graded_by_model = any(q.score is not None and _needs_grader(q) for q in questions)
        # Try again later rather than close an interview on answers nobody graded. Only once
        # several tries have failed, and at least one answer was graded, is the rest let go.
        if run.scoring_tries < MAX_SCORING_TRIES or not graded_by_model:
            db.commit()
            raise HTTPException(status_code=502, detail=SCORING_FAILED)
        for question in ungraded:
            question.score = 0.0
            question.feedback = COULD_NOT_GRADE
            question.key_points_hit = []
            meta[str(question.id)] = {**(meta.get(str(question.id)) or {}), "ungraded": True}
        run.answers_meta = meta

    counted = [q.score for q in questions if not (meta.get(str(q.id)) or {}).get("ungraded")]
    session.overall_score = round(sum(counted) / len(counted), 1) if counted else 0.0
    db.commit()
    return True


@router.post("/{session_id}/finish", response_model=schemas.InterviewResultResponse)
def finish_interview(
    session_id: int,
    payload: schemas.FinishIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth_utils.require_candidate),
):
    """Score an interview once every question has been answered or skipped.

    Scoring is saved as it goes. If it cannot finish in one request the reply says so
    (awaiting_scoring) and the page asks again; nothing already scored is scored twice.
    If the grader is failing the reply is a 502 and the interview stays open to be scored later:
    it is never closed on a score that nobody worked out.
    """
    session = _owned(db, session_id, current_user)
    questions = _questions(db, session_id)
    if session.status == "completed":
        return _results(session, questions)  # asked twice: the same result, nothing scored again
    if session.status != "in_progress":
        raise HTTPException(status_code=410, detail="This interview has ended.")

    run = session.run
    if run is None or not run.begun_at or run.current_order < len(questions):
        _live_run(session, payload.attempt)
        raise HTTPException(status_code=409, detail="There are questions left to answer.")
    # Every answer is already in, so the candidate may ask for scoring from any page
    # (for example after the connection dropped while the first request was running).

    # One request scores at a time. The claim is a single UPDATE, so of two requests that arrive
    # together only one can make it.
    now = datetime.utcnow()
    claimed = (
        db.query(models.InterviewRun)
        .filter(
            models.InterviewRun.session_id == session.id,
            or_(
                models.InterviewRun.finishing_at.is_(None),
                models.InterviewRun.finishing_at < now - timedelta(seconds=SCORING_LOCK_SECONDS),
            ),
        )
        .update({"finishing_at": now}, synchronize_session=False)
    )
    db.commit()
    if not claimed:
        raise HTTPException(status_code=409, detail="This interview is being scored.")

    budget = SCORING_BUDGET_SECONDS
    if payload.budget_seconds is not None:
        budget = min(budget, max(1.0, payload.budget_seconds))
    deadline = time.monotonic() + budget

    try:
        db.refresh(run)
        if session.session_type == "mock" and payload.delivery is not None:
            run.delivery = rules.clean_delivery(payload.delivery)
            db.commit()

        if _grade_answers(db, session, run, questions, deadline):
            if session.session_type == "connecting":
                # the week is only spent, and the applications only count, once every role is scored
                if _match_weekly(db, session, run, current_user, questions, deadline):
                    session.status = "completed"
                    session.completed_at = datetime.utcnow()
                    db.commit()
            else:
                session.status = "completed"
                session.completed_at = datetime.utcnow()
                db.commit()
                if MATCH_PRACTICE:
                    _match_practice(db, session, run, current_user, questions, deadline)
    finally:
        # however this request ended, the next one may start at once
        try:
            db.rollback()
            db.query(models.InterviewRun).filter(models.InterviewRun.session_id == session_id).update(
                {"finishing_at": None}, synchronize_session=False
            )
            db.commit()
        except Exception:
            db.rollback()

    db.refresh(session)
    return _results(session, _questions(db, session_id))


@router.post("/{session_id}/submit", status_code=status.HTTP_410_GONE)
def submit_interview(session_id: int):
    """Answers used to be sent all at once at the end. They are now sent one question at a time."""
    raise HTTPException(
        status_code=410,
        detail="This version of Optima takes one answer at a time. Reload the page to get the current version.",
    )


def _open_roles(db: Session, session: models.InterviewSession, done: set) -> List[models.JobPosting]:
    """The open roles in the interview's field that it has not been scored against yet."""
    jobs = (
        db.query(models.JobPosting)
        .filter(
            models.JobPosting.industry == session.industry,
            models.JobPosting.is_active == True,
        )
        .order_by(models.JobPosting.id)
        .all()
    )
    return [job for job in jobs if job.id not in done]


def _score_roles(session: models.InterviewSession, candidate: models.User,
                 questions: List[models.InterviewQuestion], jobs: List[models.JobPosting]) -> list:
    """Score the interview against a few roles at the same time. None where scoring a role failed."""
    qa_pairs = [{"question": q.question_text, "answer": q.user_answer or ""} for q in questions]
    shared = dict(
        candidate_job_title=session.job_title,
        candidate_industry=session.industry,
        qa_pairs=qa_pairs,
        candidate_skills=list(candidate.skills or []),
        candidate_resume=candidate.resume_text,
        session_type=session.session_type,
    )
    work = [
        dict(
            job_title=job.title,
            job_description=job.description,
            required_skills=list(job.required_skills or []),
            job_responsibilities=job.responsibilities,
            **shared,
        )
        for job in jobs
    ]
    with ThreadPoolExecutor(max_workers=SCORERS) as pool:
        return list(pool.map(lambda kwargs: _safely(claude_client.score_candidate_job_match, **kwargs), work))


def _parts(session: models.InterviewSession, result):
    """(match_score, reasoning, performance, relevance, skills, resume) with the fallback used when scoring failed."""
    if result is None:
        return session.overall_score or 0.0, "Match score based on overall interview performance.", None, None, None, None
    return (
        result["match_score"],
        result["reasoning"],
        result.get("interview_performance_score"),
        result.get("answer_relevance_score"),
        result.get("profile_skills_score"),
        result.get("ats_score"),
    )


def _keep_match(db: Session, session: models.InterviewSession, candidate: models.User, job: models.JobPosting, result) -> None:
    match_score, reasoning, ip_score, ar_score, ps_score, ats = _parts(session, result)

    existing = db.query(models.Match).filter(
        models.Match.job_id == job.id,
        models.Match.candidate_user_id == candidate.id,
    ).first()

    if existing:
        if match_score > existing.match_score:
            existing.match_score = match_score
            existing.reasoning = reasoning
            existing.session_id = session.id
            existing.interview_performance_score = ip_score
            existing.answer_relevance_score = ar_score
            existing.profile_skills_score = ps_score
            existing.ats_score = ats
    else:
        db.add(models.Match(
            job_id=job.id,
            candidate_user_id=candidate.id,
            session_id=session.id,
            match_score=match_score,
            reasoning=reasoning,
            interview_performance_score=ip_score,
            answer_relevance_score=ar_score,
            profile_skills_score=ps_score,
            ats_score=ats,
        ))


def _keep_application(db: Session, session: models.InterviewSession, candidate: models.User, job: models.JobPosting, result) -> None:
    match_score, reasoning, ip_score, ar_score, ps_score, ats = _parts(session, result)

    # Only create application if score warrants it (>= 40%)
    if match_score < 40:
        return

    existing = (
        db.query(models.Application)
        .filter(
            models.Application.job_id == job.id,
            models.Application.candidate_user_id == candidate.id,
        )
        .first()
    )

    if existing:
        if match_score > existing.match_score:
            existing.match_score = match_score
            existing.reasoning = reasoning
            existing.session_id = session.id
            existing.interview_performance_score = ip_score
            existing.answer_relevance_score = ar_score
            existing.profile_skills_score = ps_score
            existing.ats_score = ats
            if existing.status == "withdrawn":
                existing.status = "applied"
    else:
        db.add(models.Application(
            candidate_user_id=candidate.id,
            job_id=job.id,
            session_id=session.id,
            match_score=match_score,
            reasoning=reasoning,
            interview_performance_score=ip_score,
            answer_relevance_score=ar_score,
            profile_skills_score=ps_score,
            ats_score=ats,
        ))


def _match_practice(db: Session, session: models.InterviewSession, run: models.InterviewRun, candidate: models.User,
                    questions: List[models.InterviewQuestion], deadline: float) -> None:
    """For mock interviews: match against active jobs in the same industry (the 4-component scoring).

    The interview is already complete when this runs, and no page waits on these records, so it
    does what fits in the time left and stops.
    """
    for batch in _batches(_open_roles(db, session, set()), SCORERS):
        if time.monotonic() >= deadline:
            break
        for job, result in zip(batch, _score_roles(session, candidate, questions, batch)):
            _keep_match(db, session, candidate, job, result)
        run.finishing_at = datetime.utcnow()
        db.commit()


def _match_weekly(db: Session, session: models.InterviewSession, run: models.InterviewRun, candidate: models.User,
                  questions: List[models.InterviewQuestion], deadline: float) -> bool:
    """For connecting interviews: score against all active jobs in the same industry
    and create Application records for matches scoring >= 40.

    Saved after every few roles, with a note of which roles are done, so a request that stops
    part-way loses nothing and the next one does not score a role twice.
    True when every role is done. False when the time allowed ran out first.
    Raises 502 when scoring a role failed, until enough tries have been made to fall back.
    """
    done = set(run.matched_jobs or [])
    last_try = (run.scoring_tries or 0) >= MAX_SCORING_TRIES - 1
    failed = 0
    jobs = _open_roles(db, session, done)
    for batch in _batches(jobs, SCORERS):
        if time.monotonic() >= deadline:
            break
        for job, result in zip(batch, _score_roles(session, candidate, questions, batch)):
            if result is None and not last_try:
                failed += 1
                continue
            _keep_application(db, session, candidate, job, result)
            done.add(job.id)
        run.matched_jobs = sorted(done)
        run.finishing_at = datetime.utcnow()
        db.commit()

    if all(job.id in done for job in jobs):
        return True
    if failed:
        run.scoring_tries = (run.scoring_tries or 0) + 1
        db.commit()
        raise HTTPException(status_code=502, detail=SCORING_FAILED)
    return False


@router.get("/{session_id}/results", response_model=schemas.InterviewResultResponse)
def get_results(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth_utils.get_current_user),
):
    session = db.query(models.InterviewSession).filter(
        models.InterviewSession.id == session_id,
    ).first()

    if not session:
        raise HTTPException(status_code=404, detail="Interview session not found")

    if current_user.role == "candidate":
        if session.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Access denied")
        _settle(db, session)
    else:
        # A company may read an interview only when it led to an application for one of its roles.
        applied = (
            db.query(models.Application)
            .join(models.JobPosting, models.Application.job_id == models.JobPosting.id)
            .filter(
                models.Application.session_id == session_id,
                models.Application.status != "withdrawn",
                models.JobPosting.company_user_id == current_user.id,
            )
            .first()
        )
        if not applied:
            raise HTTPException(status_code=403, detail="Access denied")

    return _results(session, _questions(db, session_id))


@router.get("/", response_model=List[schemas.SessionSummary])
def list_my_sessions(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth_utils.require_candidate),
):
    settle_stale(db, current_user)
    sessions = (
        db.query(models.InterviewSession)
        .filter(models.InterviewSession.user_id == current_user.id)
        .order_by(models.InterviewSession.created_at.desc())
        .all()
    )
    summaries = []
    for session in sessions:
        summary = schemas.SessionSummary.model_validate(session)
        run = session.run
        summary.ended_reason = run.ended_reason if run else None
        summary.awaiting_scoring = bool(
            session.status == "in_progress" and run and run.begun_at and run.current_order >= len(session.questions) > 0
        )
        summary.delivery = rules.delivery_headline(run.delivery) if run and session.session_type == "mock" else None
        summaries.append(summary)
    return summaries
