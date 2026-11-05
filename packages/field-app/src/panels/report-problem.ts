// LP-7 (LP-D18) — Settings → Diagnostics' "Report a problem": the testers' one place to report, the repository's bug
// form (`.github/ISSUE_TEMPLATE/bug_report.yml`), opened with the facts a report needs already in it. Those facts are
// this Mac's own and nothing else: VibeField's version, the macOS version and the chip, put in the address by the
// form's field ids. They leave the Mac only when the person presses the link (the section's `<a target="_blank">`,
// which the shell's window-open policy hands to the default browser as an https address, `decideWindowOpen`), and the
// person reads the form before they submit it. There is no telemetry: nothing here is sent anywhere on its own.
// Pure, but for `readMacFacts`, which asks the renderer's client hints and is given the navigator to ask.

/** The repository's new-issue door. Only this address is built here: a fixed origin and path, the facts in its query. */
export const REPORT_PROBLEM_ISSUES_URL = "https://github.com/vibefield/vibefield/issues/new";

/** The bug form, by its file name, as GitHub's `template` parameter names it. */
export const REPORT_PROBLEM_TEMPLATE = "bug_report.yml";

/** The bug form's fields a link fills in, each the `id` of an `input` in bug_report.yml; `report-problem.test.ts`
 * reads the form and holds these to it, so a renamed field fails the suite rather than a tester's link. The forms
 * are an input of field-app's `test` target (its package.json, `nx.targets.test.inputs`), so an edit to a form alone
 * re-runs that test rather than replaying a cached pass. */
export const REPORT_PROBLEM_FIELDS = {
  version: "version",
  macos: "macos",
  chip: "chip",
} as const;

export type ReportProblemFact = keyof typeof REPORT_PROBLEM_FIELDS;

/** What the link knows of this Mac. Each fact is optional: one this window cannot read is left for the person to
 * write, never guessed. */
export interface ReportProblemFacts {
  /** VibeField's version as Settings → Updates says it (the updater's `currentVersion`); absent where no updater
   * runs, a development build above all */
  version?: string | undefined;
  /** "macOS 15.6.1" */
  macos?: string | undefined;
  /** "Apple silicon" or "Intel" */
  chip?: string | undefined;
}

const FACT_ORDER: readonly ReportProblemFact[] = ["version", "macos", "chip"];

/** The longest fact the address carries; a version, an OS version and a chip are all far shorter. */
const FACT_MAX_CHARS = 64;

/** A fact as the address carries it: trimmed, on one line, bounded. Anything else is left out rather than mended, so
 * the form shows the field empty and the person fills it in. */
function factValue(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const value = raw.trim();
  if (value === "" || value.length > FACT_MAX_CHARS || /[\p{Cc}\p{Cf}]/u.test(value))
    return undefined;
  return value;
}

/** The bug form's address with the facts this Mac has, by field id, in the form's order:
 * `https://github.com/vibefield/vibefield/issues/new?template=bug_report.yml&version=0.9.0&macos=macOS%2015.6.1&chip=Apple%20silicon`.
 * Every value is percent-encoded (a space is `%20`, never `+`), so the form reads exactly what was put in. */
export function reportProblemUrl(facts: ReportProblemFacts = {}): string {
  const pairs: Array<readonly [string, string]> = [["template", REPORT_PROBLEM_TEMPLATE]];
  for (const fact of FACT_ORDER) {
    const value = factValue(facts[fact]);
    if (value !== undefined) pairs.push([REPORT_PROBLEM_FIELDS[fact], value]);
  }
  const query = pairs
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  return `${REPORT_PROBLEM_ISSUES_URL}?${query}`;
}

const FACT_WORDS: Record<ReportProblemFact, string> = {
  version: "VibeField version",
  macos: "macOS version",
  chip: "chip",
};

/** The row's words (DESIGN.md §9): what the link fills in, said only of the facts it HAS, so a build that cannot read
 * one never claims it; then that GitHub's issues are public. */
export function reportProblemWords(facts: ReportProblemFacts = {}): string {
  const named = FACT_ORDER.filter((fact) => factValue(facts[fact]) !== undefined).map(
    (fact) => FACT_WORDS[fact],
  );
  const opens =
    named.length === 0
      ? "Opens a new issue on GitHub."
      : `Opens a new issue on GitHub with your ${listWords(named)} filled in, and nothing else.`;
  return `${opens} Issues there are public: read a support bundle before you attach it.`;
}

/** "a", "a and b", "a, b and c". */
function listWords(words: readonly string[]): string {
  const last = words.at(-1);
  if (last === undefined || words.length === 1) return last ?? "";
  return `${words.slice(0, -1).join(", ")} and ${last}`;
}

/** The two facts the renderer reads itself. */
export type MacFacts = Pick<ReportProblemFacts, "macos" | "chip">;

/** Chromium's high-entropy client hints (`navigator.userAgentData.getHighEntropyValues`), read as untrusted: the
 * macOS version and the chip, or nothing. The hints are where a Chromium page reads the OS's own version, since the
 * user agent string froze macOS at 10_15_7; their `architecture` is `arm` on Apple silicon and `x86` on Intel. Any
 * other platform, or a value in another shape, says nothing. */
export function macFactsFromHints(hints: unknown): MacFacts {
  if (typeof hints !== "object" || hints === null) return {};
  const values = hints as Record<string, unknown>;
  if (values.platform !== "macOS") return {};
  const facts: MacFacts = {};
  const version = values.platformVersion;
  if (typeof version === "string" && /^\d{1,3}(\.\d{1,4}){0,3}$/.test(version)) {
    facts.macos = `macOS ${version}`;
  }
  if (values.architecture === "arm") facts.chip = "Apple silicon";
  else if (values.architecture === "x86") facts.chip = "Intel";
  return facts;
}

/** The high-entropy hints asked for: the two facts, nothing more (no `model`, no `fullVersionList`). */
export const READ_HINTS: readonly string[] = ["platformVersion", "architecture"];

/** This Mac's macOS version and chip, from the client hints of `source`, the window's `navigator`; nothing where there
 * are none (a test's DOM, a browser that is not Chromium) or where the read fails. Never throws. `unknown` because
 * TypeScript's DOM library does not declare `userAgentData` (it is Chromium's alone), so it is found, not assumed. */
export async function readMacFacts(source: unknown): Promise<MacFacts> {
  if (typeof source !== "object" || source === null || !("userAgentData" in source)) return {};
  const data: unknown = source.userAgentData;
  if (typeof data !== "object" || data === null) return {};
  const read = (data as { getHighEntropyValues?: unknown }).getHighEntropyValues;
  if (typeof read !== "function") return {};
  try {
    const hints: unknown = await read.call(data, [...READ_HINTS]);
    return macFactsFromHints(hints);
  } catch {
    return {};
  }
}
