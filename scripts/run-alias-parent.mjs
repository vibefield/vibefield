// Item 345, the seam slice (VF-PM 14:05:03Z, its four bounds) — a RUN's own socket alias parent, for the harnesses that
// boot a pair: fieldd's vitest global setup, and the smoke and lab launchers. A root over the sun_path line keeps its
// alias under the parent both planes read from SOCKET_ALIAS_PARENT_ENV; unset, that is the product's `/tmp`, and a
// harness that left it unset would leave a link in the account's own `/tmp/vf-<uid>/` every run. So a harness makes a
// short folder of its own, `/tmp/vfa-XXXXXX` (no alias fits under a `tmpdir()` root), hands it to the pair in the
// environment, and removes it when the pair is gone. `pnpm dev`, the QA root and a person's roots never set it.
import { lstatSync, mkdtempSync, readdirSync, readlinkSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

/** The variable both planes read: contracts' `SOCKET_ALIAS_PARENT_ENV` (registries.ts). A literal here because these
 * launchers run as plain node; check-test-temp-roots holds it equal to the registry's value. */
export const SOCKET_ALIAS_PARENT_ENV = "FIELD_SOCKET_ALIAS_PARENT";

/** The product's parent (contracts' `SOCKET_ALIAS_PARENT`): the folder the witness reads, never written here. */
const PRODUCT_PARENT = "/tmp";

/** A short folder this run owns, `/tmp/vfa-XXXXXX` (mode 0700), or null on win32, whose endpoints are pipes. */
export function makeRunAliasParent(platform = process.platform) {
  return platform === "win32" ? null : mkdtempSync("/tmp/vfa-");
}

/** The environment entry that hands a run's parent to the pair it starts; none for null. */
export function aliasParentEnv(made) {
  return made === null ? {} : { [SOCKET_ALIAS_PARENT_ENV]: made };
}

/** Bound 1: removes exactly the folder `makeRunAliasParent` returned, and only while it is still a directory directly
 * under /tmp, named `vfa-`, and this uid's; anything else is left, and the answer says why (null when removed or when
 * there was none). A killed run leaves its folder: nothing sweeps `/tmp/vfa-*`, ever. */
export function removeRunAliasParent(made) {
  if (made === null) return null;
  if (dirname(made) !== "/tmp" || !basename(made).startsWith("vfa-")) {
    return `${made} is not a /tmp/vfa- folder`;
  }
  let found;
  try {
    found = lstatSync(made);
  } catch (error) {
    return `${made}: ${error?.code ?? "unreadable"}`;
  }
  if (!found.isDirectory()) return `${made} is not a directory`;
  if (found.uid !== process.getuid?.()) return `${made} is not this uid's`;
  rmSync(made, { recursive: true, force: true, maxRetries: 3 });
  return null;
}

/** A vitest globalSetup's half, shared by every package whose tests boot a pair (fieldd, field-app, fieldd-client):
 * makes the run's parent, hands it to `provide` ("" on win32) for the package's setup file to put in each worker's
 * environment, counts the witness, and returns the teardown. The teardown removes the parent (bound 1, said when
 * left) and throws when the witness grew, in counts alone. */
export function setupRunAliasParent(provide, label) {
  const made = makeRunAliasParent();
  provide(made ?? "");
  const before = aliasLinksIntoTempRoots();
  return () => {
    const after = aliasLinksIntoTempRoots();
    const left = removeRunAliasParent(made);
    if (left !== null) process.stderr.write(`${label}: left its socket alias parent: ${left}\n`);
    if (after > before) {
      throw new Error(
        `item 345's witness (${label}): the account's socket alias links into temp roots ` +
          `were ${before} at setup and ${after} at teardown`,
      );
    }
  };
}

/** Bound 3, the witness: how many links in the product's alias folder (`/tmp/vf-<uid>/`) point into a temp root
 * (`tmpdir()` or `/tmp`, either spelling). Product and dev roots never lie there, so a running app cannot move it. Each
 * entry is read with lstat and readlink alone, nothing behind a link is opened, and the answer is a number, never a
 * name, a path or a target. */
export function aliasLinksIntoTempRoots(platform = process.platform) {
  if (platform === "win32") return 0;
  const folder = `${PRODUCT_PARENT}/vf-${process.getuid?.() ?? 0}`;
  let names;
  try {
    if (!lstatSync(folder).isDirectory()) return 0;
    names = readdirSync(folder);
  } catch {
    return 0; // no folder (or not one to read): nothing in it
  }
  const temps = new Set();
  for (const root of [tmpdir(), "/tmp", "/private/tmp"]) {
    temps.add(`${root.replace(/\/+$/, "")}/`);
    try {
      temps.add(`${realpathSync(root).replace(/\/+$/, "")}/`);
    } catch {
      // a root that does not resolve adds only its own spelling
    }
  }
  let count = 0;
  for (const name of names) {
    let target;
    try {
      target = readlinkSync(join(folder, name));
    } catch {
      continue; // not a link
    }
    if ([...temps].some((temp) => target.startsWith(temp))) count += 1;
  }
  return count;
}
