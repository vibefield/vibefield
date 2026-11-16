// Item 345's alias road on EVERY host (the CI red of 2026-11-15). A root whose worst socket path
// is over macOS's sun_path line binds every socket through `<parent>/vf-<uid>/<scope>`, a link
// into its run dir that only a keeper makes. Which roots take that road depends on `tmpdir()`'s
// length: CI's runner (48 bytes) sent every root of 12 prefix characters or more down it, while
// a short harness TMPDIR sent none, so the suites' stand-ins were never tried there. This row's
// root is over the line wherever it is made, so the road is taken on every host: a stand-in floor
// binds at the law's endpoint, and fieldd's boot dials it there.
import { lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { nativeRunDirFor, SOCKETS } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { bootstrap } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeEndpoint } from "./native-harness";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

/** 70 bytes of name before mkdtemp's six: with `/native/run/` and the longest socket file, a
 * root under any `tmpdir()` is past the 103-byte line, so this row never fits by luck. */
const OVER_THE_LINE = `vf-alias-road-${"x".repeat(55)}-`;

/** What stands at `path`, read with lstat alone, in the row's words. */
function found(path: string, target: string): string {
  try {
    const at = lstatSync(path);
    if (at.isSymbolicLink()) {
      return readlinkSync(path) === target ? "a link to the root's run dir" : "a link elsewhere";
    }
    if (at.isDirectory()) return `a directory, mode 0${(at.mode & 0o7777).toString(8)}`;
    return "neither a link nor a directory";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code ?? "unreadable";
  }
}

describe.skipIf(process.platform === "win32")(
  "item 345's alias road on every host: a stand-in floor binds where field-native would",
  () => {
    it("a stand-in at the law's endpoint answers fieldd's boot through the alias", async () => {
      const root = mkdtempSync(join(tmpdir(), OVER_THE_LINE));
      cleanup.push(() => rmSync(root, { recursive: true, force: true }));
      mkdirSync(join(root, "native", "run"), { recursive: true });
      writeFileSync(join(root, "native", "pairing"), "ab".repeat(32));
      const run = nativeRunDirFor(root);
      const endpoint = nativeEndpoint(root, SOCKETS.MGMT);
      const alias = dirname(endpoint);
      // the road this row exists for: the endpoint is the alias, never the run dir
      expect(alias).not.toBe(run);
      // said before the listen, so a red names what the stand-in found (a bind under a missing
      // folder is ENOENT, which Node's listen reports as EACCES)
      const before = `${found(alias, run)}, its folder ${found(dirname(alias), run)}`;
      const mock = new MockMgmtServer(endpoint);
      await mock.start().catch((error: unknown) => {
        const said = error instanceof Error ? error.message : String(error);
        throw new Error(`${said}; before the listen the alias was ${before}`);
      });
      cleanup.push(() => mock.stop());
      const daemon = await bootstrap({ dataDir: root, controlPort: 0, dataPort: 0 });
      cleanup.push(() => daemon.stop());
      expect(daemon.controlPort).toBeGreaterThan(0);
      expect(found(alias, run)).toBe("a link to the root's run dir");
      expect(found(dirname(alias), run)).toBe("a directory, mode 0700");
    });
  },
);
