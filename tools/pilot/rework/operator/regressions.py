"""Controlled test intervention for the rework test (operator-only; never shown to agents).

The intervention is a regression committed by a separate, clearly non-agent git identity
(`pilot-teammate`) to the shared helper `src/textkit/units.py`, after the executor's first
delivery has been reviewed and before the integration re-check. It replaces only the body of
`to_seconds` with float arithmetic, which truncates some exact decimal inputs (4.1 h → 14759 s).
The commit message states the change truthfully; it does not say that it breaks anything.
"""
import ast

TEAMMATE = ('pilot-teammate', 'pilot-teammate@pilot.invalid')
TARGET = 'src/textkit/units.py'
FUNCTION = 'to_seconds'
COMMIT_MESSAGE = 'perf(units): compute to_seconds with float arithmetic\n\n' \
                 'Fractions are slow on the rates hot path; floats are enough for whole seconds.\n'
REGRESSED = '''def to_seconds(value, unit):
    """Convert `value` expressed in `unit` to whole seconds.

    Accepts int, float, Decimal or numeric strings. Uses float arithmetic (faster than exact
    fractions on the rates hot path); any fraction of a second is truncated.
    """
    try:
        factor = UNIT_SECONDS[unit]
    except KeyError:
        raise ValueError(f"unknown unit: {unit!r}") from None
    return int(float(value) * factor)
'''


def apply(source):
    """Return `source` with the top-level `to_seconds` replaced by REGRESSED. Raises ValueError
    when the function is missing or the module does not define UNIT_SECONDS (not applicable)."""
    tree = ast.parse(source)
    names = {t.id for node in tree.body if isinstance(node, ast.Assign) for t in node.targets if isinstance(t, ast.Name)}
    if 'UNIT_SECONDS' not in names:
        raise ValueError('units.py no longer defines UNIT_SECONDS; intervention not applicable')
    fn = next((n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == FUNCTION), None)
    if fn is None:
        raise ValueError(f'units.py has no top-level {FUNCTION}; intervention not applicable')
    start = (fn.decorator_list[0].lineno if fn.decorator_list else fn.lineno) - 1
    lines = source.splitlines(keepends=True)
    out = ''.join(lines[:start]) + REGRESSED + ''.join(lines[fn.end_lineno:])
    ast.parse(out)
    return out
