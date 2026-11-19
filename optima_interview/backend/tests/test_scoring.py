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
            levels = {key: item["ratings"][key] for key in rubric.level_keys(kind)}
            marks = [item["ratings"][f"p{i + 1}"] for i in range(len(example["points"]))]
            out.append((levels, marks, rubric.scorecard(kind, levels, marks, example["points"])))
        return out

    def test_every_example_is_a_rating_the_grader_could_return(self):
        for kind in ("verbal", "code"):
            example = claude_client.EXAMPLES[kind]
            wanted = set(rubric.level_keys(kind)) | {f"p{i + 1}" for i in range(len(example["points"]))}
            wanted.add("measure" if kind == "verbal" else "trace")   # the figure quoted from the answer, or what the code was found to return
            for item in example["answers"]:
                self.assertEqual(set(item["ratings"]), wanted)
                self.assertEqual(list(item["ratings"])[0], "measure" if kind == "verbal" else "trace")   # found first, rated second
                for key, value in item["ratings"].items():
                    if key not in ("measure", "trace"):
                        self.assertIn(value, rubric.MARKS if key.startswith("p") else rubric.LEVELS)

    def test_the_examples_score_where_a_strong_a_thin_and_an_empty_answer_should(self):
        for kind in ("verbal", "code"):
            scored = self.scored(kind)
            (_, _, strong), (_, _, thin), (levels, _, empty) = scored[0], scored[-2], scored[-1]
            self.assertGreaterEqual(strong["score"], 85)
            self.assertTrue(30 <= thin["score"] <= 55, thin["score"])
            self.assertLessEqual(empty["score"], rubric.CAP_WHEN_WEAK)
            gate = next(c["key"] for c in rubric.card_for(kind) if c.get("gate"))
            self.assertEqual(levels[gate], "weak")   # on the subject, and not an answer

    def test_the_same_story_with_and_without_a_figure_differs_by_one_level_of_evidence_and_nothing_else(self):
        first, second = claude_client.EXAMPLES["verbal"]["answers"][:2]
        (top, _, with_figure), (good, _, without) = self.scored("verbal")[:2]
        self.assertEqual((top["evidence"], good["evidence"]), ("strong", "solid"))
        self.assertEqual({k: v for k, v in first["ratings"].items() if k not in ("evidence", "measure")},
                         {k: v for k, v in second["ratings"].items() if k not in ("evidence", "measure")})
        self.assertEqual(round(with_figure["score"] - without["score"], 1), 7.5)
        self.assertGreater(without["score"], 80)     # a good answer still scores well: it is the top that is kept back

    def test_the_figure_an_example_quotes_is_in_its_answer_and_the_others_quote_nothing(self):
        answers = claude_client.EXAMPLES["verbal"]["answers"]
        self.assertTrue(rubric.measured(answers[0]["ratings"]["measure"], answers[0]["answer"]))
        for item in answers[1:]:
            self.assertEqual(item["ratings"]["measure"], "")
            self.assertNotEqual(item["ratings"]["evidence"], "strong")

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


class TopOfEvidence(unittest.TestCase):
    """The top level for evidence has to be backed by a figure quoted from the answer."""

    ANSWER = ("I rebuilt the weekly report so it ran from one query. It used to take about three hours by hand and now takes "
              "ten minutes, and the team has used it every week since. Next time I would ask who reads it first.")

    def rated(self, kind="verbal", **reply):
        said = {"seen": "A report was rebuilt.", "answer": "solid", "evidence": "strong", "clarity": "solid", "p1": "covered",
                "manipulation": False, "strength": "", "improve": ""}
        if kind == "code":
            said = {"seen": "A loop.", "correct": "solid", "approach": "strong", "clarity": "solid", "p1": "covered", "manipulation": False, "strength": "", "improve": ""}
        said.update(reply)
        real = claude_client._ask
        claude_client._ask = lambda *args, **kwargs: __import__("json").dumps(said)
        try:
            return claude_client.rate_answer("Tell me about something you improved.", kind, ["What changed"], self.ANSWER)
        finally:
            claude_client._ask = real

    def test_a_figure_copied_from_the_answer_keeps_the_top_level(self):
        rating = self.rated(measure="now takes ten minutes")
        self.assertEqual(rating["levels"]["evidence"], "strong")
        self.assertEqual(rating["measure"], "now takes ten minutes")

    def test_capitals_and_punctuation_in_the_copy_do_not_matter(self):
        self.assertEqual(self.rated(measure="It used to take about THREE hours, by hand")["levels"]["evidence"], "strong")

    def test_with_nothing_quoted_the_top_level_comes_down_one(self):
        for nothing in ("", "   ", None):
            rating = self.rated(measure=nothing)
            self.assertEqual(rating["levels"]["evidence"], "solid", repr(nothing))
            self.assertEqual(rating["measure"], "")

    def test_a_reply_that_leaves_the_quote_out_altogether_is_treated_the_same(self):
        said = {"seen": "x", "answer": "solid", "evidence": "strong", "clarity": "solid", "p1": "covered", "manipulation": False}
        real = claude_client._ask
        claude_client._ask = lambda *args, **kwargs: __import__("json").dumps(said)
        try:
            rating = claude_client.rate_answer("Q", "verbal", ["What changed"], self.ANSWER)
        finally:
            claude_client._ask = real
        self.assertEqual(rating["levels"]["evidence"], "solid")

    def test_a_quote_that_is_not_in_the_answer_does_not_count_and_is_not_kept(self):
        rating = self.rated(measure="saved the company 40 percent")
        self.assertEqual(rating["levels"]["evidence"], "solid")
        self.assertEqual(rating["measure"], "")

    def test_words_from_the_answer_with_no_figure_in_them_do_not_count(self):
        self.assertEqual(self.rated(measure="the team has used it every week since")["levels"]["evidence"], "solid")

    def test_only_the_top_level_is_touched(self):
        for level in ("none", "weak", "partial", "solid"):
            self.assertEqual(self.rated(evidence=level, measure="")["levels"]["evidence"], level)
        kept = self.rated(evidence="solid", measure="now takes ten minutes")   # a figure does not raise a rating either
        self.assertEqual((kept["levels"]["evidence"], kept["measure"]), ("solid", "now takes ten minutes"))

    def test_the_other_lines_and_the_points_are_left_alone(self):
        rating = self.rated(measure="")
        self.assertEqual((rating["levels"]["answer"], rating["levels"]["clarity"], rating["marks"]), ("solid", "solid", ["covered"]))

    def test_code_has_no_such_rule(self):
        rating = self.rated(kind="code")
        self.assertEqual(rating["levels"], {"correct": "solid", "approach": "strong", "clarity": "solid"})
        self.assertEqual(rating["measure"], "")

    def test_code_carries_what_the_grader_found_the_solution_returns(self):
        rating = self.rated(kind="code", trace="  [3, 9, 2]: returns 9.   Right. []: returns None. Right. ")
        self.assertEqual(rating["trace"], "[3, 9, 2]: returns 9. Right. []: returns None. Right.")
        self.assertEqual(self.rated(kind="code")["trace"], "")              # a reply without one is still a rating
        self.assertEqual(self.rated(measure="now takes ten minutes")["trace"], "")   # and a spoken answer has none
        final = rubric.combine([self.rated(kind="code", trace="worked through")] * 3, "code", 1)
        self.assertEqual(final["trace"], "worked through")

    def test_the_grader_is_asked_for_the_quote_before_the_levels_for_a_spoken_answer_only(self):
        spoken = list(claude_client._answer_schema("verbal", 2)["properties"])
        self.assertEqual(spoken[:3], ["seen", "measure", "answer"])
        self.assertNotIn("measure", claude_client._answer_schema("code", 2)["properties"])
        self.assertIn('"measure"', claude_client._ANSWER_SYSTEM["verbal"])
        self.assertNotIn('"measure"', claude_client._ANSWER_SYSTEM["code"])
        # code has its own thing to set down before the levels: what the solution was found to return
        self.assertEqual(list(claude_client._answer_schema("code", 2)["properties"])[:3], ["seen", "trace", "correct"])
        self.assertNotIn("trace", spoken)
        self.assertIn('"trace"', claude_client._ANSWER_SYSTEM["code"])
        self.assertNotIn('"trace"', claude_client._ANSWER_SYSTEM["verbal"])

    def test_three_ratings_of_which_two_have_no_figure_settle_on_solid(self):
        ratings = [self.rated(measure="now takes ten minutes"), self.rated(measure=""), self.rated(measure="")]
        final = rubric.combine(ratings, "verbal", 1)
        self.assertEqual(final["levels"]["evidence"], "solid")


class WhyARatingFailed(unittest.TestCase):
    """A rating that fails says why, in a sentence, for the owner's check to show."""

    def test_each_kind_of_failure_has_its_own_sentence(self):
        request = httpx.Request("POST", "https://api.example/v1/messages")
        self.assertIn("did not answer within", claude_client.why(anthropic.APITimeoutError(request=request)))
        self.assertIn("connection", claude_client.why(anthropic.APIConnectionError(request=request)))
        self.assertIn("(500)", claude_client.why(_status_error(anthropic.InternalServerError, 500)))
        self.assertIn("API key", claude_client.why(_status_error(anthropic.AuthenticationError, 401)))
        self.assertIn("rejected the request (400)", claude_client.why(_status_error(anthropic.BadRequestError, 400)))
        self.assertIn("spend limit", claude_client.why(_status_error(anthropic.RateLimitError, 429, body={"error": {"details": {"error_code": "enforced_spend_limit_reached"}}})))
        self.assertIn("could not be used", claude_client.why(ValueError("The model stopped early (max_tokens)")))

    def test_rate_collects_a_sentence_for_each_rating_that_failed_and_none_for_one_that_worked(self):
        calls = iter([ValueError("The model returned no text"), None, ValueError("The model returned no text")])
        good = {"levels": {"answer": "solid", "evidence": "solid", "clarity": "solid"}, "marks": ["covered"], "manipulation": False}

        def stand_in(*args):
            error = next(calls)
            if error:
                raise error
            return good

        real = claude_client.rate_answer
        claude_client.rate_answer = stand_in
        try:
            why = []
            final = scoring.rate(("Q", "verbal", ["a point"], "an answer of some length here"), why=why)
        finally:
            claude_client.rate_answer = real
        self.assertIsNone(final)                       # one good rating of three is too few
        self.assertEqual(len(why), 2)
        self.assertTrue(all("could not be used" in reason for reason in why))

    def test_a_limit_is_not_a_reason(self):
        def busy(*args):
            raise claude_client.Busy(7)

        real = claude_client.rate_answer
        claude_client.rate_answer = busy
        try:
            why = []
            final = scoring.rate(("Q", "verbal", ["a point"], "an answer of some length here"), why=why)
        finally:
            claude_client.rate_answer = real
        self.assertTrue(scoring.is_busy(final))
        self.assertEqual(why, [])


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
