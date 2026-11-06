# W19-01 workflow-versioning probes and contract fixtures

Operator/research tools for [F-W19](../../../docs/features/F-W19-workflow-versioning/brief.md),
contract [01-workflow-binding.md](../../../docs/features/F-W19-workflow-versioning/contracts/01-workflow-binding.md).
Not product code and not loaded by the bridge runtime.

| File | Purpose | Needs |
| --- | --- | --- |
| `contract_model.py` | Executable reference semantics of the contract (identity, bundle verification, store, lock, draft→ID, compatibility, bind/attempt, switch with crash points, legacy, resolve table) | Python 3.11+ |
| `contract_fixtures.py` | Generates `fixtures/` from synthetic inputs; `--check` regenerates and compares byte-for-byte | Python 3.11+ |
| `fixtures/cases.json` | Every scenario with its AC and verdict; `fixtures/examples/` one example per format | — |
| `test_contract.py` | Host-free tests: reproduction, expected verdicts, AC coverage, no machine paths | Python 3.11+ |
| `probe_clients.py`, `w19lib.py` | Model-free probes of the installed Claude Code and Codex CLIs (isolation, effective paths, auth status, active entry, same-session resume, MCP env forwarding) | `claude`, `codex`, `node`, `git` |

```sh
python3 tools/pilot/workflow-versioning/contract_fixtures.py --check
python3 -m unittest discover -s tools/pilot/workflow-versioning -v
python3 tools/pilot/workflow-versioning/probe_clients.py --out <file>.json
```

## Guarantees of the client probe

- **No inference.** Claude Code talks to a local capturing stub (`ANTHROPIC_BASE_URL`, HTTP 400);
  every result frame must report zero cost and tokens. Codex uses a provider whose `base_url` is
  the same kind of local stub; every turn must fail with the stub's own error code. The stub
  stores the request body (the model-visible input) and forwards nothing.
- **Isolation.** `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, marketplaces, projects and a bridge-home
  live under `~/tmp/w19-01-probes/<run>` (or `$W19_PROBE_ROOT`). `probe_lib.assert_isolated`
  refuses the personal profiles; size/mtime of their plugin/config files are compared before and
  after (content is never read).
- **No credentials.** Login is never attempted and nothing is copied; only `auth status` /
  `login status` and help texts are read. A logged-out isolated profile is reported as a named
  pilot prerequisite, not worked around.
- **Evidence.** Output is redacted (`<home>`, `<run>`, native ids replaced by short digests).
  Raw request captures and debug logs stay in the run root, outside Git. A `false` finding is a
  recorded client limitation; exit 2 means a model-free guarantee failed.

The probes show what a client *presents* to a model after install, update and resume. Whether a
model follows the new instructions is not observable here; that is W19-06 pilot evidence.
