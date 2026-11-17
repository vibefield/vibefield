import type { CallerContext, ObjectIntent } from "@vibefield/contracts";
import { METHODS, TAILNET_SCOPES } from "@vibefield/contracts";
import { AuditActionV1 } from "@vibefield/contracts/diagnostics";
import { afterEach, describe, expect, it } from "vitest";
import { type ObjectDoorsApi, registerObjectDoors } from "../src/objects/doors";
import type { ToolPlaneAudit } from "../src/tool-plane";
import { cleanupWorlds, DOC, world } from "./desk-fixtures";

// OB-3a — the window's door: ten `objects.*` rows, local-only, each held to a window's own token (a scope alone is not
// the person's window), and the person's acts audited. Rows are called through a fake API, as registerObjectDoors hands
// them to the real one.

afterEach(cleanupWorlds);

const TEN = [
  "objects.intents.subscribe",
  "objects.intent.answer",
  "objects.ref",
  "objects.hand",
  "objects.undoAgent",
  "objects.takeBack",
  "objects.resolve",
  "objects.held",
  "objects.grants",
  "objects.presence.subscribe",
];

type Handler = (ctx: CallerContext, params: unknown) => unknown;
type SubHandler = (
  ctx: CallerContext,
  params: unknown,
  emit: (payload: unknown, kind?: "delta" | "snapshot") => void,
) => { snapshot: unknown; start?: () => void; dispose(): void };

function doors(h: ReturnType<typeof world>) {
  const rows = new Map<string, Handler>();
  const subs = new Map<string, SubHandler>();
  const audited: unknown[] = [];
  const audit: ToolPlaneAudit = {
    required: async (ctx, mutation, effect, describe) => {
      // the real writer refuses an action outside the audit's own grammar: the fake holds the door to it as well
      AuditActionV1.parse(mutation.action);
      const value = await effect();
      audited.push({
        action: mutation.action,
        target: mutation.target,
        attrs: mutation.attrs,
        principal: ctx.principal,
        outcome: describe?.(value).outcome,
      });
      return value;
    },
  };
  const api: ObjectDoorsApi = {
    register: (method, handler) => rows.set(method, handler as Handler),
    registerSubscription: (method, handler) => subs.set(method, handler as SubHandler),
  };
  const windows = new Set(["tok-window"]);
  /** a row, called as the product API calls it: its answer, whether or not it awaits anything */
  const ask = async (method: string, ctx: CallerContext, params: unknown) => {
    const row = rows.get(method);
    if (row === undefined) throw new Error(`no row ${method}`);
    return row(ctx, params);
  };
  registerObjectDoors(api, {
    objects: h.desk,
    audit,
    isWindowToken: (id) => windows.has(id),
    presenceIntervalMs: 1,
  });
  return { rows, subs, audited, windows, ask };
}

const ctxOf = (principal: CallerContext["principal"]): CallerContext => ({
  principal,
  transport: "ws-loopback",
  receivedAt: 0,
});
const WINDOW = ctxOf({ kind: "local-token", tokenId: "tok-window", scopes: ["objects.window"] });

describe("the window's door (OB-3a)", () => {
  it("is ten rows, every one `objects.window` and local, and the scope is never on the tailnet", () => {
    const rows = METHODS.filter((m) => m.method.startsWith("objects."));
    expect(rows.map((m) => m.method).sort()).toEqual([...TEN].sort());
    for (const row of rows) {
      expect(row.scope, row.method).toBe("objects.window");
      expect(row.locality, row.method).toBe("local");
    }
    expect(TAILNET_SCOPES).not.toContain("objects.window");
  });

  it("registers exactly those ten", () => {
    const h = world();
    const { rows, subs } = doors(h);
    expect([...rows.keys(), ...subs.keys()].sort()).toEqual([...TEN].sort());
  });

  it("refuses every row to anything but a window's own token, whatever scope it holds", async () => {
    const h = world();
    const { rows, subs } = doors(h);
    const strangers = [
      ctxOf({ kind: "local-token", tokenId: "tok-plugin", scopes: ["objects.window"] }),
      ctxOf({ kind: "shell-main", tokenId: "tok-window", scopes: ["objects.window"] }),
      ctxOf({ kind: "mcp-agent", sessionId: "run-a", scopes: ["objects.window"] }),
    ];
    for (const stranger of strangers) {
      for (const [method, handler] of rows)
        await expect(
          (async () => handler(stranger, { ref: "vf:obj/aaaaaaaa", run: "run-a" }))(),
          method,
        ).rejects.toMatchObject({ kind: "FORBIDDEN_SCOPE" });
      for (const [method, handler] of subs)
        expect(() => handler(stranger, { docId: DOC }, () => undefined), method).toThrowError(
          /window's own/,
        );
    }
  });

  it("names an object, and resolves it back", async () => {
    const h = world();
    const { ask } = doors(h);
    const named = (await ask("objects.ref", WINDOW, { docId: DOC, key: "k1" })) as {
      ref: string;
    };
    expect(named.ref).toMatch(/^vf:obj\//);
    await expect(ask("objects.resolve", WINDOW, { ref: named.ref })).resolves.toEqual({
      found: true,
      docId: DOC,
      key: "k1",
    });
    await expect(ask("objects.resolve", WINDOW, { ref: "vf:obj/zzzzzzzz" })).resolves.toEqual({
      found: false,
    });
  });

  it("audits a hand and a take-back as the person's, by ref and run, and marks a refused hand denied", async () => {
    const h = world();
    const { ask, audited } = doors(h);
    const ref = h.refOf("k1");
    await expect(ask("objects.hand", WINDOW, { ref, run: "run-a" })).resolves.toEqual({
      handed: true,
    });
    await expect(ask("objects.hand", WINDOW, { ref, run: "run-none" })).resolves.toMatchObject({
      handed: false,
    });
    await expect(ask("objects.takeBack", WINDOW, { ref, run: "run-a" })).resolves.toEqual({
      taken: true,
    });
    expect(audited).toEqual([
      expect.objectContaining({
        action: "objects.hand",
        target: { kind: "object", id: ref },
        attrs: { run: "run-a" },
        outcome: "succeeded",
      }),
      expect.objectContaining({ action: "objects.hand", outcome: "denied" }),
      expect.objectContaining({ action: "objects.take_back", attrs: { run: "run-a" } }),
    ]);
    expect(h.desk.registry.grantOf(ref, "run-a")).toBeUndefined();
  });

  it("lists who holds what, so a forgotten grant can be found and taken back (§11)", async () => {
    const h = world();
    const { ask } = doors(h);
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-a");
    await expect(ask("objects.grants", WINDOW, {})).resolves.toEqual({
      grants: [
        expect.objectContaining({
          ref,
          docId: DOC,
          key: "k1",
          kind: "desk.note",
          holder: "run-a",
          name: "claude·a",
          how: "handed",
        }),
      ],
    });
    await expect(ask("objects.grants", WINDOW, { ref: "vf:obj/zzzzzzzz" })).resolves.toEqual({
      grants: [],
    });
    await expect(
      (async () => ask("objects.grants", WINDOW, { ref: "nope" }))(),
    ).rejects.toMatchObject({ kind: "PRECONDITION_FAILED" });
  });

  it("refuses malformed params rather than guessing", async () => {
    const h = world();
    const { ask } = doors(h);
    await expect(
      (async () => ask("objects.hand", WINDOW, { ref: "not-a-ref", run: "run-a" }))(),
    ).rejects.toMatchObject({ kind: "PRECONDITION_FAILED" });
    await expect(
      (async () => ask("objects.intent.answer", WINDOW, { intent: "x" }))(),
    ).rejects.toMatchObject({ kind: "PRECONDITION_FAILED" });
  });

  it("carries a board's intents to its subscriber and takes the answer from that window alone", async () => {
    const h = world();
    const { ask, subs, windows } = doors(h);
    windows.add("tok-other");
    const sent: ObjectIntent[] = [];
    const sub = subs.get("objects.intents.subscribe")?.(WINDOW, { docId: DOC }, (intent) =>
      sent.push(intent as ObjectIntent),
    );
    expect(sub?.snapshot).toEqual({ docId: DOC });
    sub?.start?.();
    const asked = h.desk.intents.ask(DOC, { op: "list", run: "run-a", handle: "claude·a" });
    expect(sent).toHaveLength(1);
    const id = sent[0]?.intent;
    const other = ctxOf({ kind: "local-token", tokenId: "tok-other", scopes: ["objects.window"] });
    await expect(
      ask("objects.intent.answer", other, { intent: id, ok: true, value: {} }),
    ).resolves.toEqual({ taken: false });
    await expect(
      ask("objects.intent.answer", WINDOW, { intent: id, ok: true, value: { objects: [] } }),
    ).resolves.toEqual({ taken: true });
    await expect(asked).resolves.toEqual({ value: { objects: [] } });
    // the second answer is not taken
    await expect(
      ask("objects.intent.answer", WINDOW, { intent: id, ok: true, value: {} }),
    ).resolves.toEqual({ taken: false });
    sub?.dispose();
  });

  it("serves presence as whole lists", () => {
    const h = world();
    const { subs } = doors(h);
    const opened = subs.get("objects.presence.subscribe")?.(WINDOW, {}, () => undefined);
    expect(opened?.snapshot).toEqual({ objects: [] });
    opened?.dispose();
  });
});
