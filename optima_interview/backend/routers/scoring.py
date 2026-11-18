"""The scoring rules as the guide shows them, and the check that the grader is repeatable.

  GET  /scoring/rubric        the scorecard, weights and rules (public: it is the published guide)
  GET  /scoring/check         the answers of known quality the check uses          (owner only)
  POST /scoring/check/run     grade one of them afresh, a few times                (owner only)

The check never reads or writes the stored grades. A stored grade is what makes two identical
answers come out the same in the product; the check asks the harder question, which is what the
grader does when it has nothing stored to fall back on.

"Owner only" means the request carries the ADMIN_KEY set on the server, in an X-Admin-Key
header. Each run makes real calls to Claude and costs money, so it is not open to anyone else.
"""
import os
from concurrent.futures import ThreadPoolExecutor
from typing import List, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

import claude_client
import reference_answers as reference
import rubric
import scoring

router = APIRouter(prefix="/scoring", tags=["scoring"])


@router.get("/rubric")
def the_rubric():
    return {**rubric.public(), "samples": scoring.SAMPLES}


def _owner(key: Optional[str]) -> None:
    expected = os.getenv("ADMIN_KEY")
    if not expected or key != expected:
        raise HTTPException(status_code=403, detail="This check is for the site's owner. The key was not accepted.")


@router.get("/check")
def check_setup(x_admin_key: Optional[str] = Header(default=None)):
    _owner(x_admin_key)
    return {
        "version": rubric.VERSION,
        "model": claude_client.GRADER_MODEL,
        "samples": scoring.SAMPLES,
        "cases": [
            {"id": c["id"], "label": c["label"], "question_type": c["question_type"], "question": c["question"],
             "answer": c["answer"], "band": c["band"], "calls": 0 if rubric.is_blank(c["answer"], c["question_type"]) else scoring.SAMPLES}
            for c in reference.CASES
        ],
        "ladders": reference.LADDERS,
    }


class CheckRun(BaseModel):
    case: str
    runs: int = Field(default=1, ge=1, le=6)


@router.post("/check/run")
def check_run(payload: CheckRun, x_admin_key: Optional[str] = Header(default=None)):
    """Grade one reference answer `runs` times, each time from scratch: the full grading, nothing stored."""
    _owner(x_admin_key)
    case = reference.BY_ID.get(payload.case)
    if case is None:
        raise HTTPException(status_code=404, detail="There is no reference answer with that name.")
    item = (case["question"], case["question_type"], case["key_points"], case["answer"])
    out: List[Optional[dict]] = []
    nothing = {"calls": 0, "input_tokens": 0, "cached_tokens": 0, "output_tokens": 0}
    if rubric.is_blank(case["answer"], case["question_type"]):
        # too short to be an answer: it scores 0 without a call, every time
        blank = {"score": 0.0, "levels": {}, "marks": [], "manipulation": False, "agreement": 1.0, "ratings": 0, "card": None}
        return {"case": case["id"], "runs": [blank] * payload.runs, "used": nothing, "wait_seconds": 0, "failures": []}
    before = claude_client.usage()
    wait = 0.0
    failures: List[str] = []
    with ThreadPoolExecutor(max_workers=scoring.PARALLEL) as pool:
        for _ in range(payload.runs):
            went_wrong: List[str] = []
            final = scoring.rate(item, pool=pool, why=went_wrong)
            if scoring.is_busy(final):
                # Claude said to slow down. That says nothing about the grader, so it is not counted
                # as a run: the page waits and asks for the runs that are left.
                wait = final.seconds
                break
            if final is None:
                out.append(None)
                # why this run could not be graded, each different reason once with how many ratings it took
                seen = {reason: went_wrong.count(reason) for reason in went_wrong}
                failures.append(" ".join(f"{reason} ({n} of {scoring.SAMPLES} ratings)" if n > 1 else reason for reason, n in seen.items()) or "Too few ratings came back.")
                continue
            shown = scoring.graded(final, case["question_type"], case["key_points"])
            out.append({
                "score": shown["score"],
                "levels": final["levels"],
                "marks": final["marks"],
                "manipulation": final["manipulation"],
                "agreement": final["agreement"],   # how often the separate ratings agreed with the one kept
                "ratings": final["samples"],
                # the scorecard a candidate would be shown for this grading, and the grader's own words,
                # so the page can say why an answer landed where it did and which line moved when one did
                "card": shown["rubric"],
            })
    after = claude_client.usage()
    # counted across the whole server: if an interview was being scored at the same moment, its calls are in here too
    return {"case": case["id"], "runs": out, "used": {key: after[key] - before[key] for key in nothing}, "wait_seconds": round(wait), "failures": failures}
