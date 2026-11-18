"""The sums behind every score. No model, no database, no network: run with

    python -m unittest discover -s tests

from the backend folder.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import rubric  # noqa: E402

POINTS = ["first point", "second point", "third point", "fourth point"]


def card(levels, marks, kind="verbal"):
    return rubric.scorecard(kind, levels, marks, POINTS[: len(marks)])


def verbal(answer, evidence, clarity):
    return {"answer": answer, "evidence": evidence, "clarity": clarity}


class Weights(unittest.TestCase):
    def test_each_scorecard_adds_up_to_one_hundred(self):
        for lines in (rubric.VERBAL, rubric.CODE):
            self.assertAlmostEqual(sum(line["weight"] for line in lines), 1.0)

    def test_the_match_score_adds_up_to_one_hundred(self):
        self.assertAlmostEqual(sum(rubric.WEIGHTS.values()), 1.0)
        self.assertEqual(rubric.composite(100, 100, 100, 100), 100.0)
        self.assertEqual(rubric.composite(50, 80, 100, 0), round(50 * 0.40 + 80 * 0.35 + 100 * 0.10, 1))

    def test_every_level_has_a_description(self):
        for lines in (rubric.VERBAL, rubric.CODE):
            for line in lines:
                if line["key"] != rubric.POINTS_KEY:
                    self.assertEqual(set(line["levels"]), set(rubric.LEVELS))
            self.assertEqual(sum(1 for line in lines if line.get("gate")), 1)


class OneAnswer(unittest.TestCase):
    def test_the_best_answer_scores_one_hundred(self):
        self.assertEqual(card(verbal("strong", "strong", "strong"), ["covered"] * 4)["score"], 100.0)

    def test_solid_on_every_line(self):
        # 75 x 0.20 + 75 x 0.30 + 100 x 0.35 x (3.5 / 4) + 75 x 0.15
        got = card(verbal("solid", "solid", "solid"), ["covered", "covered", "covered", "partly"])
        self.assertEqual(got["score"], 79.4)
        self.assertEqual(sum(line["earned"] for line in got["lines"]), 79.4)
        self.assertEqual(sum(line["worth"] for line in got["lines"]), 100.0)

    def test_a_thin_answer_scores_low(self):
        got = card(verbal("partial", "weak", "partial"), ["partly", "missing", "missing", "missing"])
        self.assertEqual(got["score"], round(50 * 0.20 + 25 * 0.30 + 100 * 0.35 * 0.125 + 50 * 0.15, 1))
        self.assertLess(got["score"], 35)

    def test_not_an_answer_scores_nothing_however_well_put(self):
        got = card(verbal("none", "strong", "strong"), ["covered"] * 4)
        self.assertEqual(got["score"], 0.0)
        self.assertEqual(got["cap"], "none")
        self.assertFalse(got["answered"])
        self.assertEqual(sum(line["earned"] for line in got["lines"]), 0.0)   # the lines still add up to the score
        self.assertEqual(got["lines"][1]["level"], "strong")                  # and still say what was seen

    def test_on_the_subject_but_not_an_answer_is_capped(self):
        got = card(verbal("weak", "strong", "strong"), ["covered"] * 4)
        self.assertEqual(got["score"], rubric.CAP_WHEN_WEAK)
        self.assertEqual(got["cap"], "weak")
        self.assertTrue(got["answered"])
        low = card(verbal("weak", "none", "weak"), ["missing"] * 4)
        self.assertEqual(low["score"], round(25 * 0.20 + 25 * 0.15, 1))   # below the cap: left alone
        self.assertIsNone(low["cap"])

    def test_code_uses_its_own_card(self):
        got = card({"correct": "solid", "approach": "partial", "clarity": "solid"}, ["covered", "covered", "missing"], kind="code")
        self.assertEqual(got["score"], round(75 * 0.40 + 50 * 0.20 + 100 * 0.20 * (2 / 3) + 75 * 0.20, 1))
        self.assertEqual(card({"correct": "none", "approach": "strong", "clarity": "strong"}, ["covered"] * 3, kind="code")["score"], 0.0)

    def test_a_question_with_no_points_shares_that_weight_out(self):
        got = card(verbal("solid", "solid", "solid"), [])
        self.assertEqual(got["score"], 75.0)
        self.assertEqual(sum(line["worth"] for line in got["lines"]), 100.0)

    def test_a_longer_answer_is_not_a_better_one(self):
        # the sums are never given the answer, only the levels picked for it: its length cannot count
        import inspect
        self.assertEqual(list(inspect.signature(rubric.scorecard).parameters), ["question_type", "levels", "marks", "key_points"])

    def test_too_short_to_be_an_answer(self):
        self.assertTrue(rubric.is_blank("", "verbal"))
        self.assertTrue(rubric.is_blank("I do not know", "verbal"))
        self.assertFalse(rubric.is_blank("I would start by measuring it", "verbal"))
        self.assertTrue(rubric.is_blank("  x = 1 ", "code"))
        self.assertFalse(rubric.is_blank("return s[::-1]", "code"))


class SeveralRatings(unittest.TestCase):
    def rating(self, answer, evidence, clarity, marks, manipulation=False):
        return {"levels": verbal(answer, evidence, clarity), "marks": marks, "manipulation": manipulation, "seen": "", "strength": "", "improve": ""}

    def test_the_middle_rating_is_kept_on_every_line(self):
        final = rubric.combine([
            self.rating("solid", "partial", "strong", ["covered", "partly"]),
            self.rating("solid", "solid", "solid", ["covered", "missing"]),
            self.rating("partial", "solid", "solid", ["partly", "partly"]),
        ], "verbal", 2)
        self.assertEqual(final["levels"], verbal("solid", "solid", "solid"))
        self.assertEqual(final["marks"], ["covered", "partly"])
        self.assertEqual(final["samples"], 3)

    def test_two_ratings_that_disagree_give_the_lower(self):
        final = rubric.combine([self.rating("solid", "solid", "solid", ["covered"]), self.rating("partial", "strong", "solid", ["partly"])], "verbal", 1)
        self.assertEqual(final["levels"], verbal("partial", "solid", "solid"))
        self.assertEqual(final["marks"], ["partly"])

    def test_the_order_the_ratings_arrive_in_does_not_matter(self):
        ratings = [
            self.rating("solid", "weak", "strong", ["covered", "partly", "missing"]),
            self.rating("partial", "partial", "solid", ["partly", "partly", "covered"]),
            self.rating("strong", "solid", "partial", ["covered", "missing", "partly"]),
        ]
        import itertools
        seen = {str((rubric.combine(list(order), "verbal", 3)["levels"], rubric.combine(list(order), "verbal", 3)["marks"])) for order in itertools.permutations(ratings)}
        self.assertEqual(len(seen), 1)

    def test_instructions_to_the_grader_need_most_ratings_to_say_so(self):
        flag = lambda *flags: rubric.combine([self.rating("solid", "solid", "solid", [], f) for f in flags], "verbal", 0)["manipulation"]
        self.assertTrue(flag(True, True, False))
        self.assertFalse(flag(True, False, False))

    def test_full_agreement_is_reported_as_one(self):
        same = [self.rating("solid", "solid", "solid", ["covered"])] * 3
        self.assertEqual(rubric.combine(same, "verbal", 1)["agreement"], 1.0)


class Fingerprints(unittest.TestCase):
    Q = "Tell me about a time you worked with other people."

    def key(self, answer, kind="verbal", question=None, points=("a", "b")):
        return rubric.answer_key(question or self.Q, kind, list(points), answer)

    def test_the_same_answer_has_the_same_fingerprint(self):
        self.assertEqual(self.key("I led the team and we shipped."), self.key("I led the team and we shipped."))

    def test_capitals_punctuation_and_spacing_do_not_matter_in_a_spoken_answer(self):
        self.assertEqual(self.key("I led the team, and we shipped!"), self.key("  i led the team and we   shipped "))
        self.assertEqual(self.key("We didn’t stop."), self.key("we didn't stop"))

    def test_a_different_word_is_a_different_answer(self):
        self.assertNotEqual(self.key("I led the team and we shipped."), self.key("I led the team and we slipped."))

    def test_marks_that_change_what_was_said_are_kept(self):
        self.assertEqual(self.key("It took 1.3 seconds."), self.key("it took 1.3 seconds"))
        self.assertNotEqual(self.key("It took 1.3 seconds."), self.key("It took 13 seconds."))
        self.assertNotEqual(self.key("It took 1.3 seconds."), self.key("It took 1 3 seconds."))
        self.assertEqual(len({self.key("I wrote it in C."), self.key("I wrote it in C++."), self.key("I wrote it in C#.")}), 3)
        self.assertNotEqual(self.key("Costs fell by 40%."), self.key("Costs fell by 40."))
        self.assertNotEqual(self.key("We saved $40."), self.key("We saved 40."))
        self.assertNotEqual(self.key("The answer is a + b."), self.key("The answer is a - b."))
        self.assertNotEqual(self.key("I chose a < b"), self.key("I chose a > b"))

    def test_quotes_brackets_and_dashes_around_words_do_not_matter(self):
        self.assertEqual(self.key('She said "ship it" (twice) \u2014 so we did.'), self.key("she said ship it twice so we did"))
        self.assertEqual(self.key("The team\u2019s plan\u2026"), self.key("the team's plan"))

    def test_the_question_and_its_points_are_part_of_it(self):
        self.assertNotEqual(self.key("I led the team."), self.key("I led the team.", question="Tell me about a setback."))
        self.assertNotEqual(self.key("I led the team."), self.key("I led the team.", points=("a", "c")))
        self.assertEqual(self.key("I led the team."), self.key("I led the team.", question="  tell me about a time you worked with other PEOPLE. "))

    def test_code_keeps_its_capitals_and_symbols(self):
        self.assertNotEqual(self.key("return A", "code"), self.key("return a", "code"))
        self.assertNotEqual(self.key("x = a - b", "code"), self.key("x = a + b", "code"))
        self.assertEqual(self.key("def f():\r\n    return 1   \r\n", "code"), self.key("def f():\n    return 1", "code"))
        self.assertNotEqual(self.key("if a:\n    b()\nc()", "code"), self.key("if a:\n    b()\n    c()", "code"))

    def test_a_new_version_of_the_rubric_starts_afresh(self):
        before = self.key("I led the team.")
        old = rubric.VERSION
        try:
            rubric.VERSION = old + "-next"
            self.assertNotEqual(before, self.key("I led the team."))
        finally:
            rubric.VERSION = old


class WholeInterview(unittest.TestCase):
    def test_every_question_counts_by_its_time(self):
        self.assertEqual(rubric.interview_score([(120, 100), (120, 0)]), 50.0)
        self.assertEqual(rubric.interview_score([(120, 100), (360, 0)]), 25.0)
        self.assertEqual(rubric.interview_score([(120, 60), (150, 80), (300, 40)]), round((120 * 60 + 150 * 80 + 300 * 40) / 570, 1))

    def test_a_skipped_question_is_a_zero_not_a_gap(self):
        answered_two_of_eight = [(150, 100), (150, 100)] + [(150, 0)] * 6
        self.assertEqual(rubric.interview_score(answered_two_of_eight), 25.0)

    def test_an_answer_that_could_not_be_graded_is_left_out(self):
        self.assertEqual(rubric.interview_score([(120, 80), (120, None)]), 80.0)
        self.assertEqual(rubric.interview_score([]), 0.0)

    def test_three_quarters_must_be_answered(self):
        self.assertTrue(rubric.completion(12, 16)["complete"])
        self.assertFalse(rubric.completion(11, 16)["complete"])
        self.assertEqual(rubric.completion(11, 16)["needed"], 12)
        self.assertTrue(rubric.completion(6, 8)["complete"])
        self.assertFalse(rubric.completion(2, 8)["complete"])
        self.assertEqual(rubric.completion(0, 6)["needed"], 5)   # three quarters of six, rounded up
        self.assertFalse(rubric.completion(0, 0)["complete"])

    def test_two_perfect_answers_out_of_eight_cannot_send_an_application(self):
        # the case this grading was rebuilt for: 2 of 8 answered had scored 47
        interview = rubric.interview_score([(150, 100), (150, 100)] + [(150, 0)] * 6)
        self.assertEqual(interview, 25.0)
        self.assertFalse(rubric.completion(2, 8)["complete"])


class Camera(unittest.TestCase):
    def test_on_camera_and_facing_the_screen_costs_nothing(self):
        self.assertEqual(rubric.presence(1800, 1790, 1760, 60, 0)["deduction"], 0.0)

    def test_time_off_camera_costs_up_to_ten(self):
        self.assertEqual(rubric.presence(1000, 1000, 950, 0, 0)["deduction"], 0.0)       # 5% is allowed
        self.assertEqual(rubric.presence(1000, 1000, 825, 0, 0)["deduction"], 5.0)       # 17.5% is half way to 30%
        self.assertEqual(rubric.presence(1000, 1000, 500, 0, 0)["deduction"], 10.0)

    def test_a_camera_that_was_not_running_counts_as_off_camera(self):
        self.assertEqual(rubric.presence(1000, 0, 0, 0, 0)["deduction"], 10.0)
        self.assertEqual(rubric.presence(1000, 400, 400, 0, 0)["off_camera"], 0.6)

    def test_looking_away_costs_up_to_ten(self):
        self.assertEqual(rubric.presence(1000, 1000, 1000, 100, 0)["deduction"], 0.0)    # 10% is allowed
        self.assertEqual(rubric.presence(1000, 1000, 1000, 250, 0)["deduction"], 5.0)
        self.assertEqual(rubric.presence(1000, 1000, 1000, 700, 0)["deduction"], 10.0)

    def test_a_second_person_costs_five(self):
        self.assertEqual(rubric.presence(1000, 1000, 1000, 0, 4)["deduction"], 0.0)
        got = rubric.presence(1000, 1000, 1000, 0, 30)
        self.assertEqual(got["deduction"], 5.0)
        self.assertEqual(got["lines"][0]["key"], "second_person")

    def test_the_most_the_camera_can_cost(self):
        self.assertEqual(rubric.presence(1000, 1000, 500, 500, 100)["deduction"], 25.0)

    def test_numbers_that_cannot_be_true_are_held_in_range(self):
        got = rubric.presence(100, 5000, 9000, 9000, -5)
        self.assertEqual(got["off_camera"], 0.0)
        self.assertEqual(got["looking_away"], 1.0)
        self.assertEqual(rubric.presence(0, 0, 0, 0, 0)["deduction"], 0.0)


class OneRole(unittest.TestCase):
    def test_relevance_is_half_fit_half_skills_shown(self):
        self.assertEqual(rubric.relevance_score("solid", ["shown", "mentioned", "absent", "absent"]), round(0.5 * 75 + 0.5 * 37.5, 1))
        self.assertEqual(rubric.relevance_score("solid", []), 75.0)   # a posting that lists no skills
        self.assertEqual(rubric.relevance_score("none", ["absent"] * 3), 0.0)

    def test_profile_skills_is_the_share_of_the_posting_s_skills_on_the_list(self):
        self.assertEqual(rubric.skills_score(None, ["listed", "related", "missing", "listed"]), 62.5)
        self.assertEqual(rubric.skills_score("partial", []), 50.0)
        self.assertEqual(rubric.skills_score(None, []), 0.0)

    def test_no_resume_scores_nothing(self):
        self.assertEqual(rubric.resume_score(None, []), 0.0)
        self.assertEqual(rubric.resume_score("strong", ["shown", "shown"]), 100.0)

    def test_fit_fingerprints(self):
        job = rubric.job_text("Backend Engineer", "Build APIs", "", ["Python", "SQL"])
        said = [("Q1", "verbal", "I built an API."), ("Q2", "code", "return 1")]
        self.assertEqual(rubric.answers_fit_key(job, said), rubric.answers_fit_key(job, [("q1", "verbal", "i built an api"), ("Q2", "code", "return 1")]))
        self.assertNotEqual(rubric.answers_fit_key(job, said), rubric.answers_fit_key(job, said[:1]))
        self.assertEqual(rubric.profile_fit_key(job, ["SQL", "python"], "My resume"), rubric.profile_fit_key(job, ["Python", "sql", "SQL"], "my   resume"))
        self.assertNotEqual(rubric.profile_fit_key(job, ["SQL"], ""), rubric.profile_fit_key(rubric.job_text("Backend Engineer", "Build APIs", "", ["Python"]), ["SQL"], ""))


if __name__ == "__main__":
    unittest.main()
