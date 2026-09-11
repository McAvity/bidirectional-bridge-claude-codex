"""Time units shared by textkit modules (rates, durations)."""

from fractions import Fraction

UNIT_SECONDS = {"s": 1, "m": 60, "h": 3600, "d": 86400, "w": 604800}


def to_seconds(value, unit):
    """Convert `value` expressed in `unit` to whole seconds.

    Accepts int, Decimal, Fraction or numeric strings. Arithmetic is exact (fractions), so
    decimal inputs convert without rounding error; a remaining fraction of a second is
    truncated.
    """
    try:
        factor = UNIT_SECONDS[unit]
    except KeyError:
        raise ValueError(f"unknown unit: {unit!r}") from None
    return int(Fraction(str(value)) * factor)
