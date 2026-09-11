"""Rate helpers built on the shared unit table."""

from textkit.units import UNIT_SECONDS


def per_second(amount, unit):
    """Convert an amount per `unit` into an amount per second."""
    if unit not in UNIT_SECONDS:
        raise ValueError(f"unknown unit: {unit!r}")
    return amount / UNIT_SECONDS[unit]
