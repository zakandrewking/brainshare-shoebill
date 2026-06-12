// Version snapshots let the user revert an answer after editing or
// regenerating. History is bounded and edit snapshots are coalesced —
// autosave PATCHes land every keystroke-pause, and one checkpoint per pause
// would be noise (the editor's own undo covers fine grain within a session).

export const MAX_VERSIONS = 20;
export const EDIT_SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000;

/** The operation that displaced the snapshotted state. */
export type VersionKind = "edit" | "regenerate" | "revert";

export type AnswerVersion = {
  kind: VersionKind;
  aiText: string;
  currentText: string;
  provider: string;
  model: string;
  /** When the snapshotted state was last the live one. */
  stateUpdatedAt: Date;
  /** When the snapshot was taken. */
  capturedAt: Date;
};

/**
 * Whether a PATCH (edit) should snapshot the pre-edit state. Regenerate and
 * revert always snapshot; edits only start a new checkpoint when the previous
 * one is old enough (or the last snapshot came from a different operation —
 * e.g. the state right after a regenerate exists nowhere else once edits
 * land).
 */
export function shouldSnapshotBeforeEdit(
  versions: Pick<AnswerVersion, "kind" | "capturedAt">[] | undefined,
  now: Date,
): boolean {
  const last = versions?.[versions.length - 1];
  if (!last || last.kind !== "edit") {
    return true;
  }
  return (
    now.getTime() - new Date(last.capturedAt).getTime() >=
    EDIT_SNAPSHOT_INTERVAL_MS
  );
}
