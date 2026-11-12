import * as contracts from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";
import * as bootEnv from "../src/boot-env";

// RV item 354, F1 — the Homebrew prefixes a fieldd lets its agents' install inventory probe. A
// harness names its own (FIELDD_AGENT_BREW_PREFIXES): unset keeps puppeteer's default, "" probes
// none, a list probes those. This file is pure: no daemon, no program, no home. Every
// node:child_process member throws by name, and every value handed to the runner is a planted
// one or a boolean, never an environment read from this process.

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const strict: Record<string, unknown> = Object.fromEntries(
    Object.keys(actual).map((name) => [
      name,
      () => {
        throw new Error(`child_process.${name} is not mocked`);
      },
    ]),
  );
  return { ...strict, default: strict };
});

// Read through the namespaces, so a missing name is a failed assertion, not a failed import.
const NAME: unknown = Reflect.get(contracts, "FIELDD_AGENT_BREW_PREFIXES_ENV");
type Read = (env: NodeJS.ProcessEnv, listDelimiter?: string) => readonly string[] | undefined;
const read: unknown = Reflect.get(bootEnv, "agentBrewPrefixes");

/** One planted environment's reading, after both names are proven to exist. */
function prefixesFor(value: string | undefined, listDelimiter: string) {
  expect(typeof NAME).toBe("string");
  expect(typeof read).toBe("function");
  const env: NodeJS.ProcessEnv = value === undefined ? {} : { [NAME as string]: value };
  return (read as Read)(env, listDelimiter);
}

describe("the Homebrew prefixes a fieldd's harness names (RV item 354, F1)", () => {
  it("is named once, in the contracts registry", () => {
    expect(NAME === "FIELDD_AGENT_BREW_PREFIXES").toBe(true);
  });

  it("names no list when the variable is unset, so puppeteer keeps its own default", () => {
    expect(prefixesFor(undefined, ":") === undefined).toBe(true);
  });

  it("names an empty list for an empty value, so a harness probes no prefix", () => {
    expect(prefixesFor("", ":")).toEqual([]);
  });

  it("splits a list on the platform delimiter and drops empty entries", () => {
    expect(prefixesFor("/opt/homebrew:/usr/local", ":")).toEqual(["/opt/homebrew", "/usr/local"]);
    expect(prefixesFor("::/opt/homebrew::", ":")).toEqual(["/opt/homebrew"]);
    expect(prefixesFor("C:\\brew;D:\\brew", ";")).toEqual(["C:\\brew", "D:\\brew"]);
  });
});
