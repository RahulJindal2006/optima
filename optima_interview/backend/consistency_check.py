"""Grade the same answers many times over and report whether a grade ever changes.

  python consistency_check.py                 100 people, then 100 fresh gradings of each reference answer
  python consistency_check.py --runs 20       fewer fresh gradings (each one is GRADER_SAMPLES calls to Claude)
  python consistency_check.py --only team-strong,team-thin
  python consistency_check.py --out report.json

It answers two different questions, and keeps them apart.

  A. THE SAME ANSWER FROM MANY PEOPLE. `--people` candidates give word-for-word the same answers.
     This is the path the product takes: the first is graded, the grade is stored, the rest are
     given the stored grade. Every one must get exactly the same score. If one does not, this
     exits with an error.

  B. THE SAME ANSWER GRADED FROM SCRATCH. Each reference answer is graded `--runs` times with
     nothing stored, to see how far the grader wanders when it has nothing to fall back on. This
     is reported, with each answer's lowest and highest score, and whether it stayed in the band
     an answer of that quality belongs in (reference_answers.py). Add --strict to exit with an
     error if any answer's score changed between runs or left its band.

It uses whatever ANTHROPIC_API_KEY, CLAUDE_MODEL and GRADER_SAMPLES are set, the same as the
server. Part B makes real calls and costs money: runs x answers x GRADER_SAMPLES of them.
The same check can be run from the site, with no terminal, at /scoring-check.
"""
import argparse
import json
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import claude_client
import models  # noqa: F401  (registers the tables)
import reference_answers as reference
import rubric
import scoring
from database import Base


def _items(cases):
    return [(c["question"], c["question_type"], c["key_points"], c["answer"]) for c in cases]


def same_answer_from_many_people(cases, people):
    """Part A. Returns (rows, calls made, differences found)."""
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, autoflush=False)
    calls = [0]
    real = claude_client.rate_answer

    def counted(*args, **kwargs):
        calls[0] += 1
        return real(*args, **kwargs)

    claude_client.rate_answer = counted
    try:
        seen = [[] for _ in cases]
        for _ in range(people):
            db = Session()
            try:
                # a new person each time: only the stored grades are carried over
                grades = _patiently(lambda: scoring.grade_answers(db, _items(cases)), lambda found: scoring.wait_for(found))
                for i, grade in enumerate(grades):
                    seen[i].append(None if not isinstance(grade, dict) else (grade["score"], json.dumps(grade["rubric"].get("lines"), sort_keys=True)))
                db.commit()
            finally:
                db.close()
    finally:
        claude_client.rate_answer = real
    rows, differences = [], 0
    for case, grades in zip(cases, seen):
        distinct = len(set(grades))
        failed = sum(1 for g in grades if g is None)
        differences += (distinct - 1) + failed
        rows.append({"id": case["id"], "people": people, "score": grades[0][0] if grades[0] else None, "distinct": distinct, "failed": failed})
    return rows, calls[0], differences


def _patiently(ask, wait_of, tries=20):
    """Ask, and when Claude says to slow down, wait as long as it says and ask again."""
    found = ask()
    for _ in range(tries):
        pause = wait_of(found)
        if not pause:
            break
        print(f"  (Claude said to slow down: waiting {pause:.0f}s)", flush=True)
        time.sleep(pause)
        found = ask()
    return found


def graded_from_scratch(cases, runs):
    """Part B. Returns one row per reference answer."""
    rows = []
    with ThreadPoolExecutor(max_workers=scoring.PARALLEL) as pool:
        for case in cases:
            item = (case["question"], case["question_type"], case["key_points"], case["answer"])
            scores, agreements, failed = [], [], 0
            if rubric.is_blank(case["answer"], case["question_type"]):
                scores = [0.0] * runs
            else:
                for _ in range(runs):
                    final = _patiently(lambda: scoring.rate(item, pool=pool), lambda found: found.seconds if scoring.is_busy(found) else 0)
                    if not isinstance(final, dict):
                        failed += 1
                        continue
                    scores.append(scoring.graded(final, case["question_type"], case["key_points"])["score"])
                    agreements.append(final["agreement"])
            low, high = case["band"]
            counts = Counter(scores)
            rows.append({
                "id": case["id"],
                "label": case["label"],
                "band": [low, high],
                "runs": runs,
                "failed": failed,
                "lowest": min(scores) if scores else None,
                "highest": max(scores) if scores else None,
                "most_common": counts.most_common(1)[0][0] if scores else None,
                "share_most_common": round(counts.most_common(1)[0][1] / len(scores), 3) if scores else None,
                "distinct": len(counts),
                "in_band": bool(scores) and all(low <= s <= high for s in scores),
                "ratings_agree": round(sum(agreements) / len(agreements), 3) if agreements else None,
                "scores": dict(sorted(counts.items())),
            })
            print(f"  {case['id']:<18} {_spread(rows[-1])}", flush=True)
    return rows


def _spread(row):
    if row["lowest"] is None:
        return "could not be graded"
    same = "same every run" if row["distinct"] == 1 else f"{row['distinct']} different scores, {round(100 * row['share_most_common'])}% on {row['most_common']:g}"
    band = "in band" if row["in_band"] else f"OUT OF BAND {row['band'][0]}-{row['band'][1]}"
    return f"{row['lowest']:>5g} to {row['highest']:<5g} {same:<44} {band}"


def ladders_hold(rows):
    """Within one question, a better answer must never score below a worse one, on any run."""
    by_id = {row["id"]: row for row in rows}
    broken = []
    for ladder in reference.LADDERS:
        steps = [by_id[name] for name in ladder if name in by_id and by_id[name]["lowest"] is not None]
        for better, worse in zip(steps, steps[1:]):
            if better["lowest"] < worse["highest"]:
                broken.append(f"{better['id']} (as low as {better['lowest']:g}) against {worse['id']} (as high as {worse['highest']:g})")
    return broken


def main():
    parser = argparse.ArgumentParser(description="Grade the same answers many times and report whether a grade ever changes.")
    parser.add_argument("--people", type=int, default=100, help="part A: how many candidates give the same answers (default 100)")
    parser.add_argument("--runs", type=int, default=100, help="part B: how many times each answer is graded from scratch (default 100; 0 skips part B)")
    parser.add_argument("--only", default="", help="comma-separated names of reference answers (default: all of them)")
    parser.add_argument("--strict", action="store_true", help="exit with an error if part B finds a changed score, a missed band or a broken order")
    parser.add_argument("--out", default="", help="write the full result to this file as JSON")
    args = parser.parse_args()

    wanted = [name.strip() for name in args.only.split(",") if name.strip()]
    unknown = [name for name in wanted if name not in reference.BY_ID]
    if unknown:
        sys.exit("No reference answer called: " + ", ".join(unknown))
    cases = [reference.BY_ID[name] for name in wanted] if wanted else reference.CASES
    graded = [c for c in cases if not rubric.is_blank(c["answer"], c["question_type"])]
    started = time.time()
    print(f"Rubric {rubric.VERSION}. Model {claude_client.GRADER_MODEL}. Each new answer is rated {scoring.SAMPLES} time(s).")

    print(f"\nA. The same {len(cases)} answers from {args.people} people (the stored grade)")
    people_rows, calls, differences = same_answer_from_many_people(cases, args.people)
    expected = len(graded) * scoring.SAMPLES
    for row in people_rows:
        mark = "same for all" if row["distinct"] == 1 and not row["failed"] else f"{row['distinct']} DIFFERENT GRADES, {row['failed']} failed"
        print(f"  {row['id']:<18} {row['score']!s:>5}   {mark}")
    print(f"  Calls to the grader: {calls} (the first person only: {expected} expected). Differences: {differences}.")

    scratch_rows, broken = [], []
    if args.runs > 0:
        print(f"\nB. Each answer graded from scratch {args.runs} times ({len(graded) * args.runs * scoring.SAMPLES} calls)")
        scratch_rows = graded_from_scratch(cases, args.runs)
        broken = ladders_hold(scratch_rows)
        steady = sum(1 for row in scratch_rows if row["distinct"] == 1)
        in_band = sum(1 for row in scratch_rows if row["in_band"])
        widest = max((row["highest"] - row["lowest"] for row in scratch_rows if row["lowest"] is not None), default=0)
        print(f"  {steady} of {len(scratch_rows)} answers got the same score on every run. Widest gap between two runs of one answer: {widest:g} points.")
        print(f"  {in_band} of {len(scratch_rows)} stayed inside the band for their quality.")
        print("  Order within each question held." if not broken else "  ORDER BROKEN: " + "; ".join(broken))

    if args.out:
        with open(args.out, "w") as handle:
            json.dump({
                "rubric": rubric.VERSION, "model": claude_client.GRADER_MODEL, "samples": scoring.SAMPLES,
                "seconds": round(time.time() - started, 1),
                "same_answer_from_many_people": {"people": args.people, "calls": calls, "expected_calls": expected, "differences": differences, "rows": people_rows},
                "graded_from_scratch": {"runs": args.runs, "rows": scratch_rows, "order_broken": broken},
            }, handle, indent=2)
        print(f"\nWritten to {args.out}")

    if differences or calls != expected:
        sys.exit("FAILED: the same answer did not always get the same grade.")
    if args.strict and (broken or any(row["distinct"] != 1 or not row["in_band"] for row in scratch_rows)):
        sys.exit("FAILED (--strict): a score changed between runs, left its band, or the order broke.")
    print("\nPassed: the same answer got the same grade every time.")


if __name__ == "__main__":
    main()
