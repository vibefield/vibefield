// IL-D5 (a) (`draft/thinking-inventory-latency.md` §5) — the census's lists: the contracts' EL9 fixtures (two rows, one
// in each class cell, cell 2 named older than the bound), parsed fresh at every read. Test-only; shared by
// apply.test.ts and controller-apply.test.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURES = join(import.meta.dirname, "../../../contracts/fixtures");

/** `terminal.list`'s answer as the contracts fixture `name` holds it. */
export function terminalList(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as Record<string, unknown>;
}

/** terminal-list.stale-cell.json's observation with `keep` of its fields. */
function listKeeping(keep: (field: string) => boolean): Record<string, unknown> {
  const list = terminalList("terminal-list.stale-cell.json");
  const observation = Object.fromEntries(
    Object.entries(list.observation as Record<string, unknown>).filter(([field]) => keep(field)),
  );
  return { ...list, observation };
}

/** The fixture's two rows from a judging fieldd with every cell current: its bound, no `staleCells`. */
export function currentList(): Record<string, unknown> {
  return listKeeping((field) => field !== "staleCells");
}

/** The same two rows from a fieldd that cannot say how old they are: no `boundMs`, no `staleCells`. */
export function unjudgedList(): Record<string, unknown> {
  return listKeeping((field) => field !== "staleCells" && field !== "boundMs");
}

/** The fixtures' two rows as the census names them: a shell on cell 1, an agent on cell 2. */
export const FIXTURE_SESSIONS = [
  {
    sessionId: "5e1a7c3d-9b2f-4e6a-8c0d-1f2e3a4b5c6d",
    title: "zsh",
    cwd: "/Users/james/Projects/vibe-field",
  },
  {
    sessionId: "0d9f1c2b-3a4e-5d6c-7b8a-9e0f1a2b3c4d",
    title: "claude — vibe-field",
    cwd: "/Users/james/Projects/vibe-field",
  },
] as const;
