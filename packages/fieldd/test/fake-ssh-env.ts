// Item 447 — before a file's rows run, every worker's PATH leads with test/fixtures/fake-bin, whose `ssh` answers
// `ssh -G <host>` itself. The place read asks that of every ssh host a remote names (C10) and finds `ssh` on the PATH
// of the process it runs in: fieldd booted in-process, and the files worker a booted daemon starts with this
// process's environment. The machine's ssh takes the person's home from the account record, not from HOME, so on a
// developer's machine a row read their own ssh configuration and answered by it. A row's own `ssh` put before this
// one still wins (workspace-places.test.ts). win32 has no stand-in (a shell script); its rows run as before.
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  const bin = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-bin");
  const path = process.env["PATH"] ?? "";
  if (!path.split(delimiter).includes(bin)) process.env["PATH"] = `${bin}${delimiter}${path}`;
}
