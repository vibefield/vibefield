// EY-1 (2026-11-24, the engine's allow list): what main's broker passes to the engine is a list, by action and by
// argument. Contracts names the actions (PAGES_DAEMON_ACTIONS: "Main's broker passes these and the run form's own, and
// refuses any other"); main's table names each action's arguments, and is held here to what fieldd's rows send.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PAGES_DAEMON_ACTIONS, SHELL_SURFACES_RUN_ACTIONS } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  PAGES_COMMAND_ARGUMENTS,
  PAGES_RUN_ARGUMENTS,
  refusedCommand,
} from "../src/main/pages/broker/commands";

const here = dirname(fileURLToPath(import.meta.url));

/** What fieldd's rows send, read from its command builder's own text (a package wall stands between the two, so
 * the text is read, as a row of this package reads field-app's): for each engine command it builds, the names of
 * the arguments it can carry. A name is a key of the returned object, or the first argument of its `some(...)`. */
function fielddSends(): Record<string, string[]> {
  const source = readFileSync(
    resolve(here, "../../fieldd/src/tool-plane/rooms/pages/command.ts"),
    "utf8",
  );
  const builder = source.slice(source.indexOf("export function pagesCommand("));
  expect(builder.length).toBeGreaterThan(100);
  const sends: Record<string, Set<string>> = {};
  const starts = [...builder.matchAll(/return \{\s*action: "([a-z_]+)"/gu)];
  expect(starts.length).toBeGreaterThan(20);
  for (const start of starts) {
    // the returned object's own text: from its brace to the brace that closes it
    const from = builder.indexOf("{", start.index);
    let depth = 0;
    let to = from;
    for (; to < builder.length; to += 1) {
      if (builder[to] === "{") depth += 1;
      else if (builder[to] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const body = builder
      .slice(from + 1, to)
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/u, ""))
      .join("\n");
    const action = start[1] ?? "";
    const names = sends[action] ?? new Set<string>();
    sends[action] = names;
    for (const key of body.matchAll(/(?:^|[{,\s])([A-Za-z]+)\s*:/gu)) names.add(key[1] ?? "");
    for (const key of body.matchAll(/some\("([A-Za-z]+)"/gu)) names.add(key[1] ?? "");
    names.delete("action");
  }
  return Object.fromEntries(
    Object.entries(sends).map(([action, names]) => [action, [...names].sort()]),
  );
}

describe("the engine's allow list, by action and by argument", () => {
  it("names every action contracts lists, each once, and the run form's own", () => {
    expect(Object.keys(PAGES_COMMAND_ARGUMENTS).sort()).toEqual([...PAGES_DAEMON_ACTIONS].sort());
    expect(Object.keys(PAGES_RUN_ARGUMENTS).sort()).toEqual([...SHELL_SURFACES_RUN_ACTIONS].sort());
    for (const names of Object.values(PAGES_COMMAND_ARGUMENTS)) {
      expect([...names]).toEqual([...new Set(names)].sort());
    }
  });

  it("names for each action exactly the arguments fieldd's rows send, and no place a file or a fetch could be named", () => {
    const sends = fielddSends();
    const table = Object.fromEntries(
      Object.entries(PAGES_COMMAND_ARGUMENTS).map(([action, names]) => [action, [...names]]),
    );
    expect(table).toEqual(sends);
    // the engine's own ways to name a place: none is any action's argument
    const never = [
      "path",
      "screenshotDir",
      "executablePath",
      "cdpUrl",
      "profile",
      "headers",
      "provider",
      "args",
      "allowedDomains",
      "tls",
      "id",
    ];
    for (const [action, names] of Object.entries(table)) {
      expect(
        names.filter((name) => never.includes(name)),
        action,
      ).toEqual([]);
    }
    // the engine's `read` fetches an address by itself when it is given one: only `navigate` and a new tab are
    expect(Object.keys(table).filter((action) => table[action]?.includes("url"))).toEqual([
      "navigate",
      "tab_new",
    ]);
  });

  it("refuses an action off the list, and an argument that is not the action's own", () => {
    expect(refusedCommand("page", { action: "click", selector: "@e1" })).toBeNull();
    expect(refusedCommand("page", { action: "back" })).toBeNull();
    expect(refusedCommand("run", { action: "rebind", from: "run-0" })).toBeNull();
    expect(refusedCommand("run", { action: "navigate", url: "https://a.test/" })).toBeNull();
    for (const action of ["stream_enable", "record_start", "connect", "launch", "", "__proto__"]) {
      expect(refusedCommand("page", { action }), action).toBe("action");
      expect(refusedCommand("run", { action }), action).toBe("action");
    }
    // the run form's own are the run form's alone
    expect(refusedCommand("page", { action: "rebind", from: "run-0" })).toBe("action");
    for (const command of [
      { action: "screenshot", path: "/Users/x/.zshrc" },
      { action: "screenshot", screenshotDir: "/tmp" },
      { action: "read", url: "http://169.254.169.254/" },
      { action: "navigate", url: "https://a.test/", headers: {} },
      { action: "click", selector: "@e1", newTab: true },
      { action: "wait", function: "1" },
      { action: "click", selector: "@e1", id: "mine" },
      { action: "close", all: true },
      { action: "tab_list", verbose: true },
    ]) {
      expect(refusedCommand("page", command), JSON.stringify(command)).toBe("argument");
    }
    expect(refusedCommand("run", { action: "rebind", from: "run-0", to: "run-9" })).toBe(
      "argument",
    );
  });
});
