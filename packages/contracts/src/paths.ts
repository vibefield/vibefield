// Path grammar shared by the wire shapes that carry a desktop path. Grammar
// only: whether the path exists is the reader's question, at use.

/** An absolute path on this desktop: POSIX, a drive, or UNC; never a NUL. */
export function isAbsoluteDesktopPath(path: string): boolean {
  return (
    !path.includes("\0") &&
    (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || /^\\\\[^\\/]+[\\/]/.test(path))
  );
}
