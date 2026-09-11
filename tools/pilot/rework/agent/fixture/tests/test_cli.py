import os
import subprocess
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def run(*args):
    env = dict(os.environ, PYTHONPATH=os.path.join(ROOT, "src"))
    return subprocess.run([sys.executable, "-m", "textkit", *args], capture_output=True, text=True, env=env)


class CliTest(unittest.TestCase):
    def test_version(self):
        proc = run("version")
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(proc.stdout.strip(), "0.3.0")


if __name__ == "__main__":
    unittest.main()
