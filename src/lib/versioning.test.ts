import { describe, expect, it } from "vitest";

import {
  EDIT_SNAPSHOT_INTERVAL_MS,
  shouldSnapshotBeforeEdit,
} from "@/lib/versioning";

const now = new Date("2026-06-12T12:00:00Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60 * 1000);

describe("shouldSnapshotBeforeEdit", () => {
  it("snapshots the first edit (no history)", () => {
    expect(shouldSnapshotBeforeEdit(undefined, now)).toBe(true);
    expect(shouldSnapshotBeforeEdit([], now)).toBe(true);
  });

  it("coalesces edits within the checkpoint interval", () => {
    expect(
      shouldSnapshotBeforeEdit([{ kind: "edit", capturedAt: minutesAgo(2) }], now),
    ).toBe(false);
  });

  it("starts a new checkpoint after the interval", () => {
    const old = new Date(now.getTime() - EDIT_SNAPSHOT_INTERVAL_MS);
    expect(
      shouldSnapshotBeforeEdit([{ kind: "edit", capturedAt: old }], now),
    ).toBe(true);
  });

  it("always snapshots when the last version came from another operation", () => {
    // The post-regenerate state exists nowhere else once edits land.
    expect(
      shouldSnapshotBeforeEdit(
        [{ kind: "regenerate", capturedAt: minutesAgo(0) }],
        now,
      ),
    ).toBe(true);
    expect(
      shouldSnapshotBeforeEdit(
        [{ kind: "revert", capturedAt: minutesAgo(0) }],
        now,
      ),
    ).toBe(true);
  });

  it("considers only the most recent version", () => {
    expect(
      shouldSnapshotBeforeEdit(
        [
          { kind: "regenerate", capturedAt: minutesAgo(60) },
          { kind: "edit", capturedAt: minutesAgo(1) },
        ],
        now,
      ),
    ).toBe(false);
  });
});
