// Process-local handoff between the launch gate and the server it starts in the same process.
//
// The gate decides whether this worktree may serve and, for a worktree inherited from an enabled
// project, what would have to be written the first time a call actually mutates. The server picks
// that up here and passes it to `beforeFirstMutation`. Nothing is written by registering it.

let pending = null;

export function setPendingSelection(materialize) {
  pending = materialize ?? null;
}

/** Take the registered materialiser, if any. Taking it does not run it. */
export function takePendingSelection() {
  const value = pending;
  pending = null;
  return value;
}
