import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The scripted `claude` (fixtures/fake-claude): the vendor's banner, its
 * `auth` verbs and its model picker's read, as the adapter probes them. */
const FAKE_CLAUDE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-claude");

/** Where the wrapper records the NAMES of each run's environment, beside it. */
const ENV_NAMES = "claude.env-names";

/**
 * The scripted claude as `bin/claude`: a wrapper that names the fake's state
 * folder ITSELF and records the NAMES of the environment it was started with,
 * never a value. Item 50 (EL7): what puppeteer starts on its own (an install's
 * `--version`, the identity read, a sign-out) runs under the PTY path's
 * allow-list now, so a FAKE_CLAUDE_STATE_DIR set in the test's process never
 * reaches the fake. The wrapper sets it on the far side of that law, and the
 * fake keeps This Mac's signed-out mark in the test's own folder as before.
 */
export function installFakeClaude(bin: string): void {
  const path = join(bin, "claude");
  writeFileSync(
    path,
    [
      "#!/bin/sh",
      `env | sed 's/=.*//' >> ${shellQuote(join(bin, ENV_NAMES))}`,
      `FAKE_CLAUDE_STATE_DIR=${shellQuote(bin)} exec ${shellQuote(FAKE_CLAUDE)} "$@"`,
      "",
    ].join("\n"),
  );
  chmodSync(path, 0o755);
}

/** Every variable name any run of `bin/claude` was started with. */
export function fakeClaudeEnvNames(bin: string): Set<string> {
  const path = join(bin, ENV_NAMES);
  const text = existsSync(path) ? readFileSync(path, "utf8") : "";
  return new Set(text.split("\n").filter((name) => name !== ""));
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
