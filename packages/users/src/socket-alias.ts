import { unixSocketDir } from "@vibefield/contracts";

export interface SocketAliasOptions {
  /** The uid the alias folder must belong to: the process's own in the product. A test names another to stand for a
   * folder another account made (it cannot chown without root). */
  readonly uid?: number;
  /** The folder the aliases live in: `/tmp` in the product, the test's own temp dir in a test. */
  readonly parent?: string;
}

/** Item 345: before EVERY bind and dial, make the directory the endpoint law names for `dataRoot` usable, and return
 * it. A root that fits returns its real run dir and touches nothing. A root over the line gets `<parent>/vf-<uid>`
 * (0700, ours, a directory, not a link) and its link `<scope>` → the real run dir. A link pointing elsewhere is
 * replaced by a rename from a temp name INSIDE that folder. Nothing else is ever removed. */
export function ensureSocketDir(dataRoot: string, opts: SocketAliasOptions = {}): string {
  const uid = opts.uid ?? process.getuid?.() ?? 0;
  return unixSocketDir(uid, dataRoot, opts.parent); // S1: today's law, no checks, no link
}
