"""Reference (operator-only) implementation used to validate owner acceptance cases."""
import re
from decimal import Decimal

from textkit.units import to_seconds

TOKEN = re.compile(r"\s*(\d+(?:\.\d+)?)([a-zA-Z]+)\s*")


def parse_duration(text):
    if not isinstance(text, str) or not text.strip():
        raise ValueError(f"invalid duration: {text!r}")
    pos, seen, total = 0, set(), 0
    while pos < len(text):
        m = TOKEN.match(text, pos)
        if not m:
            raise ValueError(f"invalid duration: {text!r}")
        num, unit = m.group(1), m.group(2).lower()
        if unit not in ("s", "m", "h", "d", "w") or unit in seen:
            raise ValueError(f"invalid duration: {text!r}")
        if "." in num and (unit in ("s", "m") or len(num.split(".")[1]) > 2):
            raise ValueError(f"invalid duration: {text!r}")
        seen.add(unit)
        total += to_seconds(Decimal(num), unit)
        pos = m.end()
    return total


def format_duration(seconds, style="compact"):
    if not isinstance(seconds, int) or seconds < 0:
        raise ValueError(f"invalid seconds: {seconds!r}")
    if style == "clock":
        return f"{seconds // 3600:02d}:{seconds % 3600 // 60:02d}:{seconds % 60:02d}"
    parts, rest = [], seconds
    for unit, size in (("d", 86400), ("h", 3600), ("m", 60), ("s", 1)):
        count, rest = divmod(rest, size)
        if count:
            parts.append(f"{count}{unit}")
    return " ".join(parts) or "0s"
