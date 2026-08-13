// THE CATALOG, scaffolder edition. Same law as plugin-cli's: every code this
// command can emit is declared here once, with the guidance that becomes the
// verdict's `expected` when the call site has nothing more specific to say.
// Codes are kebab-case and STABLE — an agent branches on them.
//
// This is a SECOND catalog rather than an import of plugin-cli's, and the reason
// is the dependency wall (§5.4 item 3): the scaffolder CONSUMES plugin-build and
// names plugin-cli's commands, but does not depend on the kit's own package —
// a scaffolder that pulled in the checker would make every author install the
// checker to create a directory. The two catalogs share no codes, so there is
// nothing here that can drift out of agreement with that one.

export interface RefusalClass {
  /** the row that emits it */
  readonly check: string;
  /** `refuse` fails the command (exit 1); `note` is an honest absence */
  readonly level: "refuse" | "note";
  /** what the code means, one line */
  readonly meaning: string;
  /** what to make true — the default `expected` when a call site has no better */
  readonly guidance: string;
}

export const REFUSAL_CATALOG = {
  // --- the target directory ---------------------------------------------------
  "target-not-empty": {
    check: "target",
    level: "refuse",
    meaning: "the target directory exists and is not empty",
    guidance: "pass an empty or non-existent --dir; this command never writes into existing files",
  },
  "dir-uncreatable": {
    check: "target",
    level: "refuse",
    meaning: "the target directory could not be created (permissions, or a file sits in its path)",
    guidance: "pass a --dir whose parent exists and is writable",
  },

  // --- identity ---------------------------------------------------------------
  "id-invalid": {
    check: "id",
    level: "refuse",
    meaning: "the plugin id is not a distributable id (§6.1)",
    guidance:
      "use two or more dot-separated segments, each matching [a-z][a-z0-9-]* (e.g. vendor.plugin)",
  },
  "id-reserved": {
    check: "id",
    level: "refuse",
    meaning: "the vibefield.* namespace belongs to first-party plugins (§6.2)",
    guidance: "choose your own vendor segment, or pass --first-party if this IS a built-in",
  },
  "title-invalid": {
    check: "id",
    level: "refuse",
    meaning: "the title is empty or over the manifest's title limit",
    guidance: "pass a --title of 1 to 80 characters",
  },
  "widget-type-invalid": {
    check: "id",
    level: "refuse",
    meaning: "the widget type is not owned by the plugin id (§6.2)",
    guidance: "a widget type is <id> or <id>.<name>; omit --widget-type to use the id itself",
  },

  // --- where the scaffold landed ------------------------------------------------
  "workspace-outside": {
    check: "workspace",
    level: "note",
    meaning:
      "the scaffold is outside this repository's pnpm workspace, so its workspace:/catalog: dependencies resolve to nothing",
    guidance:
      "scaffold inside the workspace (plugins/*), or wait for published SDK packages — they do not exist yet",
  },
  "workspace-member": {
    check: "workspace",
    level: "note",
    meaning: "the scaffold matches a workspace glob, so pnpm install wires its dependencies",
    guidance: "run pnpm install from the repository root before building or checking it",
  },
  "next-steps": {
    check: "next",
    level: "note",
    meaning: "the commands that take the scaffold from files on disk to a rendered widget",
    guidance: "run them in order; each one answers in verdicts",
  },

  // --- the harness itself --------------------------------------------------------
  usage: {
    check: "input",
    level: "refuse",
    meaning: "the command line could not be understood",
    guidance: "run `create-plugin --help`; every flag is required up front, and nothing prompts",
  },
  "harness-error": {
    check: "harness",
    level: "refuse",
    meaning: "the scaffolder itself failed — a bug here, not in your input (exit 2)",
    guidance: "report it with the detail line; nothing was written that this command can trust",
  },
} as const satisfies Record<string, RefusalClass>;

export type RefusalCode = keyof typeof REFUSAL_CATALOG;

export function guidanceFor(code: RefusalCode): string {
  return REFUSAL_CATALOG[code].guidance;
}

/** The catalog as sorted rows — what a test walks to prove every emitted code is
 * declared here. */
export function catalogRows(): Array<RefusalClass & { code: RefusalCode }> {
  return (Object.keys(REFUSAL_CATALOG) as RefusalCode[])
    .sort()
    .map((code) => ({ code, ...REFUSAL_CATALOG[code] }));
}
