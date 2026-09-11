"""Reference (operator-only): exact unit conversion."""
from decimal import Decimal

UNIT_SECONDS = {"s": 1, "m": 60, "h": 3600, "d": 86400, "w": 604800}


def to_seconds(value, unit):
    try:
        factor = UNIT_SECONDS[unit]
    except KeyError:
        raise ValueError(f"unknown unit: {unit!r}") from None
    return int(Decimal(str(value)) * factor)
