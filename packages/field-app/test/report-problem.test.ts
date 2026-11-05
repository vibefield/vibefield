import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ShellExternalUrl } from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  macFactsFromHints,
  READ_HINTS,
  REPORT_PROBLEM_FIELDS,
  REPORT_PROBLEM_ISSUES_URL,
  REPORT_PROBLEM_TEMPLATE,
  readMacFacts,
  reportProblemUrl,
  reportProblemWords,
} from "../src/panels/report-problem";

// LP-7 (LP-D18) — Settings → Diagnostics' Report a problem: the bug form's address with this Mac's facts by field id,
// and nothing else; the words say only the facts the link has; the client hints read tolerantly.

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ISSUE_TEMPLATES = join(REPO_ROOT, ".github", "ISSUE_TEMPLATE");

/** An issue form's body elements, as `type` and `id` — read line by line, no YAML library: the forms keep each
 * element's `- type:` and its `id:` on lines of their own. */
function formElements(file: string): Array<{ type: string; id: string | undefined }> {
  const elements: Array<{ type: string; id: string | undefined }> = [];
  for (const line of readFileSync(join(ISSUE_TEMPLATES, file), "utf8").split("\n")) {
    const type = /^\s*-\s+type:\s*(\S+)\s*$/.exec(line)?.[1];
    if (type !== undefined) {
      elements.push({ type, id: undefined });
      continue;
    }
    const id = /^\s{4}id:\s*(\S+)\s*$/.exec(line)?.[1];
    const last = elements.at(-1);
    if (id !== undefined && last !== undefined) last.id = id;
  }
  return elements;
}

describe("Report a problem's address (LP-7)", () => {
  it("opens the bug form alone when no fact is known", () => {
    expect(reportProblemUrl()).toBe(
      "https://github.com/vibefield/vibefield/issues/new?template=bug_report.yml",
    );
    expect(reportProblemUrl({ version: undefined, macos: undefined, chip: undefined })).toBe(
      `${REPORT_PROBLEM_ISSUES_URL}?template=${REPORT_PROBLEM_TEMPLATE}`,
    );
  });

  it("fills the version, macOS and chip by field id, in the form's order, a space as %20", () => {
    expect(
      reportProblemUrl({ chip: "Apple silicon", macos: "macOS 15.6.1", version: "0.9.0-beta.2" }),
    ).toBe(
      "https://github.com/vibefield/vibefield/issues/new?template=bug_report.yml" +
        "&version=0.9.0-beta.2&macos=macOS%2015.6.1&chip=Apple%20silicon",
    );
  });

  it("names only its own origin and path, whatever a fact holds", () => {
    const url = new URL(
      reportProblemUrl({ version: "0.9.0&template=other.yml#x", macos: "macOS 15.6.1" }),
    );
    expect(url.origin).toBe("https://github.com");
    expect(url.pathname).toBe("/vibefield/vibefield/issues/new");
    expect(url.hash).toBe("");
    // a fact is a value, never a parameter of its own: the template stays the bug form
    expect(url.searchParams.getAll("template")).toEqual(["bug_report.yml"]);
    expect(url.searchParams.get("version")).toBe("0.9.0&template=other.yml#x");
  });

  it("leaves out a fact it cannot carry as it is, rather than mending it", () => {
    const url = new URL(
      reportProblemUrl({
        version: "   ",
        macos: "macOS 15.6\n1",
        chip: "x".repeat(65),
      }),
    );
    expect([...url.searchParams.keys()]).toEqual(["template"]);
    // trimmed, then carried
    expect(new URL(reportProblemUrl({ version: " 0.9.0 " })).searchParams.get("version")).toBe(
      "0.9.0",
    );
  });

  it("is an address the shell opens: an unambiguous, credential-free https URL", () => {
    for (const url of [
      reportProblemUrl(),
      reportProblemUrl({ version: "0.9.0", macos: "macOS 26.1", chip: "Intel" }),
    ]) {
      expect(ShellExternalUrl.safeParse(url).success).toBe(true);
    }
  });
});

describe("the bug form the link fills in (LP-7)", () => {
  it("has an input for every field the link fills, by the same id", () => {
    const elements = formElements(REPORT_PROBLEM_TEMPLATE);
    for (const id of Object.values(REPORT_PROBLEM_FIELDS)) {
      expect(elements.filter((element) => element.id === id)).toEqual([{ type: "input", id }]);
    }
  });

  it("gives every field an id, once, in GitHub's alphabet", () => {
    for (const file of [REPORT_PROBLEM_TEMPLATE, "feature_request.yml"]) {
      const fields = formElements(file).filter((element) => element.type !== "markdown");
      expect(fields.length).toBeGreaterThan(0);
      const ids = fields.map((element) => element.id);
      for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("keeps blank issues off, so every report starts from a form", () => {
    expect(readFileSync(join(ISSUE_TEMPLATES, "config.yml"), "utf8")).toMatch(
      /^blank_issues_enabled: false$/m,
    );
  });
});

describe("Report a problem's words (LP-7)", () => {
  it("says only the facts the link has, and that issues are public", () => {
    expect(
      reportProblemWords({ version: "0.9.0", macos: "macOS 15.6.1", chip: "Apple silicon" }),
    ).toBe(
      "Opens a new issue on GitHub with your VibeField version, macOS version and chip filled in, and nothing else. " +
        "Issues there are public: read a support bundle before you attach it.",
    );
    expect(reportProblemWords({ macos: "macOS 15.6.1", chip: "Intel" })).toBe(
      "Opens a new issue on GitHub with your macOS version and chip filled in, and nothing else. " +
        "Issues there are public: read a support bundle before you attach it.",
    );
    expect(reportProblemWords({ version: "0.9.0" })).toBe(
      "Opens a new issue on GitHub with your VibeField version filled in, and nothing else. " +
        "Issues there are public: read a support bundle before you attach it.",
    );
    // a fact the address would leave out is not claimed either
    expect(reportProblemWords({ version: "  " })).toBe(
      "Opens a new issue on GitHub. Issues there are public: read a support bundle before you attach it.",
    );
  });
});

describe("this Mac's facts from the client hints (LP-7)", () => {
  it("reads the macOS version and the chip, on macOS alone", () => {
    expect(
      macFactsFromHints({ platform: "macOS", platformVersion: "15.6.1", architecture: "arm" }),
    ).toEqual({ macos: "macOS 15.6.1", chip: "Apple silicon" });
    expect(
      macFactsFromHints({ platform: "macOS", platformVersion: "14.5.0", architecture: "x86" }),
    ).toEqual({ macos: "macOS 14.5.0", chip: "Intel" });
    expect(
      macFactsFromHints({ platform: "Windows", platformVersion: "15.0.0", architecture: "x86" }),
    ).toEqual({});
  });

  it("says nothing of a value in another shape", () => {
    expect(macFactsFromHints(null)).toEqual({});
    expect(macFactsFromHints("macOS")).toEqual({});
    expect(
      macFactsFromHints({ platform: "macOS", platformVersion: "15.6.1 (24G90)", architecture: "" }),
    ).toEqual({});
    expect(
      macFactsFromHints({ platform: "macOS", platformVersion: 15, architecture: "riscv" }),
    ).toEqual({});
  });

  it("asks the navigator's userAgentData for the two hints, and never throws", async () => {
    const getHighEntropyValues = vi.fn(async (_hints: string[]) => ({
      platform: "macOS",
      platformVersion: "26.1.0",
      architecture: "arm",
    }));
    await expect(readMacFacts({ userAgentData: { getHighEntropyValues } })).resolves.toEqual({
      macos: "macOS 26.1.0",
      chip: "Apple silicon",
    });
    expect(getHighEntropyValues).toHaveBeenCalledWith(READ_HINTS);

    // a DOM without client hints (happy-dom, a browser that is not Chromium), a refused read, a broken bridge
    await expect(readMacFacts(undefined)).resolves.toEqual({});
    await expect(readMacFacts({})).resolves.toEqual({});
    await expect(readMacFacts({ userAgentData: {} })).resolves.toEqual({});
    await expect(
      readMacFacts({
        userAgentData: {
          getHighEntropyValues: async () => {
            throw new Error("NotAllowedError");
          },
        },
      }),
    ).resolves.toEqual({});
  });
});
