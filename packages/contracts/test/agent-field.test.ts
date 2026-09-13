import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AgentFieldRow,
  AgentFieldSlice,
  AgentInterruptResult,
  AgentSubscribeParams,
} from "../src/agent-field";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const slice = AgentFieldSlice.parse(
  JSON.parse(readFileSync(join(FIXTURES, "agent-field-slice.valid.json"), "utf8")),
);

describe("MF-1 — the GOLDEN field row is content-free (§10.1)", () => {
  it("the golden carries no content key in any row", () => {
    // FIXTURE SANITY, and only that: this file is hand-authored, so what it
    // proves is that the goldens the phone decodes describe a content-free
    // row — never that fieldd produces one. The producer's own wall is an
    // ALLOWLIST derived from `AgentFieldRow.shape`
    // (`packages/fieldd/test/agent-field.test.ts`), and a row there asserts
    // this golden and that producer speak the same vocabulary, so the two
    // cannot drift apart in silence. Passthrough means a row COULD carry
    // these (the tolerant reader never drops what it does not know); what
    // must never happen is fieldd putting them there.
    const forbidden = ["lastAssistantMessage", "monitor", "title", "workspace"];
    for (const row of slice.rows) {
      for (const key of forbidden) {
        expect(Object.keys(row), `${row.runtimeRunId} carries ${key}`).not.toContain(key);
      }
      for (const blocker of row.blockers) {
        for (const key of ["input", "questions", "detail"]) {
          expect(Object.keys(blocker), `${blocker.id} carries ${key}`).not.toContain(key);
        }
      }
    }
  });

  it("EL7 B1 — the golden names FOLDERS, never paths", () => {
    // The slice reaches every tailnet node the app admits, and an absolute cwd
    // carried the OS username and the shape of a person's disk. A card draws
    // the folder, so the folder is all the row carries.
    for (const row of slice.rows) {
      if (row.project === undefined) continue;
      for (const key of Object.keys(row.project)) {
        expect(["name", "branch"], `${row.runtimeRunId}'s project carries ${key}`).toContain(key);
      }
      const name = (row.project as { name?: unknown }).name;
      if (name !== undefined) {
        expect(typeof name).toBe("string");
        expect(name as string, "a folder NAME has no separators").not.toMatch(/[/\\]/);
      }
    }
    // and nothing anywhere in the slice reads like a path out of someone's home
    expect(JSON.stringify(slice)).not.toMatch(/"\/Users\/|"\/home\/|"[A-Za-z]:\\\\/);
  });

  it("keeps a whole five-row board inside the phone's frame budget (§5)", () => {
    // The §5 target: five working agents steady at < 2 KB/s. One frame of the
    // whole board is the worst case a subscriber sees, and it lands far inside
    // the store's own 64 KB slice cap.
    const bytes = Buffer.byteLength(JSON.stringify(slice.rows), "utf8");
    expect(slice.rows).toHaveLength(5);
    expect(bytes).toBeLessThan(5 * 1024);
  });

  it("reads a permission blocker's tool and nothing else about it", () => {
    const blocked = slice.rows.find((row) => row.status === "blocked");
    expect(blocked?.blockers).toEqual([
      { id: "perm-9f2c", kind: "permission", since: "2026-09-13T18:42:11.000Z", tool: "Bash" },
    ]);
  });

  it("states the honest faces: a pending row is ALIVE and undriven, an ended PTY is not alive", () => {
    const pending = slice.rows.find((row) => row.pending !== undefined);
    expect(pending?.pending).toBe("resume-when-idle");
    // AR-4 (ruled 2026-09-13): its PTY is on the floor, so the run IS alive —
    // what it lacks is an observer, which is what `pending` says. A reader
    // draws `alive: false` as GONE, and dropping a live agent off a phone is
    // the failure this golden exists to prevent.
    expect(pending?.alive).toBe(true);
    expect(pending?.status).toBe("unknown");
    expect(pending?.terminal?.hosted).toBe("local");

    // and the row whose PTY is gone is the one that says so
    const exited = slice.rows.find((row) => row.terminal?.hosted === "none");
    expect(exited?.alive).toBe(false);
    expect(exited?.pending).toBeUndefined();
  });

  it("refuses a row that lost an identity field, and tolerates an unknown one", () => {
    const [first] = slice.rows;
    const { runtimeRunId: _dropped, ...missing } = first!;
    expect(AgentFieldRow.safeParse(missing).success).toBe(false);

    const future = AgentFieldRow.parse({ ...first, futureField: { mood: "green" } });
    expect((future as Record<string, unknown>)["futureField"]).toEqual({ mood: "green" });
  });
});

describe("MF-1 — the subscription's options (§5)", () => {
  it("defaults to today's subscription when nothing is asked for", () => {
    // Absent projection = `full`: the desktop's renderer must not learn a new
    // frame shape to keep working.
    const parsed = AgentSubscribeParams.parse({});
    expect(parsed.projection).toBeUndefined();
    expect(parsed.minIntervalMs).toBeUndefined();
  });

  it("bounds the floor a caller may ask for", () => {
    expect(
      AgentSubscribeParams.safeParse({ projection: "field", minIntervalMs: 250 }).success,
    ).toBe(true);
    // faster than the fold's own tick is not a cadence anyone can be served
    expect(AgentSubscribeParams.safeParse({ minIntervalMs: 15 }).success).toBe(false);
    expect(AgentSubscribeParams.safeParse({ minIntervalMs: 60_001 }).success).toBe(false);
    expect(AgentSubscribeParams.safeParse({ projection: "mirror" }).success).toBe(false);
  });
});

describe("AR-6-0 — the interrupt's answer", () => {
  it("discriminates on `accepted`, and a refusal must say why", () => {
    expect(AgentInterruptResult.parse({ accepted: true })).toEqual({ accepted: true });
    expect(AgentInterruptResult.safeParse({ accepted: false }).success).toBe(false);
    expect(
      AgentInterruptResult.parse({ accepted: false, reason: "no-terminal-host" }),
    ).toMatchObject({ accepted: false, reason: "no-terminal-host" });
  });
});
