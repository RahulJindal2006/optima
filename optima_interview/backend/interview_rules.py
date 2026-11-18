"""How an interview runs: the clock, leaving, and what is kept on record.

Everything in this file is decided on the server. The page shows the same
numbers, but it cannot change them: questions are handed out one at a time,
each with its own clock, and an interview that is closed part-way is over.
"""
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import rubric

# Each question carries its own time limit (rubric.SECONDS: two minutes for a general question,
# two and a half for one about the role, five for a long one, six for code). These two are only
# for interviews written before questions carried a limit.
VERBAL_SECONDS = rubric.SECONDS["role"]
CODE_SECONDS = rubric.SECONDS["code"]
LONGEST_SECONDS = max(rubric.SECONDS.values())
GRACE_SECONDS = rubric.GRACE_SECONDS   # room for a slow connection when an answer is sent at the buzzer
BEGIN_WITHIN_SECONDS = 15 * 60  # questions are written, the candidate has this long to press Begin
SILENT_AFTER_SECONDS = 75       # the page checks in every 20 seconds; this long without a word means it is gone
LEAVES_ALLOWED = 2              # the third time a candidate leaves the window ends a weekly interview
MAX_EVENTS = 200
MAX_ANSWER_CHARS = 20000

ENDED_REASONS = ("left", "strikes", "not_begun")


def seconds_for(question) -> int:
    """The time one question is given. `question` is an InterviewQuestion."""
    return int(question.seconds or (CODE_SECONDS if question.question_type == "code" else VERBAL_SECONDS))


def is_locked(session_type: str) -> bool:
    """Only the weekly interview counts towards applications, so only it is locked down."""
    return session_type == "connecting"


def seconds_left(served_at: Optional[datetime], question, now: datetime) -> int:
    if not served_at:
        return seconds_for(question)
    return max(0, int(seconds_for(question) - (now - served_at).total_seconds()))


def clock_ran_out(served_at: datetime, question, now: datetime) -> bool:
    return now > served_at + timedelta(seconds=seconds_for(question) + GRACE_SECONDS)


# ── What the page reports about one answer ───────────────────────────────────

# What the camera saw while one question was being answered, in seconds. Worked out in the
# candidate's browser from the picture, which itself never leaves it.
#   w  the camera was being read      p  a face was in the picture
#   a  the face was turned away from the screen      o  a second face was in the picture
_CAM = ("w", "p", "a", "o")


def _seconds(value: Any, top: float) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value != value or value < 0:
        return None
    return round(min(float(value), top), 1)


def clean_signals(raw: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """What the page sends with an answer: characters typed and dictated, paste attempts, what the
    camera saw, and how long the microphone heard a voice."""
    out: Dict[str, Any] = {}
    if not isinstance(raw, dict):
        return out
    for key in ("typed", "dictated", "pastes"):
        value = raw.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0:
            out[key] = int(min(value, 1_000_000))
    top = LONGEST_SECONDS + GRACE_SECONDS + 60
    cam = raw.get("cam")
    if isinstance(cam, dict):
        seen = {key: _seconds(cam.get(key), top) for key in _CAM}
        if seen["w"] is not None:
            out["cam"] = {key: value or 0.0 for key, value in seen.items()}
    talk = _seconds(raw.get("talk"), top)
    if talk is not None:
        out["talk"] = talk
    return out


def voice_mismatch(signals: Dict[str, Any]) -> bool:
    """True when far more text was dictated than the microphone heard a voice for.

    Nobody speaks faster than about five words a second. Text that arrives through dictation with
    almost no voice behind it did not come from someone speaking into this microphone.
    """
    talk = signals.get("talk")
    dictated = signals.get("dictated", 0)
    if talk is None or dictated < 240:      # about forty words: less than that proves nothing
        return False
    words = dictated / 6.0                  # a word and its space
    return words > 5.0 * max(talk, 1.0) + 10


def unexplained_text(answer: str, signals: Dict[str, int]) -> bool:
    """True when most of an answer arrived without being typed or dictated in the page."""
    if not signals or "typed" not in signals:
        return False
    length = len(answer or "")
    explained = signals.get("typed", 0) + signals.get("dictated", 0)
    missing = length - explained
    return length >= 80 and missing > 40 and missing > 0.3 * length


# ── The fair-play record ─────────────────────────────────────────────────────

def fair_play_summary(run, session_type: str) -> Optional[Dict[str, Any]]:
    """A short account of how the interview was taken, for the candidate and for a company.

    None means there is no record: the interview was taken before these checks existed.
    """
    if run is None or not is_locked(session_type):
        return None
    events = run.events or []
    meta = run.answers_meta or {}
    left = [e for e in events if e.get("type") == "left"]
    away_ms = sum(int(e.get("ms") or 0) for e in events if e.get("type") == "returned")
    pastes = len([e for e in events if e.get("type") == "paste"])
    late = len([m for m in meta.values() if m.get("late")])
    manipulation = len([m for m in meta.values() if m.get("manipulation")])
    unexplained = len([m for m in meta.values() if m.get("unexplained")])
    mismatch = len([m for m in meta.values() if m.get("voice_mismatch")])
    # what the camera saw: only on interviews taken since the camera became part of the weekly interview
    presence = (run.scorecard or {}).get("presence") if isinstance(run.scorecard, dict) else None
    camera = None
    if presence and presence.get("seconds"):
        camera = {
            "off_camera": presence.get("off_camera"),
            "looking_away": presence.get("looking_away"),
            "second_person_seconds": presence.get("second_person_seconds") or 0,
            "deduction": presence.get("deduction") or 0,
            "lines": presence.get("lines") or [],
        }
    flagged_camera = bool(camera and camera["lines"])
    return {
        "left_count": len(left),
        "leaves_allowed": LEAVES_ALLOWED,
        "away_seconds": round(away_ms / 1000),
        "paste_attempts": pastes,
        "late_answers": late,
        "manipulation_answers": manipulation,
        "unexplained_answers": unexplained,
        "voice_mismatch_answers": mismatch,
        "camera": camera,
        "ended_reason": run.ended_reason,
        "clean": not (left or pastes or late or manipulation or unexplained or mismatch or flagged_camera or run.ended_reason),
    }


# ── What the coach measured ──────────────────────────────────────────────────
# Numbers and a few fixed labels, worked out in the candidate's browser. No picture, no sound and
# none of the candidate's words are ever sent: the only words here are which of a fixed list of
# filler words came up most. Shown to the candidate only, never to a company.

_SHARES = ("in_frame", "eye_contact", "eye_speaking", "posture", "centred", "distance", "steady", "off_screen")
_COUNTS = {"seconds": 4 * 3600, "watched_seconds": 4 * 3600, "look_aways": 999, "longest_away": 3600, "others_seconds": 4 * 3600}
_LIGHT = ("good", "dim", "backlit")
_DISTANCE = ("good", "close", "far")
_AWAY = ("side", "down", "up")

_VOICE_COUNTS = {
    "talk": 4 * 3600, "words": 60_000, "pace": 400, "fillers": 5000, "hedges": 5000,
    "long_pauses": 999, "longest_pause": 600, "longest_answer": LONGEST_SECONDS + GRACE_SECONDS,
    "filler_top_count": 5000, "hedge_top_count": 5000,
}
_VOICE_LEVEL = ("good", "faint", "loud", "noisy")
_VOICE_HEARD = ("microphone", "words")
_FILLERS = ("um", "uh", "like", "you know", "i mean", "basically", "literally", "actually",
            "or something", "or whatever", "and stuff", "yeah")
_HEDGES = ("i think", "i guess", "i suppose", "i feel like", "maybe", "kind of", "sort of", "not sure",
           "a little bit", "hopefully", "pretty much", "more or less", "to be honest", "if that makes sense",
           "i would say")


def _share(value: Any) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return round(min(1.0, max(0.0, float(value))), 3)


def _count(value: Any, top: int) -> Optional[int]:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value != value or value < 0:
        return None
    return int(min(value, top))


def _amount(value: Any, low: float, high: float, places: int = 1) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value != value:
        return None
    return round(min(high, max(low, float(value))), places)


def _clean_voice(raw: Any) -> Optional[Dict[str, Any]]:
    """How the candidate sounded: pace, pauses, how far the pitch moved, level, filler words."""
    if not isinstance(raw, dict):
        return None
    out: Dict[str, Any] = {}
    for key, top in _VOICE_COUNTS.items():
        value = _count(raw.get(key), top)
        if value is not None:
            out[key] = value
    for key, high in (("filler_rate", 60.0), ("range", 24.0)):
        value = _amount(raw.get(key), 0.0, high)
        if value is not None:
            out[key] = value
    for key, allowed in (("level", _VOICE_LEVEL), ("heard", _VOICE_HEARD), ("filler_top", _FILLERS), ("hedge_top", _HEDGES)):
        if raw.get(key) in allowed:
            out[key] = raw[key]
    return out or None


def clean_delivery(raw: Any) -> Optional[Dict[str, Any]]:
    """Keep only the numbers the coach is meant to send. No pictures or sound are ever sent or stored."""
    if not isinstance(raw, dict):
        return None
    out: Dict[str, Any] = {}
    for key in _SHARES:
        share = _share(raw.get(key))
        if share is not None:
            out[key] = share
    for key, top in _COUNTS.items():
        value = _count(raw.get(key), top)
        if value is not None:
            out[key] = value
    if raw.get("light") in _LIGHT:
        out["light"] = raw["light"]
    if raw.get("distance_mostly") in _DISTANCE:
        out["distance_mostly"] = raw["distance_mostly"]
    if raw.get("away_mostly") in _AWAY:
        out["away_mostly"] = raw["away_mostly"]
    drift = _amount(raw.get("drift"), -3.0, 3.0, places=2)
    if drift is not None:
        out["drift"] = drift
    voice = _clean_voice(raw.get("voice"))
    if voice:
        out["voice"] = voice
    per_question: List[Dict[str, Any]] = []
    rows = raw.get("per_question")
    for item in (rows if isinstance(rows, list) else [])[:24]:
        if not isinstance(item, dict):
            continue
        row: Dict[str, Any] = {}
        for key in ("eye_contact", "eye_speaking", "posture", "in_frame"):
            share = _share(item.get(key))
            if share is not None:
                row[key] = share
        for key, top in (("seconds", LONGEST_SECONDS + GRACE_SECONDS), ("talk", LONGEST_SECONDS + GRACE_SECONDS), ("pace", 400), ("fillers", 5000)):
            value = _count(item.get(key), top)
            if value is not None:
                row[key] = value
        spread = _amount(item.get("range"), 0.0, 24.0)
        if spread is not None:
            row["range"] = spread
        per_question.append(row)
    if per_question:
        out["per_question"] = per_question
    # a report with no time on camera says nothing
    return out if out.get("seconds", 0) >= 5 else None


def delivery_headline(delivery: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """The few numbers shown in a list of past practice interviews, and compared from one to the next."""
    if not delivery:
        return None
    out = {
        key: delivery.get(key)
        for key in ("eye_contact", "eye_speaking", "posture", "steady", "in_frame", "seconds")
        if delivery.get(key) is not None
    }
    voice = delivery.get("voice") or {}
    for key in ("pace", "range", "filler_rate"):
        if voice.get(key) is not None:
            out[key] = voice[key]
    return out
