"""Command line entry point: python3 -m textkit <command> [...]."""

import argparse
import sys

from textkit import __version__


def build_parser():
    parser = argparse.ArgumentParser(prog="textkit")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("version", help="print the textkit version")
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    if args.command == "version":
        print(__version__)
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
