# Pilot tools

Operator tooling for human-run pilots of the bridge feature loop: a real Codex manager (Astra) and
Claude Code as executor. Nothing here starts a model by itself. The only paid step is the pilot the
operator runs by hand, following a scenario's `OPERATOR.md`.

| Path | Audience | Contents |
|---|---|---|
| `common/` | Operator | Codex launcher (`astra.sh`, `codex_args.py`, `notify.sh`), MCP handshake, shared evidence collector (`collect.py`), hidden owner-case runner (`check_cases.py`), setup helpers |
| `rework/agent/` | Agents | Repository template and product-owner cases copied into a run; the start order template |
| `rework/operator/` | Operator | Setup, preflight, controlled intervention, collector, reference implementation, expected flow, dry run with a scripted `claude` stand-in |
| `rework/OPERATOR.md`, `rework/PLAN.md` | Operator | How to run the correction test and what it measures |
| `tests/` | CI | Synthetic regression tests and the tooling dry run |

Keep operator material out of agent inputs. A run directory is created outside this checkout
(`setup_rework.py --dest`). Only `repo/`, `acceptance-owner/`, `exchange/` and `START-ASTRA.txt`
are meant for the agents. Evidence goes to `<run>/operator-results/`. Nothing under a run directory
belongs in version control: bridge databases, transcripts, packages and user answers stay local.

## Tests

```sh
npm ci --ignore-scripts && npm run build
python3 -m unittest discover -s tools/pilot/tests -v
```

The dry run (`tests/test_portable.py`) drives this checkout's real bridge with a scripted executor
and a synthetic Codex rollout in a temporary directory. It checks that every mechanical criterion
can be produced end to end. It says nothing about model behaviour. Set `PILOT_SKIP_DRYRUN=1` to
skip it.

## Evidence rules

- Commits are bound to rounds by the package range each executor deliverable declares, in the git
  graph; commit times are never used for that.
- Every completed round needs its own linked, matching and verified package.
- Channel checks require a complete executor transcript. Missing or ambiguous evidence is `INFRA`,
  and a scenario precondition that did not occur is `NOT_TESTED`; neither is reported as `PASS`.
- The collectors never call bridge tools, start agents or judge review quality.
