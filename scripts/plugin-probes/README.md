# W14-01 host probes

Three model-free probes answering the wave14 feasibility questions against the
installed hosts. They are research instruments, not product code: nothing here
is loaded by the bridge runtime.

| Probe | Question |
| --- | --- |
| `probe_codex_mcp_cwd.py` | Does a Codex plugin MCP server receive the project/worktree directory (external worktrees, paths with spaces, launched from a subdirectory)? |
| `probe_claude_delegation.py` | Can a bridge-spawned `claude -p` load the pinned executor instruction set without a per-project or per-profile install? |
| `probe_plugin_cache_update.py` | Does refreshing the plugin cache preserve the runtime and instruction set a running feature is pinned to, across a client restart? |
| `probe_missing_runtime_startup.py` | Supplementary: does an inherited bridge MCP block whose launcher is missing stop a Codex session, so the setup skill could not run? (`codex exec` only) |

```sh
python3 scripts/plugin-probes/run_probes.py \
  --out-dir docs/features/F-W14-plugin-distribution/evidence/W14-01/results
```

## Guarantees

**No model runs.** A Codex probe session uses a provider whose `env_key` names a
variable the probe deliberately removes, so the first request fails locally after
MCP startup and nothing leaves the machine; `codex_turn_failed_without_request()`
asserts that. A Claude probe session points `ANTHROPIC_BASE_URL` at a local HTTP
stub that answers 400; `claude_spent_nothing()` asserts
`total_cost_usd == 0`, zero input/output tokens and `api_error_status == 400`
from the CLI's own result frame.

**No personal configuration is touched.** Every probe runs with `CODEX_HOME` /
`CLAUDE_CONFIG_DIR` inside a disposable run root (`~/tmp/w14-01-probes/...`, or
`$W14_PROBE_ROOT`). `probe_lib.assert_isolated()` aborts if any of those paths
would fall inside `~/.codex`, `~/.claude` or `~/.config/claude`. Marketplaces,
plugins, git repositories and worktrees are created inside the run root only.

**Results are evidence, not assertions.** Each probe prints one JSON object with
the raw per-case observations plus a `findings` block of derived booleans. A
`false` finding is a recorded host limitation, not a probe failure; the probe
exit code only reports whether the probe itself ran.

## Reading the results

`server_cwd`, `forwarded_env_names`, `initialize_params` and `mcp_methods` come
from `recorder_mcp.mjs`, a minimal MCP server that answers the handshake and
appends one JSON line per event. The record path is passed in `argv`, not the
environment, because Codex starts plugin MCP servers with a stripped environment.

`manager_skill_paths` comes from `codex debug prompt-input`, which renders the
model-visible prompt input as JSON without contacting a model.

Findings and interpretation:
[`docs/features/F-W14-plugin-distribution/evidence/W14-01/`](../../docs/features/F-W14-plugin-distribution/evidence/W14-01/).
