// The read boundary of the incident export (wave13 §3–§4, review R2-02 and R2-05).
//
// One place decides what the exporter is allowed to open and how much of it to read, so the
// rules are the same for the database, the logs and the evidence:
//
//  - **no link is ever followed.** Every path component below the worktree is checked with
//    `lstat`, and the final component is opened with `O_NOFOLLOW`. A directory or a file that is
//    a symlink is refused and reported, never read "because it looked like ours";
//  - **only regular files are read**, so a FIFO cannot make the exporter block and a device
//    cannot make it read forever;
//  - **reads are bounded and described.** A file is read from a declared offset for a declared
//    number of bytes, and the caller gets back the identity of what it actually read (device,
//    inode, size, mtime at open) so the manifest can say which prefix of which file it holds and
//    whether the file changed while the export ran.
//
// Nothing here writes, and nothing here follows a path found inside a record: callers pass paths
// they constructed from the worktree root, never paths read out of the state being exported.

import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

/** Why a path could not be read. These are the machine reasons a gap carries. */
export const UNSAFE = {
  SYMLINK: "symlink",
  NOT_REGULAR: "not_regular",
  NOT_DIRECTORY: "not_directory",
  OUTSIDE_ROOT: "outside_root",
  ABSENT: "absent",
  DENIED: "denied",
};

export class UnsafePathError extends Error {
  constructor(reason, path, code = null) {
    super(`${reason}: ${path}`);
    this.reason = reason;
    this.path = path;
    this.code = code;
  }
}

function errnoReason(error) {
  if (error?.code === "ENOENT") return UNSAFE.ABSENT;
  if (error?.code === "ELOOP") return UNSAFE.SYMLINK;
  if (error?.code === "ENOTDIR") return UNSAFE.NOT_DIRECTORY;
  return UNSAFE.DENIED;
}

/**
 * Walk `target` component by component below a **trusted anchor**, checking what already exists.
 *
 * This is the one pre-I/O check: it runs before a read *and* before the first `mkdir`, because a
 * recursive `mkdir` that runs first will happily create directories inside whatever a symlinked
 * ancestor points at — the hole review R2-02 reproduced through the exchange namespace. The
 * anchor is the deepest path the caller is entitled to trust (the resolved worktree root, the
 * user's own home); it is never itself inspected, everything below it is.
 *
 * Components that do not exist yet end the walk: their parents were checked, so creating them is
 * safe. Returns `{ path, existing, missing }` — the absolute target, the deepest component that
 * exists, and how many components below it are still missing.
 */
export function assertSafeDescent(anchor, target) {
  const base = resolve(anchor);
  const absolute = resolve(target);
  if (absolute !== base && !absolute.startsWith(`${base}${sep}`)) {
    throw new UnsafePathError(UNSAFE.OUTSIDE_ROOT, absolute);
  }
  const parts = relative(base, absolute).split(sep).filter((part) => part.length > 0);
  let cursor = base;
  let existing = base;
  let missing = 0;
  for (let index = 0; index < parts.length; index += 1) {
    cursor = join(cursor, parts[index]);
    if (missing > 0) {
      // Everything below the first absent component is absent too; nothing to check.
      missing += 1;
      continue;
    }
    let stat;
    try {
      stat = lstatSync(cursor);
    } catch (error) {
      if (error?.code === "ENOENT") {
        missing = 1;
        continue;
      }
      throw new UnsafePathError(errnoReason(error), cursor, error?.code ?? null);
    }
    if (stat.isSymbolicLink()) throw new UnsafePathError(UNSAFE.SYMLINK, cursor);
    const last = index === parts.length - 1;
    if (!last && !stat.isDirectory()) throw new UnsafePathError(UNSAFE.NOT_DIRECTORY, cursor);
    existing = cursor;
  }
  return { path: absolute, existing, missing };
}

/**
 * The same walk for something that must already be there: every component below `root` exists and
 * none of them is a link. Returns the absolute target.
 */
export function assertUnderRoot(root, target) {
  const descent = assertSafeDescent(root, target);
  if (descent.missing > 0) throw new UnsafePathError(UNSAFE.ABSENT, descent.path);
  return descent.path;
}

/** List a directory that must be a real directory below `root`. Entries are not followed. */
export function safeListDirectory(root, target) {
  const absolute = assertUnderRoot(root, target);
  try {
    return readdirSync(absolute, { withFileTypes: true });
  } catch (error) {
    throw new UnsafePathError(errnoReason(error), absolute, error?.code ?? null);
  }
}

/** Identity of an open file: what was actually read, not what the path points at now. */
function identityOf(stat) {
  return {
    device: Number(stat.dev),
    inode: Number(stat.ino),
    size: Number(stat.size),
    modified_at: Number(stat.mtimeMs),
  };
}

/** Current identity of a path without following links; `null` when it is gone or not a file. */
export function fileIdentity(path) {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile()) return null;
    return identityOf(stat);
  } catch {
    return null;
  }
}

/**
 * Read at most `maxBytes` of a regular file below `root`, without following any link.
 *
 * `from: "end"` reads the last `maxBytes` (the interesting part of an append-only log);
 * `from: "start"` reads the first `maxBytes`. The result says exactly which byte range of which
 * inode was read, so a package can describe its own cutoff instead of implying a whole file.
 */
export function readBounded(root, target, { maxBytes, from = "end" } = {}) {
  const absolute = assertUnderRoot(root, target);
  let fd;
  try {
    // O_NOFOLLOW makes the final component's link check atomic with the open itself.
    fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    throw new UnsafePathError(error?.code === "ELOOP" ? UNSAFE.SYMLINK : errnoReason(error), absolute, error?.code ?? null);
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new UnsafePathError(UNSAFE.NOT_REGULAR, absolute);
    const identity = identityOf(stat);
    const size = identity.size;
    const limit = Math.max(0, Math.min(maxBytes ?? size, size));
    const offset = from === "end" ? size - limit : 0;
    const buffer = Buffer.alloc(limit);
    let filled = 0;
    while (filled < limit) {
      const read = readSync(fd, buffer, filled, limit - filled, offset + filled);
      if (read === 0) break; // the file shrank under us; report what was actually read
      filled += read;
    }
    return {
      path: absolute,
      identity,
      read_from: offset,
      bytes_read: filled,
      truncated: offset > 0 || filled < size,
      short_read: filled < limit,
      data: buffer.subarray(0, filled),
    };
  } finally {
    try {
      closeSync(fd);
    } catch {
      /* already closed */
    }
  }
}

/** True when a file is no longer the one that was read: replaced, rotated, truncated or gone. */
export function identityChanged(before, after) {
  if (before === null || after === null) return true;
  return (
    before.device !== after.device ||
    before.inode !== after.inode ||
    before.size !== after.size ||
    before.modified_at !== after.modified_at
  );
}
