import unittest
from tags import normalize_tags

class TagTests(unittest.TestCase):
    def test_public_example(self):
        self.assertEqual(normalize_tags([" A ", "", "B", "A"]), ["A", "B"])

    def test_empty_input(self):
        self.assertEqual(normalize_tags([]), [])

    def test_all_whitespace_values(self):
        self.assertEqual(normalize_tags(["", " ", "\t", "\n  "]), [])

    def test_stable_order(self):
        self.assertEqual(normalize_tags(["c", " b", "a "]), ["c", "b", "a"])

    def test_nonconsecutive_duplicates(self):
        self.assertEqual(normalize_tags(["x", "y", " x ", "z", "y"]), ["x", "y", "z"])

    def test_case_sensitive(self):
        self.assertEqual(normalize_tags(["A", "a", " A"]), ["A", "a"])

    def test_input_unchanged_and_new_list_returned(self):
        original = [" A ", "", "B", "A"]
        snapshot = list(original)
        result = normalize_tags(original)
        self.assertEqual(original, snapshot)
        self.assertIsNot(result, original)
        # Already-normalized input must still yield a distinct list.
        clean = ["x", "y"]
        clean_result = normalize_tags(clean)
        self.assertEqual(clean_result, clean)
        self.assertIsNot(clean_result, clean)
