"""How ratings are gathered: the worked examples the grader is shown, what happens when Claude says
to slow down, and the order calls are sent in. No network: Claude is replaced by a function. Run with

    python -m unittest discover -s tests

from the backend folder.
"""
import os
import sys
import threading
import time
import unittest

import httpx

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import anthropic  # noqa: E402
import claude_client  # noqa: E402
import rubric  # noqa: E402
import scoring  # noqa: E402


class WorkedExamples(unittest.TestCase):
    """The answers the grader is shown, with the ratings it is told they deserve."""

    def scored(self, kind):
        example = claude_client.EXAMPLES[kind]
        out = []
        for item in example["answers"]:
            levels = {key: value for key, value in item["ratings"].items() if not key.startswith("p")}
            marks = [item["ratings"][f"p{i + 1}"] for i in range(len(example["points"]))]
            out.append((levels, marks, rubric.scorecard(kind, levels, marks, example["points"])))
        return out

    def test_every_example_is_a_rating_the_grader_could_return(self):
        for kind in ("verbal", "code"):
            example = claude_client.EXAMPLES[kind]
            wanted = set(rubric.level_keys(kind)) | {f"p{i + 1}" for i in range(len(example["points"]))}
            for item in example["answers"]:
                self.assertEqual(set(item["ratings"]), wanted)
                for key, value in item["ratings"].items():
                    self.assertIn(value, rubric.MARKS if key.startswith("p") else rubric.LEVELS)

    def test_the_examples_score_where_a_strong_a_thin_and_an_empty_answer_should(self):
        for kind in ("verbal", "code"):
            (_, _, strong), (_, _, thin), (levels, _, empty) = self.scored(kind)
            self.assertGreaterEqual(strong["score"], 85)
            self.assertTrue(30 <= thin["score"] <= 55, thin["score"])
            self.assertLessEqual(empty["score"], rubric.CAP_WHEN_WEAK)
            gate = next(c["key"] for c in rubric.card_for(kind) if c.get("gate"))
            self.assertEqual(levels[gate], "weak")   # on the subject, and not an answer

    def test_the_examples_are_in_the_instructions_and_are_not_a_question_the_interview_asks(self):
        from question_bank import GENERAL_QUESTIONS
        asked = {rubric.canon(q["text"]) for q in GENERAL_QUESTIONS}
        for kind in ("verbal", "code"):
            example = claude_client.EXAMPLES[kind]
            self.assertIn(example["question"], claude_client._ANSWER_SYSTEM[kind])
            self.assertNotIn(rubric.canon(example["question"]), asked)

    def test_the_instructions_are_long_enough_to_be_reused_between_calls(self):
        # the API keeps instructions of 1,024 tokens or more; a token is at most about four characters of English
        for kind in ("verbal", "code"):
            self.assertGreater(len(claude_client._ANSWER_SYSTEM[kind]) / 4, 1200)


def _status_error(cls, status, headers=None, body=None):
    response = httpx.Response(status, headers=headers or {}, request=httpx.Request("POST", "https://api.example/v1/messages"))
    return cls("stand-in", response=response, body=body)


class _Client:
    """Stands in for the API client: fails `fails` times (always, when not given), then answers."""

    def __init__(self, error, fails=None):
        self.messages = self
        self.error = error
        self.fails = fails
        self.tries = 0

    def create(self, **request):
        self.tries += 1
        if self.fails is None or self.tries <= self.fails:
            raise self.error
        return "sent"


class SlowDown(unittest.TestCase):
    """A rate limit is not a failed grading."""

    def test_a_rate_limit_is_busy_and_says_how_long_to_wait(self):
        error = _status_error(anthropic.RateLimitError, 429, {"retry-after": "7"})
        with self.assertRaises(claude_client.Busy) as raised:
            claude_client._send(_Client(error), {})
        self.assertEqual(raised.exception.seconds, 7)

    def test_a_rate_limit_with_no_wait_given_gets_a_short_one_and_a_long_one_is_cut(self):
        with self.assertRaises(claude_client.Busy) as raised:
            claude_client._send(_Client(_status_error(anthropic.RateLimitError, 429)), {})
        self.assertEqual(raised.exception.seconds, claude_client.BUSY_SECONDS)
        with self.assertRaises(claude_client.Busy) as raised:
            claude_client._send(_Client(_status_error(anthropic.RateLimitError, 429, {"retry-after": "900"})), {})
        self.assertEqual(raised.exception.seconds, claude_client.BUSY_LONGEST)

    def test_an_overloaded_service_is_tried_again_and_then_busy(self):
        client = _Client(_status_error(anthropic.APIStatusError, 529))
        with self.assertRaises(claude_client.Busy):
            claude_client._send(client, {})
        self.assertEqual(client.tries, claude_client.RETRIES + 1)

    def test_a_short_limit_is_waited_out_on_the_spot(self):
        client = _Client(_status_error(anthropic.RateLimitError, 429, {"retry-after": "1"}), fails=1)
        began = time.monotonic()
        self.assertEqual(claude_client._send(client, {}), "sent")
        self.assertGreaterEqual(time.monotonic() - began, 0.9)
        self.assertEqual(client.tries, 2)

    def test_a_long_limit_is_not_waited_out_here(self):
        client = _Client(_status_error(anthropic.RateLimitError, 429, {"retry-after": "30"}), fails=1)
        with self.assertRaises(claude_client.Busy):
            claude_client._send(client, {})
        self.assertEqual(client.tries, 1)

    def test_a_server_error_is_tried_again_once(self):
        client = _Client(_status_error(anthropic.InternalServerError, 500), fails=1)
        self.assertEqual(claude_client._send(client, {}), "sent")
        client = _Client(_status_error(anthropic.InternalServerError, 500))
        with self.assertRaises(anthropic.InternalServerError):
            claude_client._send(client, {})
        self.assertEqual(client.tries, claude_client.RETRIES + 1)

    def test_a_spend_cap_is_a_failure_because_waiting_will_not_help(self):
        body = {"type": "error", "error": {"type": "rate_limit_error", "details": {"error_code": "enforced_spend_limit_reached"}}}
        with self.assertRaises(anthropic.RateLimitError):
            claude_client._send(_Client(_status_error(anthropic.RateLimitError, 429, body=body)), {})

    def test_a_refused_request_is_passed_on_as_it_is_and_not_tried_again(self):
        client = _Client(_status_error(anthropic.BadRequestError, 400))
        with self.assertRaises(anthropic.BadRequestError):
            claude_client._send(client, {})
        self.assertEqual(client.tries, 1)

    def test_too_few_ratings_because_of_a_limit_is_busy_and_because_of_an_error_is_a_failure(self):
        good = {"levels": {"answer": "solid", "evidence": "solid", "clarity": "solid"}, "marks": ["covered"], "manipulation": False}
        settle = lambda ratings: scoring.settle(ratings, "verbal", 1, 3)  # noqa: E731
        busy = scoring._Busy(9)
        self.assertTrue(scoring.is_busy(scoring._settled([good, busy, scoring._Busy(4)], settle)))
        self.assertEqual(scoring._settled([good, busy, scoring._Busy(4)], settle).seconds, 9)
        self.assertIsNone(scoring._settled([good, None, None], settle))
        # two ratings are enough to stand on, whatever became of the third
        self.assertEqual(scoring._settled([good, good, busy], settle)["samples"], 2)
        self.assertEqual(scoring._settled([good, good, None], settle)["samples"], 2)

    def test_the_wait_is_the_longest_one_asked_for(self):
        self.assertEqual(scoring.wait_for([None, {"score": 1}, scoring._Busy(3), scoring._Busy(11)]), 11)
        self.assertEqual(scoring.wait_for([None, {"score": 1}]), 0)

    def test_safely_turns_a_limit_into_busy_and_anything_else_into_nothing(self):
        def limited():
            raise claude_client.Busy(6)

        def broken():
            raise ValueError("no")

        self.assertEqual(scoring._safely(limited).seconds, 6)
        self.assertIsNone(scoring._safely(broken))
        self.assertEqual(scoring._safely(lambda: {"ok": True}), {"ok": True})


class SendingOrder(unittest.TestCase):
    """The first call of a kind goes alone when nothing has been sent for a while, so the rest can reuse it."""

    def setUp(self):
        with scoring._warm_lock:
            scoring._warm.clear()
        self.log = []
        self.lock = threading.Lock()

    def run_task(self, task):
        with self.lock:
            self.log.append(("start", task, time.monotonic()))
        time.sleep(0.03)
        with self.lock:
            self.log.append(("end", task, time.monotonic()))
        return {"task": task}

    def when(self, what, task):
        return next(at for kind, name, at in self.log if kind == what and name == task)

    def test_results_come_back_in_the_order_asked(self):
        tasks = [("a", n) for n in range(7)]
        self.assertEqual(scoring._run_all(tasks, self.run_task, lambda t: t[0]), [{"task": t} for t in tasks])

    def test_the_first_of_a_cold_share_finishes_before_the_others_start(self):
        tasks = [("a", n) for n in range(5)] + [("b", n) for n in range(4)]
        scoring._run_all(tasks, self.run_task, lambda t: t[0])
        for share in ("a", "b"):
            first = next(t for t in tasks if t[0] == share)
            for other in [t for t in tasks if t[0] == share and t != first]:
                self.assertLessEqual(self.when("end", first), self.when("start", other))

    def test_the_first_calls_of_different_shares_go_together(self):
        tasks = [("a", 0), ("a", 1), ("b", 0), ("b", 1)]
        scoring._run_all(tasks, self.run_task, lambda t: t[0])
        self.assertLess(self.when("start", ("b", 0)), self.when("end", ("a", 0)))

    def test_a_warm_share_is_sent_all_at_once(self):
        scoring._run_all([("a", 0), ("a", 1)], self.run_task, lambda t: t[0])
        self.log.clear()
        tasks = [("a", n) for n in range(2, 6)]
        scoring._run_all(tasks, self.run_task, lambda t: t[0])
        self.assertLess(self.when("start", tasks[1]), self.when("end", tasks[0]))

    def test_a_share_is_not_warm_until_a_call_for_it_has_worked(self):
        scoring._run_all([("a", 0), ("a", 1)], lambda task: None, lambda t: t[0])
        self.assertFalse(scoring._is_warm("a"))
        scoring._run_all([("a", 0), ("a", 1)], lambda task: scoring._Busy(2), lambda t: t[0])
        self.assertFalse(scoring._is_warm("a"))

    def test_when_the_first_call_is_told_to_slow_down_the_rest_are_not_sent(self):
        sent = []

        def run(task):
            sent.append(task)
            return scoring._Busy(12) if task[0] == "a" else {"task": task}

        tasks = [("a", n) for n in range(5)] + [("b", n) for n in range(3)]
        results = scoring._run_all(tasks, run, lambda t: t[0])
        self.assertEqual([t for t in sent if t[0] == "a"], [("a", 0)])
        self.assertTrue(all(scoring.is_busy(r) and r.seconds == 12 for r in results[:5]))
        self.assertEqual(results[5:], [{"task": t} for t in tasks[5:]])

    def test_a_share_told_to_slow_down_is_cold_again(self):
        scoring._run_all([("a", 0), ("a", 1)], self.run_task, lambda t: t[0])
        self.assertTrue(scoring._is_warm("a"))
        scoring._run_all([("a", 2), ("a", 3)], lambda task: scoring._Busy(3), lambda t: t[0])
        self.assertFalse(scoring._is_warm("a"))

    def test_one_call_alone_is_just_sent(self):
        self.assertEqual(scoring._run_all([("a", 0)], self.run_task, lambda t: t[0]), [{"task": ("a", 0)}])
        self.assertEqual(scoring._run_all([], self.run_task, lambda t: t[0]), [])


class SeveralRatingsOfARole(unittest.TestCase):
    def test_the_middle_level_and_the_middle_mark_for_each_skill_are_kept(self):
        samples = [
            {"fit": "partial", "skills": ["shown", "absent"], "why": "one"},
            {"fit": "solid", "skills": ["shown", "mentioned"], "why": "two"},
            {"fit": "solid", "skills": ["mentioned", "mentioned"], "why": "three"},
        ]
        kept = rubric.combine_answers_fit(samples)
        self.assertEqual((kept["fit"], kept["skills"], kept["samples"]), ("solid", ["shown", "mentioned"], 3))
        self.assertEqual(kept["why"], "two")   # the words of the rating that matches what was kept

    def test_of_two_ratings_the_lower_is_kept(self):
        kept = rubric.combine_answers_fit([{"fit": "strong", "skills": ["shown"]}, {"fit": "partial", "skills": ["mentioned"]}])
        self.assertEqual((kept["fit"], kept["skills"]), ("partial", ["mentioned"]))

    def test_a_posting_with_no_skills_keeps_the_level_alone(self):
        kept = rubric.combine_answers_fit([{"fit": "weak", "skills": []}] * 3)
        self.assertEqual((kept["fit"], kept["skills"]), ("weak", []))

    def test_a_profile_is_combined_part_by_part(self):
        samples = [
            {"skills_listed": ["listed", "missing"], "skills_fit": None, "resume_fit": "solid", "resume_skills": ["shown", "absent"], "why": "a"},
            {"skills_listed": ["listed", "related"], "skills_fit": None, "resume_fit": "partial", "resume_skills": ["shown", "absent"], "why": "b"},
            {"skills_listed": ["related", "related"], "skills_fit": None, "resume_fit": "partial", "resume_skills": ["mentioned", "absent"], "why": "c"},
        ]
        kept = rubric.combine_profile_fit(samples)
        self.assertEqual(kept["skills_listed"], ["listed", "related"])
        self.assertIsNone(kept["skills_fit"])
        self.assertEqual(kept["resume_fit"], "partial")
        self.assertEqual(kept["resume_skills"], ["shown", "absent"])
        self.assertEqual((kept["why"], kept["samples"]), ("b", 3))

    def test_a_profile_with_no_resume_and_a_posting_with_no_skills(self):
        samples = [{"skills_listed": [], "skills_fit": level, "resume_fit": None, "resume_skills": [], "why": level} for level in ("weak", "solid", "partial")]
        kept = rubric.combine_profile_fit(samples)
        self.assertEqual((kept["skills_fit"], kept["resume_fit"], kept["why"]), ("partial", None, "partial"))

    def test_the_same_ratings_always_combine_to_the_same_thing(self):
        samples = [{"fit": "solid", "skills": ["shown", "absent"], "why": "x"}, {"fit": "weak", "skills": ["absent", "absent"], "why": "y"},
                   {"fit": "partial", "skills": ["mentioned", "shown"], "why": "z"}]
        first = rubric.combine_answers_fit(samples)
        for _ in range(20):
            self.assertEqual(rubric.combine_answers_fit(list(samples)), first)


if __name__ == "__main__":
    unittest.main()
