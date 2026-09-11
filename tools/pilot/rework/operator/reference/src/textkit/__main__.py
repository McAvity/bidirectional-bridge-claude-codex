import argparse
import sys

from textkit import __version__
from textkit.duration import format_duration, parse_duration


def main(argv=None):
    parser = argparse.ArgumentParser(prog="textkit")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("version")
    dur = commands.add_parser("duration")
    dur.add_argument("--style", choices=["compact", "clock"], default="compact")
    dur.add_argument("text")
    args = parser.parse_args(argv)
    if args.command == "version":
        print(__version__)
        return 0
    try:
        print(format_duration(parse_duration(args.text), args.style))
    except ValueError as exc:
        print(exc, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
