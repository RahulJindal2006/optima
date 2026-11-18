"""The scorecard every interview answer is graded on, and every sum that turns it into a score.

Nothing in this file calls a model, reads a clock or touches the database. The model's only job
(claude_client.py) is to pick one written level for each line of the scorecard. Everything after
that is arithmetic done here, so the same levels always give the same number.

Why it is built this way is written up, with its sources, in docs/SCORING.md. In short:
  - Each answer is rated on its own, against written levels (how structured interviews are scored).
  - The levels are added up by fixed rule, never by an overall impression.
  - A grade is stored under a fingerprint of the question and the answer, so an identical answer
    gets the identical grade, whoever gives it and whenever.

Change a description, a weight or a rule here and change VERSION with it: grades stored under the
old version are then left alone and new answers are graded afresh.
"""
import hashlib
import json
import re
import unicodedata
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

VERSION = "2026.11-a"

# ── Levels ───────────────────────────────────────────────────────────────────
# Five levels for a criterion, three marks for one of the points a question looks for.
LEVELS = ("none", "weak", "partial", "solid", "strong")
LEVEL_POINTS = {"none": 0.0, "weak": 25.0, "partial": 50.0, "solid": 75.0, "strong": 100.0}
MARKS = ("missing", "partly", "covered")
MARK_VALUE = {"missing": 0.0, "partly": 0.5, "covered": 1.0}
MARK_MEANING = {
    "covered": "Dealt with clearly and correctly.",
    "partly": "Mentioned, but thin or only partly right.",
    "missing": "Not there, or wrong.",
}

# The line of the scorecard that is worked out from the question's own points, not a level.
POINTS_KEY = "substance"

# ── The two scorecards ───────────────────────────────────────────────────────
# `gate` marks the criterion that decides whether there is an answer at all (see GATES).
VERBAL = (
    {
        "key": "answer",
        "label": "Answers the question",
        "weight": 0.20,
        "gate": True,
        "asks": "Does the answer deal with what was actually asked?",
        "levels": {
            "none": "Blank, off the subject, or about something other than what was asked.",
            "weak": "On the subject, but it does not answer what was asked.",
            "partial": "Answers part of the question. Something that was asked for is missing.",
            "solid": "Answers everything that was asked, directly.",
            "strong": "Answers everything that was asked, directly, and shows why it matters for the job.",
        },
    },
    {
        "key": "evidence",
        "label": "Evidence",
        "weight": 0.30,
        "asks": "Is there something specific behind the claims: a real example, or a worked detail?",
        "levels": {
            "none": "No example and nothing specific. General statements only.",
            "weak": "An example or detail is named, but it is vague or generic. What the candidate did is not clear.",
            "partial": "A real example or worked detail, but the candidate's own part in it, or what came of it, is unclear.",
            "solid": "A specific example or worked detail: the situation, what the candidate did, and what came of it.",
            "strong": "As solid, with particulars that could be checked (numbers, tools, limits, trade-offs) and what the candidate learned or would change.",
        },
    },
    {
        "key": POINTS_KEY,
        "label": "Covers what the role needs",
        "weight": 0.35,
        "asks": "How many of the points this question looks for does the answer deal with?",
    },
    {
        "key": "clarity",
        "label": "Clear and organised",
        "weight": 0.15,
        "asks": "Could an interviewer follow it the first time through?",
        "levels": {
            "none": "Cannot be followed.",
            "weak": "Hard to follow. It rambles, or the point is buried.",
            "partial": "Can be followed, but it is loosely ordered, padded or repeats itself.",
            "solid": "Clear and in a sensible order. It gets to the point.",
            "strong": "Clear, well ordered and economical. It would work said aloud in an interview.",
        },
    },
)

CODE = (
    {
        "key": "correct",
        "label": "Correct",
        "weight": 0.40,
        "gate": True,
        "asks": "Does the solution do what the question asks?",
        "levels": {
            "none": "No solution, or one that does not address the problem.",
            "weak": "An idea or an attempt, but not a working solution: the logic is missing or would not work.",
            "partial": "Works for the main case. It has a bug, or fails a case the question implies.",
            "solid": "Correct for what was asked.",
            "strong": "Correct, and the edge cases (empty input, limits) are handled or called out.",
        },
    },
    {
        "key": "approach",
        "label": "Approach",
        "weight": 0.20,
        "asks": "Is the method a sensible one for this problem, and does the candidate know what it costs?",
        "levels": {
            "none": "No method can be made out.",
            "weak": "A method that does not suit the problem.",
            "partial": "Workable, but wasteful, or chosen without a reason.",
            "solid": "A suitable method.",
            "strong": "A suitable method, with its cost (time, memory or trade-offs) stated correctly.",
        },
    },
    {
        "key": POINTS_KEY,
        "label": "Covers what the role needs",
        "weight": 0.20,
        "asks": "How many of the points this question looks for does the answer deal with?",
    },
    {
        "key": "clarity",
        "label": "Explained and readable",
        "weight": 0.20,
        "asks": "Could another person pick this up and work with it?",
        "levels": {
            "none": "Cannot be followed.",
            "weak": "Hard to follow: unclear names or structure, and no explanation.",
            "partial": "Readable, or explained, but not both.",
            "solid": "Readable, and it says how it works.",
            "strong": "Readable, says how it works and why it was done this way.",
        },
    },
)

# An answer that is not an answer earns nothing for style. One that is on the subject but does not
# answer what was asked cannot score above CAP_WHEN_WEAK, however well it is put.
CAP_WHEN_WEAK = 35.0

# An answer shorter than this is not sent anywhere: it is a skipped question.
MIN_WORDS = 5          # spoken or written answers
MIN_CODE_CHARS = 8     # code, not counting spaces

# ── Whole-interview rules ────────────────────────────────────────────────────
# Seconds allowed for each kind of question. A question's share of the interview score is its
# share of the time, so the questions that ask for more count for more.
SECONDS = {"general": 120, "role": 150, "long": 300, "code": 360}
GRACE_SECONDS = 20

# Answer fewer than this share of the questions and the interview is incomplete: it is still scored
# (every skipped question counts as 0) but no application is sent on the strength of it.
COMPLETE_AT = 0.75

# An application is sent for a role when the match score reaches this.
SEND_AT = 40.0

# The match score for one role.
WEIGHTS = {"performance": 0.40, "relevance": 0.35, "skills": 0.10, "resume": 0.15}

# What the camera costs. Shares are of the time spent on questions.
#   free: no points lost up to here.   full: every point for this line is lost from here on.
PRESENCE = {
    "off_camera": {"free": 0.05, "full": 0.30, "points": 10.0},
    "looking_away": {"free": 0.10, "full": 0.40, "points": 10.0},
    "second_person": {"seconds": 5.0, "points": 5.0},
}


def card_for(question_type: str) -> Tuple[dict, ...]:
    return CODE if question_type == "code" else VERBAL


def level_keys(question_type: str) -> List[str]:
    """The criteria the grader picks a level for (every line but the one made from the points)."""
    return [c["key"] for c in card_for(question_type) if c["key"] != POINTS_KEY]


def seconds_for(category: Optional[str], question_type: str) -> int:
    if question_type == "code":
        return SECONDS["code"]
    return SECONDS.get(category or "role", SECONDS["role"])


# ── Reading an answer the same way every time ────────────────────────────────

def _plain(text: Optional[str]) -> str:
    return unicodedata.normalize("NFKC", text or "")


def count_words(text: Optional[str]) -> int:
    return len(re.findall(r"[^\W_]+(?:['’][^\W_]+)*", _plain(text)))


def is_blank(answer: Optional[str], question_type: str) -> bool:
    """True for an answer too short to be one. It scores 0 and is never sent to the grader."""
    if question_type == "code":
        return len(re.sub(r"\s+", "", _plain(answer))) < MIN_CODE_CHARS
    return count_words(answer) < MIN_WORDS


def canon(text: Optional[str]) -> str:
    """A question or a point as it is compared: case and spacing do not matter."""
    return " ".join(_plain(text).casefold().split())


# The marks that end or break a sentence, and the quotes and brackets put around words.
_EDGE_MARKS = ".,;:!?…\"'`“”‘’«»()[]{}–—"
_APOSTROPHES = str.maketrans({"’": "'", "‘": "'", "ʼ": "'"})


def canon_answer(answer: Optional[str], question_type: str) -> str:
    """An answer as it is compared.

    Spoken and written answers: capital letters, spacing, and the punctuation around words are dropped,
    because a dictated answer has little of them and none of them is graded. Anything inside a word stays
    (1.3, node.js, didn't) and so does any other symbol (C++, C#, 40%, $40), because those change what was said.
    Code: line endings and trailing spaces are evened out and nothing else, because in code
    capitals, symbols and indentation all mean something.
    """
    text = _plain(answer)
    if question_type == "code":
        lines = [line.rstrip() for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
        return "\n".join(lines).strip("\n")
    words = (word.strip(_EDGE_MARKS) for word in text.casefold().translate(_APOSTROPHES).split())
    return " ".join(word for word in words if word)


def _digest(parts: Any) -> str:
    return hashlib.sha256(json.dumps(parts, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()


def answer_key(question_text: str, question_type: str, key_points: Sequence[str], answer: str) -> str:
    """The fingerprint a grade is stored under. Two answers with the same one are the same answer."""
    kind = "code" if question_type == "code" else "verbal"
    return _digest(["answer", VERSION, kind, canon(question_text), [canon(p) for p in key_points], canon_answer(answer, kind)])


# ── From what the grader said to a scorecard ─────────────────────────────────

def read_level(value: Any) -> Optional[str]:
    word = str(value).strip().casefold() if isinstance(value, str) else ""
    return word if word in LEVELS else None


def read_mark(value: Any) -> Optional[str]:
    word = str(value).strip().casefold() if isinstance(value, str) else ""
    return word if word in MARKS else None


def _middle(values: Sequence[int]) -> int:
    """The middle of an odd number of ratings. Of an even number, the lower of the middle two:
    when the graders split evenly, the benefit of the doubt is not given."""
    ordered = sorted(values)
    return ordered[(len(ordered) - 1) // 2]


def combine(samples: Sequence[Dict[str, Any]], question_type: str, points: int) -> Dict[str, Any]:
    """Several gradings of one answer, made into one: the middle rating on every line.

    Each sample is {"levels": {key: level}, "marks": [mark, ...], "manipulation": bool, ...}.
    """
    if not samples:
        raise ValueError("there is nothing to combine")
    keys = level_keys(question_type)
    levels = {key: LEVELS[_middle([LEVELS.index(s["levels"][key]) for s in samples])] for key in keys}
    marks = [MARKS[_middle([MARKS.index(s["marks"][i]) for s in samples])] for i in range(points)]
    flagged = sum(1 for s in samples if s.get("manipulation"))
    # how often the gradings agreed with the rating that was kept, line by line
    lines = len(keys) + points
    same = sum(
        sum(1 for key in keys if s["levels"][key] == levels[key]) + sum(1 for i in range(points) if s["marks"][i] == marks[i])
        for s in samples
    )
    # the words come from the grading that sits closest to what was kept
    def distance(s):
        return sum(abs(LEVELS.index(s["levels"][k]) - LEVELS.index(levels[k])) for k in keys) + sum(
            abs(MARKS.index(s["marks"][i]) - MARKS.index(marks[i])) for i in range(points)
        )
    closest = min(samples, key=distance)
    return {
        "levels": levels,
        "marks": marks,
        "manipulation": flagged * 2 > len(samples),
        "seen": closest.get("seen", ""),
        "strength": closest.get("strength", ""),
        "improve": closest.get("improve", ""),
        "samples": len(samples),
        "agreement": round(same / (lines * len(samples)), 3) if lines else 1.0,
    }


def _tenth(value: float) -> float:
    """To one decimal place, halves rounded up (Python's own round() sends 11.25 to 11.2)."""
    return int(value * 10 + 0.5 + 1e-9) / 10.0


def _shares(weights: Sequence[float]) -> List[float]:
    """What each line is worth out of 100, to one decimal place, adding up to exactly 100."""
    total = sum(weights)
    tenths = [1000.0 * weight / total for weight in weights]
    whole = [int(t + 1e-9) for t in tenths]
    spare = 1000 - sum(whole)
    for i in sorted(range(len(tenths)), key=lambda i: tenths[i] - whole[i], reverse=True)[:spare]:
        whole[i] += 1
    return [w / 10.0 for w in whole]


def scorecard(question_type: str, levels: Dict[str, str], marks: Sequence[str], key_points: Sequence[str]) -> Dict[str, Any]:
    """The score for one answer, with every line that made it up.

    The score is the sum of the lines exactly as they are shown, so a reader who adds the lines
    up gets the score.
    """
    has_points = len(marks) > 0
    # a question with no points to look for shares that line's weight among the others
    card = [c for c in card_for(question_type) if has_points or c["key"] != POINTS_KEY]
    worths = _shares([c["weight"] for c in card])
    lines = []
    score = 0.0
    gate = "strong"
    for criterion, worth in zip(card, worths):
        if criterion["key"] == POINTS_KEY:
            value = 100.0 * sum(MARK_VALUE[m] for m in marks) / len(marks)
            line = {
                "key": POINTS_KEY,
                "label": criterion["label"],
                "points": [{"text": text, "mark": mark} for text, mark in zip(key_points, marks)],
                "covered": sum(1 for m in marks if m == "covered"),
                "partly": sum(1 for m in marks if m == "partly"),
                "of": len(marks),
            }
        else:
            level = levels[criterion["key"]]
            value = LEVEL_POINTS[level]
            line = {"key": criterion["key"], "label": criterion["label"], "level": level, "meaning": criterion["levels"][level]}
            if criterion.get("gate"):
                gate = level
        line["value"] = _tenth(value)                      # this line, out of 100
        line["worth"] = worth                              # the most it can add to the answer's score
        line["earned"] = _tenth(value * worth / 100.0)     # what it did add
        score += line["earned"]
        lines.append(line)

    score = _tenth(score)
    cap = None
    if gate == "none":
        # not an answer: the other lines keep the level they were given, but none of them earns anything
        score, cap = 0.0, "none"
        for line in lines:
            line["earned"] = 0.0
    elif gate == "weak" and score > CAP_WHEN_WEAK:
        score, cap = CAP_WHEN_WEAK, "weak"
    return {"score": score, "lines": lines, "cap": cap, "answered": gate != "none"}


def feedback_text(card: Dict[str, Any], strength: str, improve: str) -> str:
    """Two or three sentences for the places that show feedback as plain text."""
    if card["cap"] == "none":
        return "This did not answer the question that was asked, so it scored 0."
    said = [s.strip() for s in (strength, improve) if s and s.strip()]
    if card["cap"] == "weak":
        said.append(f"It stayed on the subject without answering what was asked, so it could not score above {int(CAP_WHEN_WEAK)}.")
    return " ".join(said)


# ── The interview as a whole ─────────────────────────────────────────────────

def interview_score(rows: Iterable[Tuple[float, Optional[float]]]) -> float:
    """Every question's score, weighted by the time it was given.

    `rows` is (seconds allowed, score). A skipped question is in the list with a score of 0.
    A score of None means the answer could not be graded at all: it is left out.
    """
    counted = [(max(1.0, float(seconds)), float(score)) for seconds, score in rows if score is not None]
    weight = sum(seconds for seconds, _ in counted)
    return round(sum(seconds * score for seconds, score in counted) / weight, 1) if weight else 0.0


def completion(answered: int, total: int) -> Dict[str, Any]:
    share = answered / total if total else 0.0
    needed = -(-total * 3 // 4) if total else 0   # three quarters, rounded up
    return {"answered": answered, "total": total, "share": round(share, 3), "needed": int(needed), "complete": total > 0 and answered >= needed}


def _slide(share: float, rule: Dict[str, float]) -> float:
    if share <= rule["free"]:
        return 0.0
    if share >= rule["full"]:
        return rule["points"]
    return rule["points"] * (share - rule["free"]) / (rule["full"] - rule["free"])


def presence(seconds: float, watched: float, present: float, away: float, others: float) -> Dict[str, Any]:
    """What the camera adds to the record of a weekly interview, and what it takes off the score.

    seconds  time spent on questions, by the server's clock
    watched  how much of that the camera was being read
    present  how much of that a face was in the picture
    away     how much of that the face was turned away from the screen
    others   how much of that a second face was in the picture

    Time the camera was not being read counts as time off camera: the camera is a condition of
    the interview, so a camera that is covered, unplugged or switched off is not a way round it.
    """
    seconds = max(0.0, float(seconds))
    watched = min(max(0.0, float(watched)), seconds) if seconds else 0.0
    present = min(max(0.0, float(present)), watched)
    away = min(max(0.0, float(away)), present)
    others = min(max(0.0, float(others)), watched)
    if seconds < 1:
        return {"seconds": 0, "off_camera": None, "looking_away": None, "second_person_seconds": 0, "deduction": 0.0, "lines": []}
    off_share = (seconds - present) / seconds
    away_share = away / present if present > 0 else 0.0
    lost_off = _slide(off_share, PRESENCE["off_camera"])
    lost_away = _slide(away_share, PRESENCE["looking_away"])
    lost_others = PRESENCE["second_person"]["points"] if others >= PRESENCE["second_person"]["seconds"] else 0.0
    lines = []
    if lost_off:
        lines.append({"key": "off_camera", "points": round(lost_off, 1), "share": round(off_share, 3)})
    if lost_away:
        lines.append({"key": "looking_away", "points": round(lost_away, 1), "share": round(away_share, 3)})
    if lost_others:
        lines.append({"key": "second_person", "points": round(lost_others, 1), "seconds": round(others)})
    return {
        "seconds": round(seconds),
        "off_camera": round(off_share, 3),
        "looking_away": round(away_share, 3),
        "second_person_seconds": round(others),
        "deduction": round(lost_off + lost_away + lost_others, 1),
        "lines": lines,
    }


# ── One role ─────────────────────────────────────────────────────────────────
SHOWN = ("absent", "mentioned", "shown")          # a required skill, in the answers or in the resume
SHOWN_VALUE = {"absent": 0.0, "mentioned": 0.5, "shown": 1.0}
LISTED = ("missing", "related", "listed")         # a required skill, on the profile's list of skills
LISTED_VALUE = {"missing": 0.0, "related": 0.5, "listed": 1.0}
MAX_SKILLS = 12                                    # a posting's first twelve skills are the ones compared

FIT_LEVELS = {
    "answers": {
        "none": "Nothing in the answers bears on the work this job describes.",
        "weak": "The answers touch this kind of work in passing.",
        "partial": "Some of the answers show experience or knowledge this job uses. Much of the job is not touched.",
        "solid": "Most of what this job involves is shown somewhere in the answers.",
        "strong": "The answers show direct experience of this job's main work, with specifics.",
    },
    "resume": {
        "none": "Nothing on the resume bears on this job.",
        "weak": "The resume touches this kind of work in passing.",
        "partial": "The resume shows some related experience or study. Much of the job is not covered.",
        "solid": "The resume shows experience or study that fits most of this job.",
        "strong": "The resume shows direct experience of this job's main work.",
    },
    "skills": {
        "none": "None of the listed skills is one this job uses.",
        "weak": "One or two of the listed skills are loosely related to this job.",
        "partial": "Some of the listed skills are ones this job uses.",
        "solid": "Most of what this job uses is on the list.",
        "strong": "The list covers what this job uses.",
    },
}


def _coverage(marks: Sequence[str], values: Dict[str, float]) -> Optional[float]:
    return 100.0 * sum(values[m] for m in marks) / len(marks) if marks else None


def _with_skills(level: str, marks: Sequence[str], values: Dict[str, float]) -> float:
    """Half the level, half the share of the posting's skills that turned up. The level alone when the
    posting lists no skills."""
    covered = _coverage(marks, values)
    return LEVEL_POINTS[level] if covered is None else 0.5 * LEVEL_POINTS[level] + 0.5 * covered


def relevance_score(fit: str, skills_shown: Sequence[str]) -> float:
    return round(_with_skills(fit, skills_shown, SHOWN_VALUE), 1)


def resume_score(fit: Optional[str], skills_shown: Sequence[str]) -> float:
    return 0.0 if fit is None else round(_with_skills(fit, skills_shown, SHOWN_VALUE), 1)


def skills_score(fit: Optional[str], skills_listed: Sequence[str]) -> float:
    covered = _coverage(skills_listed, LISTED_VALUE)
    if covered is not None:
        return round(covered, 1)
    return 0.0 if fit is None else LEVEL_POINTS[fit]


def _middle_of(values: Sequence[str], order: Sequence[str]) -> str:
    return order[_middle([order.index(value) for value in values])]


def _apart(a: Sequence[str], b: Sequence[str], order: Sequence[str]) -> int:
    return sum(abs(order.index(x) - order.index(y)) for x, y in zip(a, b))


def combine_answers_fit(samples: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    """Several ratings of how a set of answers fits one job, made into one: the middle level, and the
    middle mark for each skill. The words come from the rating closest to what was kept."""
    if not samples:
        raise ValueError("there is nothing to combine")
    fit = _middle_of([s["fit"] for s in samples], LEVELS)
    skills = [_middle_of([s["skills"][i] for s in samples], SHOWN) for i in range(len(samples[0]["skills"]))]
    closest = min(samples, key=lambda s: abs(LEVELS.index(s["fit"]) - LEVELS.index(fit)) + _apart(s["skills"], skills, SHOWN))
    return {"fit": fit, "skills": skills, "seen": closest.get("seen", ""), "why": closest.get("why", ""), "samples": len(samples)}


def combine_profile_fit(samples: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    """Several ratings of how a profile fits one job, made into one, the same way."""
    if not samples:
        raise ValueError("there is nothing to combine")

    def level(name: str) -> Optional[str]:
        values = [s.get(name) for s in samples]
        return None if any(value is None for value in values) else _middle_of(values, LEVELS)

    def marks(name: str, order: Sequence[str]) -> List[str]:
        return [_middle_of([s[name][i] for s in samples], order) for i in range(len(samples[0].get(name) or []))]

    out = {
        "skills_listed": marks("skills_listed", LISTED),
        "skills_fit": level("skills_fit"),
        "resume_fit": level("resume_fit"),
        "resume_skills": marks("resume_skills", SHOWN),
    }

    def distance(s: Dict[str, Any]) -> int:
        far = _apart(s.get("skills_listed") or [], out["skills_listed"], LISTED) + _apart(s.get("resume_skills") or [], out["resume_skills"], SHOWN)
        for name in ("skills_fit", "resume_fit"):
            if out[name] is not None:
                far += abs(LEVELS.index(s[name]) - LEVELS.index(out[name]))
        return far

    out["why"] = min(samples, key=distance).get("why", "")
    out["samples"] = len(samples)
    return out


def composite(performance: float, relevance: float, skills: float, resume: float) -> float:
    """The match score: 40% interview performance, 35% relevance, 10% profile skills, 15% resume."""
    return round(
        performance * WEIGHTS["performance"] + relevance * WEIGHTS["relevance"] + skills * WEIGHTS["skills"] + resume * WEIGHTS["resume"],
        1,
    )


def job_text(title: str, description: Optional[str], responsibilities: Optional[str], skills: Sequence[str]) -> List[Any]:
    return [canon(title), canon(description), canon(responsibilities), [canon(s) for s in list(skills)[:MAX_SKILLS]]]


def answers_fit_key(job: List[Any], transcript: Sequence[Tuple[str, str, str]]) -> str:
    """Fingerprint for how well a set of answers fits one job. `transcript` is (question, kind, answer)."""
    return _digest(["fit-answers", VERSION, job, [[canon(q), canon_answer(a, kind)] for q, kind, a in transcript]])


def profile_fit_key(job: List[Any], skills: Sequence[str], resume: Optional[str]) -> str:
    """Fingerprint for how well a profile (its skills and its resume) fits one job."""
    return _digest(["fit-profile", VERSION, job, sorted({canon(s) for s in skills if canon(s)}), canon(resume)])


# ── For the page that explains scoring ───────────────────────────────────────

def public() -> Dict[str, Any]:
    """The rules above, as the scoring guide shows them. Sent as it stands, so the guide cannot drift."""
    def lines(card):
        out = []
        for c in card:
            row = {"key": c["key"], "label": c["label"], "weight": c["weight"], "asks": c["asks"]}
            if c["key"] == POINTS_KEY:
                row["marks"] = [{"name": m, "value": MARK_VALUE[m], "meaning": MARK_MEANING[m]} for m in reversed(MARKS)]
            else:
                row["levels"] = [{"name": name, "points": LEVEL_POINTS[name], "meaning": c["levels"][name]} for name in reversed(LEVELS)]
                row["gate"] = bool(c.get("gate"))
            out.append(row)
        return out
    return {
        "version": VERSION,
        "verbal": lines(VERBAL),
        "code": lines(CODE),
        "cap_when_weak": CAP_WHEN_WEAK,
        "min_words": MIN_WORDS,
        "seconds": dict(SECONDS),
        "complete_at": COMPLETE_AT,
        "send_at": SEND_AT,
        "weights": dict(WEIGHTS),
        "presence": {key: dict(value) for key, value in PRESENCE.items()},
        "fit": {key: [{"name": n, "points": LEVEL_POINTS[n], "meaning": levels[n]} for n in reversed(LEVELS)] for key, levels in FIT_LEVELS.items()},
    }
