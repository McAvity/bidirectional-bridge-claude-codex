import { BridgeError, ErrorCode } from "@bridge/protocol";
import type { FeatureRecord, StateStore } from "./store/state-store.js";

export const featureTerminal = (f: FeatureRecord): boolean =>
  f.state === "accepted" || f.state === "rejected" || f.state === "cancelled";
export function assertFeatureOpen(f: FeatureRecord): void {
  if (featureTerminal(f)) throw new BridgeError(ErrorCode.FEATURE_CLOSED, "feature is terminal", {feature_id: f.feature_id, state: f.state});
}
/** Resolve durable ancestry, not dependency edges. Shared coordinator work remains usable. */
export function assertTaskFeatureOpen(store: StateStore, taskId: string): void {
  const closed = store.listFeatures().filter(f => f.state === "rejected" || f.state === "cancelled");
  if (!closed.length) return;
  const all = store.listFeatures();
  const roots = new Map<string, string>();
  for (const f of closed) {
    for (const id of f.task_ids) roots.set(id, f.feature_id);
    if (!all.some(other => other.feature_id !== f.feature_id && other.parent_task_id === f.parent_task_id && !featureTerminal(other)))
      roots.set(f.parent_task_id, f.feature_id);
  }
  const seen = new Set<string>();
  let id: string | null = taskId;
  while (id) {
    if (roots.has(id)) throw new BridgeError(ErrorCode.FEATURE_CLOSED, "task belongs to a closed feature", {task_id: taskId, feature_id: roots.get(id)});
    if (seen.has(id)) throw new BridgeError(ErrorCode.FEATURE_UNSETTLED, "cyclic task lineage");
    seen.add(id);
    const task = store.getTask(id);
    if (!task) throw new BridgeError(ErrorCode.FEATURE_UNSETTLED, "missing task lineage", {task_id: id});
    id = task.parent_task_id;
  }
}
