import unittest

from textkit.rates import per_second
from textkit.units import to_seconds


class UnitsTest(unittest.TestCase):
    def test_whole_and_simple_fractions(self):
        self.assertEqual(to_seconds(90, "s"), 90)
        self.assertEqual(to_seconds(1.5, "h"), 5400)
        self.assertEqual(to_seconds("0.25", "d"), 21600)
        self.assertEqual(to_seconds(2, "w"), 1209600)

    def test_unknown_unit(self):
        with self.assertRaises(ValueError):
            to_seconds(1, "y")

    def test_rates(self):
        self.assertEqual(per_second(3600, "h"), 1)


if __name__ == "__main__":
    unittest.main()
