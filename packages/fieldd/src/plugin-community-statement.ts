import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// THE COMMUNITY STATEMENT'S MARK (MK-O3D, 2026-11-14; James's MK-O1 pick B, "Once on each
// desktop" as his plugins page names it, in its store at 2026-11-11T23:03:22.544Z; built on VF-PM's
// ruling of 2026-11-14 04:33Z). Whether THIS desktop has shown the community statement (DESIGN.md
// §8 "The community tile") and the person went on past it here. Each desktop shows it once.
//
// It is device scope and never synced. The settings doc keeps user-scope keys alone and syncs
// (`settings-doc.ts`, law 1: device and secret never enter), so the mark is a file of fieldd's own
// under the data root, beside the plugin records (`plugin-registry.ts`, `install-records.json`),
// as a plugin's device-scope setting is a file no sync plane reads (`plugin-settings.ts`). The
// switch syncs; the mark does not.
//
// It decides nothing fieldd does. The switch is the fence (MK's J1; `daemon.ts`'s
// `communityAllowed`): no install, load or hold reads the mark. The window reads it to know
// whether to show the statement before it turns community plugins on here, or before a first
// community install here. A file it can't read is no mark, so the statement is shown again and
// never skipped by a guess. Custody: MK-2's note, its addendum of 2026-11-14 ("shown here").

/** The mark's file, under the data root. */
export const COMMUNITY_STATEMENT_FILE = ["fieldd", "plugins", "community-statement.json"] as const;

interface CommunityStatementFile {
  version: 1;
  /** when this desktop first marked it, in epoch milliseconds */
  shownAt: number;
}

/** What a read of the file may hold: anything, so each field is checked. */
type MarkRead = Partial<CommunityStatementFile> | null;

export class CommunityStatementMark {
  private readonly path: string;
  private readonly now: () => number;

  constructor(dataDir: string, now: () => number = Date.now) {
    this.path = join(dataDir, ...COMMUNITY_STATEMENT_FILE);
    this.now = now;
  }

  /** Whether this desktop has shown the statement: only a mark it reads whole says so. */
  async shownHere(): Promise<boolean> {
    let parsed: MarkRead;
    try {
      parsed = JSON.parse(await readFile(this.path, "utf8")) as MarkRead;
    } catch {
      return false; // none yet, or unreadable: no mark
    }
    const shownAt = parsed?.shownAt;
    return (
      parsed?.version === 1 &&
      typeof shownAt === "number" &&
      Number.isSafeInteger(shownAt) &&
      shownAt >= 0
    );
  }

  /** Marks it, once: a desktop already marked keeps its first time. Written whole, then renamed
   * into place, so a reader never meets half a file. */
  async markShown(): Promise<void> {
    if (await this.shownHere()) return;
    const file: CommunityStatementFile = { version: 1, shownAt: this.now() };
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, `${JSON.stringify(file)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(tmp, this.path);
  }
}
