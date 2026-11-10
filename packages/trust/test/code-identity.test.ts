import { describe, expect, it } from "vitest";
import {
  type CodeIdentity,
  childIsOurs,
  ownIdentity,
  processIsOurs,
  type RunTool,
  type ToolResult,
} from "../src/index";

// OB custody (C6) — whose code a process is, asked of the OS's own tool. No row here runs codesign: `run` is injected,
// and what a signed build really answers is a landing-class row on a signed package, owed. These rows pin what is asked
// (the exact arguments, with no shell between), what is read from the answer, and that every doubt is a refusal.

const CODESIGN = "/usr/bin/codesign";
const TEAM = "ABCDE12345";
const REQUIREMENT = `=anchor apple generic and certificate leaf[subject.OU] = "${TEAM}"`;
const OWN: CodeIdentity = { team: TEAM, hardened: true };

const words = (flags: string, team: string) =>
  [
    "Executable=/Applications/VibeField.app/Contents/MacOS/VibeField",
    "Identifier=com.jamesyong.vibefield",
    "Format=app bundle with Mach-O thin (arm64)",
    `CodeDirectory v=20500 size=1924 flags=${flags} hashes=49+7 location=embedded`,
    "Hash type=sha256 size=32",
    "Authority=Developer ID Application: Example Person (ABCDE12345)",
    "Info.plist entries=30",
    `TeamIdentifier=${team}`,
    "Runtime Version=15.0.0",
    "Sealed Resources version=2 rules=13 files=120",
    "",
  ].join("\n");
const SIGNED = words("0x10000(runtime)", TEAM);
const AD_HOC = words("0x2(adhoc)", "not set");
const AD_HOC_HARDENED = words("0x10002(adhoc,runtime)", "not set");
const NOT_HARDENED = words("0x0(none)", TEAM);

// codesign writes what it displays to stderr
const said = (stderr: string, code: number | null = 0): ToolResult => ({
  code,
  stdout: "",
  stderr,
});

interface Call {
  file: string;
  args: readonly string[];
}
function tool(answer: (call: Call) => ToolResult | Promise<ToolResult>) {
  const calls: Call[] = [];
  const run: RunTool = async (file, args) => {
    const call = { file, args: [...args] };
    calls.push(call);
    return answer(call);
  };
  return { run, calls };
}
const displays = (pid: number): Call => ({
  file: CODESIGN,
  args: ["--display", "--verbose=4", `+${pid}`],
});
const testsRequirement = (pid: number): Call => ({
  file: CODESIGN,
  args: ["--verify", "-R", REQUIREMENT, `+${pid}`],
});
const MAC = { platform: "darwin", pid: 4242 } as const;

describe("ownIdentity — the shell's own signature, or none", () => {
  it("reads the team and the hardened runtime from codesign's own words about this process", async () => {
    const { run, calls } = tool(() => said(SIGNED));
    expect(await ownIdentity(run, MAC)).toEqual({ team: TEAM, hardened: true });
    expect(calls).toEqual([displays(4242)]);
  });

  it("an unsigned shell is `files`: no team, or no hardened runtime, is no identity", async () => {
    for (const answer of [AD_HOC, AD_HOC_HARDENED, NOT_HARDENED, ""]) {
      const { run } = tool(() => said(answer));
      expect(await ownIdentity(run, MAC), answer).toBeNull();
    }
  });

  it("takes a team of ten capitals or digits and nothing looser", async () => {
    for (const team of ["abcde12345", "ABCDE1234", "ABCDE123456", `${TEAM} (extra)`, ""]) {
      const { run } = tool(() => said(words("0x10000(runtime)", team)));
      expect(await ownIdentity(run, MAC), team).toBeNull();
    }
  });

  it("is no identity off macOS, and the tool is never run there", async () => {
    for (const platform of ["linux", "win32"] as const) {
      const { run, calls } = tool(() => said(SIGNED));
      expect(await ownIdentity(run, { platform, pid: 4242 })).toBeNull();
      expect(calls).toEqual([]);
    }
  });

  it("is no identity when the tool fails, is killed or throws", async () => {
    const failed = tool(() => said(SIGNED, 1));
    expect(await ownIdentity(failed.run, MAC)).toBeNull();
    const killed = tool(() => said(SIGNED, null));
    expect(await ownIdentity(killed.run, MAC)).toBeNull();
    const threw = tool(() => {
      throw new Error("spawn /usr/bin/codesign ENOENT");
    });
    expect(await ownIdentity(threw.run, MAC)).toBeNull();
  });
});

// One judgment, two names: a child the caller spawned and has not reaped, and a process it did not spawn.
function judgesAProcess(name: string, isOurs: typeof childIsOurs): void {
  describe(`${name} — a process of our team, under the hardened runtime`, () => {
    const verifies = (call: Call) => call.args[0] === "--verify";

    it("asks whether the pid satisfies the team's requirement, then reads its runtime flag", async () => {
      const { run, calls } = tool((call) => (verifies(call) ? said("") : said(SIGNED)));
      expect(await isOurs(51790, OWN, run)).toBe(true);
      expect(calls).toEqual([testsRequirement(51790), displays(51790)]);
    });

    it("refuses a process of another team before anything else is asked", async () => {
      const { run, calls } = tool((call) => (verifies(call) ? said("", 3) : said(SIGNED)));
      expect(await isOurs(51790, OWN, run)).toBe(false);
      expect(calls).toEqual([testsRequirement(51790)]);
    });

    it("refuses a process that passes the requirement without the hardened runtime", async () => {
      for (const answer of [NOT_HARDENED, AD_HOC, ""]) {
        const { run } = tool((call) => (verifies(call) ? said("") : said(answer)));
        expect(await isOurs(51790, OWN, run), answer).toBe(false);
      }
      const unread = tool((call) => (verifies(call) ? said("") : said(SIGNED, 1)));
      expect(await isOurs(51790, OWN, unread.run)).toBe(false);
    });

    it("never puts a team that is not ten capitals or digits into a requirement", async () => {
      const teams = ["ABCDE1234", "abcde12345", `${TEAM}" or anchor apple or "`, ""];
      for (const team of teams) {
        const { run, calls } = tool(() => said(SIGNED));
        expect(await isOurs(51790, { team, hardened: true }, run), team).toBe(false);
        expect(calls, team).toEqual([]);
      }
    });

    it("never asks about a pid that is no pid", async () => {
      for (const pid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        const { run, calls } = tool(() => said(SIGNED));
        expect(await isOurs(pid, OWN, run), String(pid)).toBe(false);
        expect(calls, String(pid)).toEqual([]);
      }
    });

    it("answers a refusal, never a throw, when the tool is killed or throws", async () => {
      const killed = tool(() => said("", null));
      expect(await isOurs(51790, OWN, killed.run)).toBe(false);
      const threw = tool(() => {
        throw new Error("spawn /usr/bin/codesign ENOENT");
      });
      expect(await isOurs(51790, OWN, threw.run)).toBe(false);
    });
  });
}
judgesAProcess("childIsOurs", childIsOurs);
judgesAProcess("processIsOurs", processIsOurs);
