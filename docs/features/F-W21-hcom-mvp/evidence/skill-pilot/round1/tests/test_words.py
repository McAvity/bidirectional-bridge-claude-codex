import unittest
from words import unique_words

class WordsTests(unittest.TestCase):
    def test_example(self):
        self.assertEqual(unique_words("red blue red"), ["red", "blue"])

    def test_empty_input(self):
        self.assertEqual(unique_words(""), [])

    def test_whitespace_only_input(self):
        self.assertEqual(unique_words("  \t\n  "), [])

    def test_stable_order(self):
        self.assertEqual(unique_words("c a b"), ["c", "a", "b"])

    def test_separated_duplicates(self):
        self.assertEqual(
            unique_words("one two three one\tfour\ntwo five"),
            ["one", "two", "three", "four", "five"],
        )

    def test_case_sensitive(self):
        self.assertEqual(unique_words("Red red RED red"), ["Red", "red", "RED"])

if __name__ == "__main__":
    unittest.main()
