import { describe, expect, it } from "vitest";
import {
  type CodeIdentity,
  childIsOurs,
  FIELD_NATIVE_SIGNING_IDENTIFIER,
  FIELDD_SIGNING_IDENTIFIER,
  ownIdentity,
  processIsOurs,
  type RunTool,
  type ToolResult,
} from "../src/index";

// OB custody (C6) — whose code a process is, asked of the OS's own tool. No row here runs codesign: `run` is injected,
// and what a signed build really answers is a landing-class row on a signed package, owed. These rows pin what is asked
// (the exact arguments, with no shell between), what is read from the answer, and that every doubt is a refusal.
//
// C6b — "our team, hardened" is too loose a question. The bundle holds other binaries our team signs, and some of
// them read their own stdin's first line as a bootstrap; one swapped into a daemon's place would pass and be handed
// the custody line. So the requirement names the IDENTIFIER the caller expects, before the team.

const CODESIGN = "/usr/bin/codesign";
const TEAM = "ABCDE12345";
const OWN: CodeIdentity = { team: TEAM, hardened: true };
const EXPECT = { identifier: "fieldd" };
const requirementFor = (identifier: string, team: string): string =>
  [
    `=identifier "${identifier}"`,
    "anchor apple generic",
    `certificate leaf[subject.OU] = "${team}"`,
  ].join(" and ");
const REQUIREMENT = requirementFor(EXPECT.identifier, TEAM);

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
const testsRequirement = (pid: number, requirement = REQUIREMENT): Call => ({
  file: CODESIGN,
  args: ["--verify", "-R", requirement, `+${pid}`],
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

describe("the two daemons' signing identifiers", () => {
  it("are what the release signer gives a bare executable: its file name", () => {
    expect(FIELDD_SIGNING_IDENTIFIER).toBe("fieldd");
    expect(FIELD_NATIVE_SIGNING_IDENTIFIER).toBe("field-native");
  });
});

// One judgment, two names: a child the caller spawned and has not reaped, and a process it did not spawn.
function judgesAProcess(name: string, isOurs: typeof childIsOurs): void {
  describe(`${name} — the identifier expected, of our team, under the hardened runtime`, () => {
    const verifies = (call: Call) => call.args[0] === "--verify";

    it("asks whether the pid satisfies the requirement, then reads its runtime flag", async () => {
      const { run, calls } = tool((call) => (verifies(call) ? said("") : said(SIGNED)));
      expect(await isOurs(51790, OWN, EXPECT, run)).toBe(true);
      expect(calls).toEqual([testsRequirement(51790), displays(51790)]);
    });

    it("names the identifier in the requirement, before the team: each daemon by its own", async () => {
      const { run, calls } = tool((call) => (verifies(call) ? said("") : said(SIGNED)));
      const floor = { identifier: FIELD_NATIVE_SIGNING_IDENTIFIER };
      expect(await isOurs(51790, OWN, floor, run)).toBe(true);
      // the requirement's own words, spelled here once and not through this file's helper
      const asked = calls[0]?.args[2] ?? "";
      const head = '=identifier "field-native" and anchor apple generic and ';
      expect(asked).toBe(`${head}certificate leaf[subject.OU] = "${TEAM}"`);
      expect(calls[0]).toEqual(testsRequirement(51790, requirementFor("field-native", TEAM)));
    });

    it("refuses a process of our team with another identifier", async () => {
      // a sibling binary swapped into the daemon's place: our team signed it, and it is not the daemon
      const sibling = tool((call) => {
        if (!verifies(call)) return said(SIGNED);
        return call.args[2]?.includes('identifier "fieldd"') ? said("", 3) : said("");
      });
      expect(await isOurs(51790, OWN, EXPECT, sibling.run)).toBe(false);
      // it was asked the identifier's question, and nothing after it
      expect(sibling.calls).toEqual([testsRequirement(51790)]);
    });

    it("refuses a process of another team before anything else is asked", async () => {
      const { run, calls } = tool((call) => (verifies(call) ? said("", 3) : said(SIGNED)));
      expect(await isOurs(51790, OWN, EXPECT, run)).toBe(false);
      expect(calls).toEqual([testsRequirement(51790)]);
    });

    it("refuses a process that passes the requirement without the hardened runtime", async () => {
      for (const answer of [NOT_HARDENED, AD_HOC, ""]) {
        const { run } = tool((call) => (verifies(call) ? said("") : said(answer)));
        expect(await isOurs(51790, OWN, EXPECT, run), answer).toBe(false);
      }
      const unread = tool((call) => (verifies(call) ? said("") : said(SIGNED, 1)));
      expect(await isOurs(51790, OWN, EXPECT, unread.run)).toBe(false);
    });

    it("never puts a team that is not ten capitals or digits into a requirement", async () => {
      const teams = ["ABCDE1234", "abcde12345", `${TEAM}" or anchor apple or "`, ""];
      for (const team of teams) {
        const { run, calls } = tool(() => said(SIGNED));
        expect(await isOurs(51790, { team, hardened: true }, EXPECT, run), team).toBe(false);
        expect(calls, team).toEqual([]);
      }
    });

    it("never puts an identifier that is off its pattern into a requirement", async () => {
      const off = [
        'fieldd" or anchor apple or "',
        "field native",
        "fieldd\n",
        "-fieldd",
        ".fieldd",
        "a".repeat(129),
        "",
      ];
      for (const identifier of off) {
        const { run, calls } = tool(() => said(SIGNED));
        expect(await isOurs(51790, OWN, { identifier }, run), identifier).toBe(false);
        expect(calls, identifier).toEqual([]);
      }
      // the longest one the pattern takes does reach the tool
      const longest = tool((call) => (verifies(call) ? said("") : said(SIGNED)));
      expect(await isOurs(51790, OWN, { identifier: "a".repeat(128) }, longest.run)).toBe(true);
    });

    it("never asks about a pid that is no pid", async () => {
      for (const pid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        const { run, calls } = tool(() => said(SIGNED));
        expect(await isOurs(pid, OWN, EXPECT, run), String(pid)).toBe(false);
        expect(calls, String(pid)).toEqual([]);
      }
    });

    it("answers a refusal, never a throw, when the tool is killed or throws", async () => {
      const killed = tool(() => said("", null));
      expect(await isOurs(51790, OWN, EXPECT, killed.run)).toBe(false);
      const threw = tool(() => {
        throw new Error("spawn /usr/bin/codesign ENOENT");
      });
      expect(await isOurs(51790, OWN, EXPECT, threw.run)).toBe(false);
    });
  });
}
judgesAProcess("childIsOurs", childIsOurs);
judgesAProcess("processIsOurs", processIsOurs);
