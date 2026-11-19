"""The answers of known quality the scoring check grades (reference_answers.py): that the set hangs
together, and that the code answers do what their labels say. No network. Run with

    python -m unittest discover -s tests

from the backend folder.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import reference_answers as reference  # noqa: E402
import rubric  # noqa: E402


def run_code(case_id):
    """The function a code answer defines. Everything after the first blank line is the candidate's explanation."""
    scope = {}
    exec(reference.BY_ID[case_id]["answer"].split("\n\n")[0], scope)  # noqa: S102  (our own reference answers, nothing from outside)
    return scope["first_unique"]


class TheSet(unittest.TestCase):
    def test_every_answer_has_its_own_name_and_a_band(self):
        names = [case["id"] for case in reference.CASES]
        self.assertEqual(len(names), len(set(names)))
        self.assertEqual(len({case["label"] for case in reference.CASES}), len(names))
        for case in reference.CASES:
            low, high = case["band"]
            self.assertTrue(0 <= low <= high <= 100, case["id"])

    def test_only_the_blank_answer_is_too_short_to_be_sent(self):
        unsent = [case["id"] for case in reference.CASES if rubric.is_blank(case["answer"], case["question_type"])]
        self.assertEqual(unsent, ["blank"])

    def test_the_question_about_working_with_others_comes_word_for_word_from_the_interviews_own_bank(self):
        from question_bank import GENERAL_QUESTIONS

        asked = {question["text"] for question in GENERAL_QUESTIONS}
        self.assertIn(reference.TEAM["question"], asked)

    def test_each_ladder_is_one_question_best_answer_first(self):
        self.assertEqual(len(reference.LADDERS), 4)
        for ladder in reference.LADDERS:
            steps = [reference.BY_ID[name] for name in ladder]
            self.assertEqual(len(steps), 5, ladder)
            self.assertEqual(len({step["question"] for step in steps}), 1, ladder)
            # a better answer's band never sits below a worse one's, at either end
            for better, worse in zip(steps, steps[1:]):
                self.assertGreaterEqual(better["band"][0], worse["band"][0], (better["id"], worse["id"]))
                self.assertGreaterEqual(better["band"][1], worse["band"][1], (better["id"], worse["id"]))

    def test_every_spoken_question_has_a_strong_a_good_a_sound_a_thin_and_an_off_subject_answer(self):
        for prefix in ("team", "testing", "campaign"):
            ladder = next(ladder for ladder in reference.LADDERS if ladder[0].startswith(prefix))
            self.assertEqual([name.split("-", 1)[1] for name in ladder], ["strong", "good", "sound", "thin", "off"])


class TheCodeAnswers(unittest.TestCase):
    """The scoring check asks the grader whether these work. Here they are simply run."""

    CASES = {"swiss": "w", "aabbc": "c", "abcabcd": "d", "aabb": None, "": None, "x": "x"}

    def test_the_strong_and_the_sound_answers_are_right_every_time(self):
        for name in ("unique-strong", "unique-sound"):
            solve = run_code(name)
            for text, wanted in self.CASES.items():
                self.assertEqual(solve(text), wanted, (name, text))

    def test_the_answer_that_misses_a_case_is_right_only_when_some_character_appears_once(self):
        solve = run_code("unique-misses")
        for text, wanted in self.CASES.items():
            if wanted is not None:
                self.assertEqual(solve(text), wanted, text)
        for nothing_qualifies in ("aabb", ""):        # the question asks for None in both
            with self.assertRaises(IndexError):
                solve(nothing_qualifies)

    def test_the_answer_that_leans_on_dictionary_order_is_right_whenever_some_character_appears_once(self):
        # What the live grader doubted on 18 November 2026: in Python the first of several equal items is the one
        # min() returns, and a dictionary keeps its keys in the order they were added.
        solve = run_code("unique-order")
        for text, wanted in self.CASES.items():
            if wanted is not None:
                self.assertEqual(solve(text), wanted, text)
        for text, wanted in {"xaybx": "a", "zzabcabd": "c", "teeter": "r", "stress": "t", "aabbcdd": "c", "abcdefghijklmnopqrstuvwxyza": "b"}.items():
            self.assertEqual(solve(text), wanted, text)
        self.assertEqual(solve("aabb"), "a")          # the question asks for None here
        with self.assertRaises(ValueError):           # and for None here
            solve("")

    def test_the_answer_with_a_bug_is_wrong_on_the_main_case(self):
        solve = run_code("unique-bug")
        self.assertEqual(solve("swiss"), "s")         # the first character, whether or not it repeats
        self.assertEqual(solve("aabbc"), "a")


if __name__ == "__main__":
    unittest.main()
