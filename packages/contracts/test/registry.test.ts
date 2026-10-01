import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { IndexOpenTicketParams } from "../src/agent-index";
import { ARTIFACT_LIMITS } from "../src/artifacts";
import { DEVICE_LIMITS } from "../src/devices";
import { RpcNotification } from "../src/envelope";
import { KEYED_FORWARD_METHODS } from "../src/forwarding";
import {
  defineMethod,
  LOCALITIES,
  METHODS,
  PRODUCT_NOTIFICATIONS,
  reachableFromTailnet,
  SURFACES,
  SystemTick,
} from "../src/methods";
import {
  AGENT_FIELD,
  DESKTOP_APP_ID,
  DESKTOP_TRAY_GUID,
  HOST_SINGLETON_EXTERNALS,
  HOST_SINGLETON_MODULE_SPECIFIERS,
  INDEX_MESH,
  LOG_STREAMS,
  MESH_CONTROL_LIMITS,
  PEER_FIELDD_SCOPES,
  PORTS,
  PRODUCT_API_LIMITS,
  ROWS,
  SCOPES,
  SOCKETS,
  STORES,
  TAILNET_SCOPES,
} from "../src/registries";
import {
  TerminalOpenTicketParams,
  TerminalTakeGeometryParams,
  TerminalTerminateParams,
} from "../src/terminal";
import { TerminalRenewAttachParams } from "../src/terminal-pipeline";

describe("PRODUCT_API_LIMITS — the door's inbound cap is a registry number (DS wave 3 landing)", () => {
  it("names the 4 MiB inbound cap the door enforces, beside the outbound pair in MESH_CONTROL_LIMITS", () => {
    expect(PRODUCT_API_LIMITS.WS_MAX_INBOUND_BYTES).toBe(4 * 1024 * 1024);
    expect(PRODUCT_API_LIMITS.WS_MAX_INBOUND_BYTES).toBeLessThan(
      MESH_CONTROL_LIMITS.PRODUCT_FRAME_BYTES,
    );
  });
});

describe("method registry lint (design-01 §9.2 + D36)", () => {
  it("every method is fully declared", () => {
    for (const m of METHODS) {
      expect(SURFACES).toContain(m.surface);
      expect(LOCALITIES, `${m.method} missing locality`).toContain(m.locality);
      if (m.scope !== null) expect(SCOPES).toContain(m.scope);
      expect(m.method).toMatch(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/);
      expect(typeof m.idempotent).toBe("boolean");
    }
  });
  it("method names are unique", () => {
    const names = METHODS.map((m) => m.method);
    expect(new Set(names).size).toBe(names.length);
  });

  it("keeps the renderer update participant lane local and identity-gated by handlers", () => {
    expect(
      METHODS.filter((method) => method.method.startsWith("plugins.update.")).map((method) => ({
        method: method.method,
        scope: method.scope,
        locality: method.locality,
        subscription: method.subscription ?? false,
      })),
    ).toEqual([
      {
        method: "plugins.update.subscribe",
        scope: "plugins.read",
        locality: "local",
        subscription: true,
      },
      {
        method: "plugins.update.ack",
        scope: "plugins.read",
        locality: "local",
        subscription: false,
      },
      {
        method: "plugins.update.source",
        scope: "plugins.read",
        locality: "local",
        subscription: false,
      },
      {
        method: "plugins.update.source.release",
        scope: "plugins.read",
        locality: "local",
        subscription: false,
      },
      {
        method: "plugins.update.leave",
        scope: "plugins.read",
        locality: "local",
        subscription: false,
      },
    ]);
  });

  it("pins the product API's per-connection subscription budget", () => {
    // A number the DOOR enforces (product-api.ts refuses past it with
    // RESOURCE_EXHAUSTED), so it moves here deliberately or not at all: raising
    // it raises what one socket can make this daemon do on every tick, and
    // lowering it can refuse a window that legitimately watches several streams.
    expect(PRODUCT_API_LIMITS.SUBSCRIPTIONS_PER_CONNECTION).toBe(32);
    expect(Number.isSafeInteger(PRODUCT_API_LIMITS.SUBSCRIPTIONS_PER_CONNECTION)).toBe(true);
    expect(PRODUCT_API_LIMITS.SUBSCRIPTIONS_PER_CONNECTION).toBeGreaterThan(
      // the desktop's own busiest window: health, the fold, usage, the deck's
      // routes, docs and artifacts, with room to spare
      8,
    );
  });

  it("socket names fit the tightest path budget (UA-D9 — sun_path)", () => {
    // The tightest real prefix is the repo-nested dev root's users/<fuid>
    // tree; 14 chars keeps every socket under the 103-byte macOS sun_path
    // ceiling there with three-digit-fuid headroom. 2026-08-05:
    // terminal-control.sock (21 chars → a 108-byte path) crashed the dev
    // terminal plane exactly this way — bind failed, the guard had only
    // measured mgmt.sock. Longer names need a shallower tree, not a waiver.
    for (const name of Object.values(SOCKETS)) {
      expect(name.endsWith(".sock"), `${name} must end .sock`).toBe(true);
      expect(name.length, `${name} exceeds the 14-char socket name budget`).toBeLessThanOrEqual(14);
    }
  });

  it("guestOk methods are idempotent, non-mutating, and exactly the v1 set (UA-4 / UA-D14)", () => {
    const guestOk = METHODS.filter((m) => m.guestOk === true);
    // spec §7.3 v1 law: system.hello only. Widening is a deliberate edit
    // against this pin, never drift.
    expect(guestOk.map((m) => m.method)).toEqual(["system.hello"]);
    for (const m of guestOk) {
      expect(m.idempotent, `${m.method}: guestOk ⇒ idempotent`).toBe(true);
      expect(
        m.scope === null || /\.(read|observe)$/.test(m.scope),
        `${m.method}: guestOk ⇒ non-mutating scope (got ${m.scope})`,
      ).toBe(true);
    }
  });

  // DS-2 (2026-09-30, DS-D1 — thinking-desktop-sync-plane.md §6.1; design-04
  // §7's census): agent and index reads/acts left `local`. Two walls must not
  // move with them, and a new row is held to them here rather than by review.
  it("DS-2: a guest reaches nothing that leaves its device — every guestOk row is local", () => {
    for (const m of METHODS.filter((m) => m.guestOk === true))
      expect(m.locality, `${m.method}: guestOk ⇒ local`).toBe("local");
  });

  it("DS-2: tokens, native, plugins, diagnostics and audit stay local on the product surface", () => {
    const localForever = new Set([
      "tokens.mint",
      "native.admin",
      "plugins.read",
      "plugins.manage",
      "plugins.serve",
      "diagnostics.read",
      "diagnostics.manage",
      "audit.append",
    ]);
    for (const m of METHODS.filter((m) => m.surface === "product")) {
      if (m.scope !== null && localForever.has(m.scope))
        expect(m.locality, `${m.method} (${m.scope})`).toBe("local");
      // the receipt door reads THIS daemon's journal of its own forwards
      if (m.method.startsWith("forward.")) expect(m.locality, m.method).toBe("local");
    }
  });
});

// SP-1 (SP-L4 — `thinking-sync-planes.md` §3, §6; design-06 §2.2) — every
// subscription a phone or a peer daemon can open says what its frames are and
// how often they can come. A bare `true` is where a door that pours whole
// boards at a radio hides, so the lint refuses it wherever the tailnet reaches.
describe("SP-1 — the subscription descriptor (SP-L4)", () => {
  const product = METHODS.filter((m) => m.surface === "product");
  const subscriptions = product.filter((m) => m.subscription !== undefined);

  it("refuses a bare `true` on every subscription reachable from the tailnet", () => {
    const bare = subscriptions
      .filter((m) => reachableFromTailnet(m) && m.subscription === true)
      .map((m) => m.method);
    expect(
      bare,
      "declare `subscription: {shape, cadenceFloorMs}` (methods.ts SUBSCRIPTION_SHAPES) on each",
    ).toEqual([]);
  });

  it("reads reachability from both presets and from the two localities that cross devices", () => {
    // a scope the phone holds, one only a peer daemon holds, a locality that
    // federates — and `local` alone never decides it (the wall refuses a
    // `local` method to a peer daemon, never to a phone)
    const row = (scope: (typeof SCOPES)[number] | null, locality: (typeof LOCALITIES)[number]) =>
      reachableFromTailnet({
        surface: "product",
        method: "x.probe",
        scope,
        idempotent: true,
        locality,
      });
    expect(row("workspace.read", "local")).toBe(true);
    expect(TAILNET_SCOPES).not.toContain("index.search");
    expect(PEER_FIELDD_SCOPES).toContain("index.search");
    expect(row("index.search", "local")).toBe(true);
    expect(row("settings.manage", "stream")).toBe(true);
    expect(row("settings.manage", "federate")).toBe(true);
    expect(row("settings.manage", "sync")).toBe(false);
    expect(row(null, "local")).toBe(false);
    expect(
      reachableFromTailnet({
        surface: "mgmt",
        method: "native.probe",
        scope: null,
        idempotent: true,
        locality: "stream",
      }),
    ).toBe(false);
  });

  it("names every tailnet-reachable subscription and what its frames are", () => {
    // A widening is a deliberate edit against this pin. Each floor is a
    // registry number the door ENFORCES (a caller may ask slower, never
    // faster) — fieldd's projection.ts and the handlers in daemon.ts.
    const reachable = Object.fromEntries(
      subscriptions.filter(reachableFromTailnet).map((m) => [m.method, m.subscription]),
    );
    const stream = { shape: "stream", cadenceFloorMs: PRODUCT_API_LIMITS.STREAM_MIN_INTERVAL_MS };
    expect(reachable).toEqual({
      "artifact.subscribe": stream,
      "device.subscribe": stream,
      "services.subscribe": stream,
      "agents.profileSets.subscribe": stream,
      "index.catalog.subscribe": { shape: "rows", cadenceFloorMs: ROWS.MIN_INTERVAL_MS },
      "index.changes.subscribe": {
        shape: "rows",
        cadenceFloorMs: INDEX_MESH.CHANGES_MIN_INTERVAL_MS,
      },
      "agent.subscribe": {
        // the bare ask is the full fold at its own tick — served to a phone
        // that asks it (refuseBoardAsk refuses it to a peer daemon only)
        shape: "stream",
        cadenceFloorMs: AGENT_FIELD.FULL_TICK_MS,
        variants: {
          '{projection: "field"}': {
            shape: "snapshot-delta",
            cadenceFloorMs: AGENT_FIELD.MIN_INTERVAL_MS,
          },
          '{projection: "desk"}': {
            shape: "snapshot-delta",
            cadenceFloorMs: AGENT_FIELD.DESK_MIN_INTERVAL_MS,
          },
          '{scope: "mesh", projection: "field"}': {
            shape: "rows",
            cadenceFloorMs: AGENT_FIELD.MIN_INTERVAL_MS,
          },
          '{scope: "mesh", projection: "desk"}': {
            shape: "rows",
            cadenceFloorMs: AGENT_FIELD.DESK_MIN_INTERVAL_MS,
          },
        },
      },
    });
    // the board's floors, as design-06 §8 rules them
    expect(AGENT_FIELD.MIN_INTERVAL_MS).toBe(250);
    expect(AGENT_FIELD.DESK_MIN_INTERVAL_MS).toBe(100);
    expect(PRODUCT_API_LIMITS.STREAM_MIN_INTERVAL_MS).toBe(250);
  });

  it("keeps a census of the scope-null product subscriptions, whose reach is their handler's", () => {
    // `scope: null` passes every hello'd principal through the registry's
    // gate — a phone included — and only a handler can narrow it, which the
    // registry cannot see. So each one is NAMED here with the GATE that decides
    // its reach, and a new one fails this pin until somebody says what its gate
    // is. fieldd's scope-null-gates.test.ts dials each one as the phone and
    // proves the refusal at the real door.
    const census: Record<string, string> = {
      // D36 (2026-10-01, DS wave 3 — the finding SP-1 recorded here: "NO handler
      // gate: a phone can open it"). The stream is this desktop's whole
      // judgment of its own planes, so its handler admits this device's own
      // principals only — a window, the shell, a plugin — and a tailnet,
      // tailnet-guest or peer-fieldd principal reads FORBIDDEN_SCOPE. Its
      // `true` stands: no tailnet principal can open it, so SP-1's rule above
      // has nothing to say to it.
      "system.health.subscribe": "this device's principals: local-token, shell-main, plugin",
      // `settingsCaller` (daemon.ts) — a phone is refused
      "storage.settings.subscribe":
        "a plugin with storage.self, or a local window with plugins.manage",
      // `processViewer` (daemon.ts) — the same posture
      "process.subscribe": "a plugin, or a local window with plugins.manage",
    };
    expect(
      subscriptions.filter((m) => m.scope === null).map((m) => [m.method, m.locality]),
    ).toEqual(Object.keys(census).map((method) => [method, "local"]));
  });

  it("defineMethod refuses a descriptor it cannot honour", () => {
    const base = {
      surface: "product" as const,
      method: "x.stream",
      scope: null,
      idempotent: true,
      locality: "local" as const,
    };
    expect(() =>
      defineMethod({ ...base, subscription: { shape: "rows", cadenceFloorMs: 100 } }),
    ).not.toThrow();
    expect(() =>
      defineMethod({ ...base, subscription: { shape: "blob" as never, cadenceFloorMs: 100 } }),
    ).toThrow(/unknown subscription shape on x\.stream/);
    expect(() =>
      defineMethod({ ...base, subscription: { shape: "stream", cadenceFloorMs: 0 } }),
    ).toThrow(/subscription floor on x\.stream/);
    expect(() =>
      defineMethod({
        ...base,
        subscription: {
          shape: "stream",
          cadenceFloorMs: 250,
          variants: { "{fast: true}": { shape: "stream", cadenceFloorMs: 2.5 } },
        },
      }),
    ).toThrow(/subscription floor on x\.stream \(\{fast: true\}\)/);
  });
});

// SP-1 / SP-L7 (`thinking-sync-planes.md` §1.9 item 1) — the door's keepalive.
// truffle's sidecar reaps a served WebSocket silent for ten minutes and an idle
// board sends nothing, so the door ticks on every hello'd connection.
describe("SP-1 — system.tick, the door's keepalive (SP-L7)", () => {
  it("is a NOTIFICATION: named beside the methods, never a method a client could call", () => {
    expect(PRODUCT_NOTIFICATIONS).toEqual({ TICK: "system.tick" });
    const methods = new Set(METHODS.map((m) => m.method));
    // a subscription's own frames are `<base>.delta` / `<base>.snapshot`
    const frames = new Set(
      METHODS.filter((m) => m.subscription !== undefined).flatMap((m) => {
        const base = m.method.replace(/\.subscribe$/, "");
        return [`${base}.delta`, `${base}.snapshot`];
      }),
    );
    for (const name of Object.values(PRODUCT_NOTIFICATIONS)) {
      expect(name).toMatch(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/);
      expect(methods.has(name), `${name} is a METHODS row`).toBe(false);
      expect(frames.has(name), `${name} is a subscription frame`).toBe(false);
    }
  });

  it("ticks well under the sidecar's ten-minute reap, and so does a reader's dead-door deadline", () => {
    expect(PRODUCT_API_LIMITS.TICK_INTERVAL_MS).toBe(120_000);
    // a reader calls a door silent for 2.5 × the interval dead (w2-phone, SP-2)
    expect(PRODUCT_API_LIMITS.TICK_INTERVAL_MS * 2.5).toBeLessThan(10 * 60_000);
  });

  it("parses the golden frame every side reads (EL9): no id, the tick's params", () => {
    const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
    const raw = JSON.parse(readFileSync(join(fixtures, "system-tick.valid.json"), "utf8"));
    const frame = RpcNotification.parse(raw);
    expect(frame.method).toBe(PRODUCT_NOTIFICATIONS.TICK);
    expect("id" in frame).toBe(false);
    expect(SystemTick.parse(frame.params)).toEqual({
      at: 1759312800000,
      intervalMs: PRODUCT_API_LIMITS.TICK_INTERVAL_MS,
    });
    // tolerant of what a later door adds; strict about what a reader times by
    expect(SystemTick.safeParse({ at: 1, intervalMs: 50, door: "next" }).success).toBe(true);
    expect(SystemTick.safeParse({ at: "now", intervalMs: 50 }).success).toBe(false);
    expect(SystemTick.safeParse({ at: 1, intervalMs: 0 }).success).toBe(false);
  });
});

describe("port registry", () => {
  it("no port is assigned twice", () => {
    const values = Object.values(PORTS);
    expect(new Set(values).size).toBe(values.length);
  });

  it("SP-3 — rosettad's serve has its own listener beside the cells' and the door's", () => {
    // design-06 §8 reserved the name for DS-7; SP-3 assigns the number so the
    // ticket template's second instance has a listener to name. Fixed, like
    // its two neighbours: a peer DERIVES the coordinate, it never learns it.
    expect(PORTS.INDEX_SERVE).toBe(9424);
    expect([PORTS.TERMINAL_CELLS_SERVE, PORTS.FIELDD_PRODUCT_SERVE, PORTS.INDEX_SERVE]).toEqual([
      9422, 9423, 9424,
    ]);
  });
});

describe("mesh control limits", () => {
  it("keeps public-store readers on the generated cross-plane budgets", () => {
    expect(ARTIFACT_LIMITS.SLICE_BYTES).toBe(MESH_CONTROL_LIMITS.ARTIFACT_SLICE_BYTES);
    expect(DEVICE_LIMITS.SLICE_BYTES).toBe(MESH_CONTROL_LIMITS.DEVICE_SLICE_BYTES);
    expect(DEVICE_LIMITS.REMOTE_ORIGINS).toBe(MESH_CONTROL_LIMITS.REMOTE_ORIGINS);
    expect(MESH_CONTROL_LIMITS.MGMT_QUEUED_BYTES).toBeGreaterThan(
      MESH_CONTROL_LIMITS.MGMT_FRAME_BYTES,
    );
  });

  it("does not classify a state-advancing preview refresh as replay-safe", () => {
    expect(METHODS.find((method) => method.method === "artifact.refreshPreview")).toMatchObject({
      idempotent: false,
      locality: "local",
    });
  });
});

describe("installed desktop identity", () => {
  it("pins the frozen application and status-item identities", () => {
    expect(DESKTOP_APP_ID).toBe("com.jamesyong.vibefield");
    expect(DESKTOP_TRAY_GUID).toBe("c524c40e-05b6-4d89-bbb9-82ba4e97ea91");
  });
});

describe("host singleton registries (PA-29 / plugin spec §11.6)", () => {
  it("pins the externals list byte-exactly", () => {
    // Every entry is a bundler external at pack time AND an import-map key at
    // load time, so adding or renaming one moves both halves of PA-29 at once.
    // The pin is here to make that a deliberate edit against a failing test.
    expect(HOST_SINGLETON_EXTERNALS).toEqual([
      "react",
      "react-dom",
      "react/jsx-runtime",
      "three",
      "@react-three/fiber",
      "@react-three/drei",
      "@vibefield/plugin-sdk",
      "@vibecook/ice",
      "loro-crdt",
    ]);
  });

  it("binds at least every external, and every extra is a subpath of one", () => {
    for (const external of HOST_SINGLETON_EXTERNALS) {
      expect(HOST_SINGLETON_MODULE_SPECIFIERS, `${external} must be bindable`).toContain(external);
    }
    // The subpath arm is why the two lists differ at all: the bundler
    // externalizes by prefix, so an artifact emits `@vibefield/plugin-sdk/ui`
    // while the root list only names `@vibefield/plugin-sdk`. What it must NOT
    // grow is a specifier rooted outside PA-29 — that would be the host
    // offering a module no singleton rule covers.
    const extras = HOST_SINGLETON_MODULE_SPECIFIERS.filter(
      (spec) => !(HOST_SINGLETON_EXTERNALS as readonly string[]).includes(spec),
    );
    expect(extras).toEqual([
      "@vibefield/plugin-sdk/ui",
      "@vibefield/plugin-sdk/canvas",
      "@vibefield/plugin-sdk/behavior",
    ]);
    for (const extra of extras) {
      expect(
        HOST_SINGLETON_EXTERNALS.some((root) => extra.startsWith(`${root}/`)),
        `${extra} is not a subpath of any host singleton`,
      ).toBe(true);
    }
  });

  it("names each module once — an import map key cannot be declared twice", () => {
    expect(new Set(HOST_SINGLETON_MODULE_SPECIFIERS).size).toBe(
      HOST_SINGLETON_MODULE_SPECIFIERS.length,
    );
  });
});

describe("logging registries (LOG-43/LOG-44)", () => {
  it("declares unique, fixed category/basename pairs", () => {
    const streams = Object.values(LOG_STREAMS);
    expect(new Set(streams).size).toBe(streams.length);
    for (const stream of streams) {
      expect(stream).toMatch(/^(?:system|plugins)\/[a-z][a-z-]*$/);
    }
  });

  it("keeps diagnostics and audit scopes local-only", () => {
    for (const scope of [
      "diagnostics.read",
      "diagnostics.manage",
      "audit.append",
      "settings.manage",
    ] as const) {
      expect(SCOPES).toContain(scope);
      expect(TAILNET_SCOPES).not.toContain(scope);
    }
  });

  it("declares the exact trusted app-preference surface", () => {
    const methods = METHODS.filter((method) => method.method.startsWith("storage.appPreferences."));
    expect(methods.map((method) => method.method)).toEqual([
      "storage.appPreferences.get",
      "storage.appPreferences.set",
      "storage.appPreferences.subscribe",
    ]);
    for (const method of methods) {
      expect(method.scope).toBe("settings.manage");
      expect(method.locality).toBe("sync");
    }
  });

  it("declares the exact AH-3 static shell provider surface", () => {
    const methods = METHODS.filter((method) => method.method.startsWith("shell."));
    expect(methods.map((method) => method.method)).toEqual([
      "shell.provider.register",
      "shell.provider.resolve",
      "shell.dialog.pickFolder",
      "shell.openExternal",
    ]);
    expect(methods.map(({ scope }) => scope)).toEqual([null, null, "shell.dialog", "shell.open"]);
    expect(methods.every(({ locality }) => locality === "local")).toBe(true);
  });
});

describe("MF-1 — the field's two new doors and its store (§10.1)", () => {
  it("declares agent.interrupt as a control act on the run's own device", () => {
    expect(METHODS.find((method) => method.method === "agent.interrupt")).toEqual({
      surface: "product",
      method: "agent.interrupt",
      // the AR-3 trio's steering scope: not the fold's read, not a birth
      scope: "agent.control",
      // a second interrupt is a second act, never a replay of the first
      idempotent: false,
      // DS-2 (2026-09-30): executed only on the device that owns the run,
      // reached by routing — it was `local`, which refused the routing
      locality: "federate",
    });
    // and it is reachable from the phone: agent.control is in the tailnet preset
    expect(TAILNET_SCOPES).toContain("agent.control");
  });

  // TM-3 (2026-09-14, TM-D3) — the inverse of the row this replaces. The
  // registry used to declare `terminal.mirrorWriteGrant` on `terminal.attach`,
  // the door that handed a self peer the floor's DURABLE write secret, and
  // `native.terminal.mirrorWriteCapability`, the mgmt hop that carried it off
  // the floor. Both are deleted: the right to type is a claim in the per-client
  // expiring attach grant the ticket already mints. A registry is the one place
  // a retired door can quietly come back — a row costs a caller nothing to add
  // and nothing in the tree would notice — so the absence is asserted, not
  // assumed. `terminal.attach` stays in the tailnet preset: the phone still
  // attaches, and it is the GRANT in its ticket that says whether it may type.
  it("names no mirror-write door on any surface", () => {
    expect(METHODS.map((method) => method.method).filter((m) => /[Mm]irrorWrite/.test(m))).toEqual(
      [],
    );
    expect(TAILNET_SCOPES).toContain("terminal.attach");
  });

  it("names the field store and bounds its slice like every other public store", () => {
    expect(STORES.AGENT_FIELD).toBe("field.agents.v1");
    expect(MESH_CONTROL_LIMITS.AGENT_FIELD_SLICE_BYTES).toBe(64 * 1024);
  });

  it("keeps the field's cadences trailing-edge and its expiry survivable", () => {
    expect(AGENT_FIELD.MIN_INTERVAL_MS).toBe(250);
    expect(AGENT_FIELD.STORE_MIN_INTERVAL_MS).toBe(250);
    // two lost heartbeats must not blank a live desktop's field on a reader
    expect(AGENT_FIELD.STORE_EXPIRY_MS).toBeGreaterThanOrEqual(AGENT_FIELD.STORE_HEARTBEAT_MS * 3);
  });
});

// DS-4 (design-06 §6; design-04 §7's 2026-09-30 note) — a terminal on another
// desktop: the three doors a window's daemon forwards to the owner are
// `federate`, everything else on the terminal surface stays this device's.
describe("DS-4 — the terminal doors routable to the owner", () => {
  it("reclassifies exactly openTicket, renewAttach and terminate", () => {
    const localities = Object.fromEntries(
      METHODS.filter(
        (m) =>
          m.surface === "product" &&
          m.method.startsWith("terminal.") &&
          !m.method.startsWith("terminal.config."),
      ).map((m) => [m.method, m.locality]),
    );
    expect(localities).toEqual({
      "terminal.list": "local",
      "terminal.sessions": "local",
      "terminal.get": "local",
      "terminal.openTicket": "federate",
      "terminal.create": "local",
      "terminal.renewAttach": "federate",
      "terminal.roster": "local",
      "terminal.terminate": "federate",
      "terminal.takeGeometry": "local",
      "terminal.link.open": "local",
    });
  });

  it("declares the take's product door for the phone (served UNAVAILABLE until DS-4b)", () => {
    expect(METHODS.find((m) => m.method === "terminal.takeGeometry")).toEqual({
      surface: "product",
      method: "terminal.takeGeometry",
      scope: "terminal.attach",
      idempotent: false,
      locality: "local",
    });
    expect(TerminalTakeGeometryParams.safeParse({ sessionId: "s1" }).success).toBe(true);
    expect(TerminalTakeGeometryParams.safeParse({}).success).toBe(false);
  });

  it("lets the routable doors carry `device`, and nothing else changes about them", () => {
    for (const schema of [TerminalOpenTicketParams, TerminalTerminateParams]) {
      expect(schema.parse({ sessionId: "s1", device: "dev-a" })).toEqual({
        sessionId: "s1",
        device: "dev-a",
      });
      expect(schema.safeParse({ sessionId: "s1", device: "" }).success).toBe(false);
      expect(schema.safeParse({ device: "dev-a" }).success).toBe(false);
    }
    expect(
      TerminalRenewAttachParams.parse({
        sessionId: "s1",
        expectGeneration: 2,
        requestId: "r1",
        device: "dev-a",
      }).device,
    ).toBe("dev-a");
  });
});

// SP-3 (thinking-sync-planes.md §5.4, §6; design-06 §6, §8) — the direct
// plane's door, DECLARED: its handler answers `direct-plane-unbuilt` until DS-7
// mints rosetta's grant (RO-10) at the pin move.
describe("SP-3 — index.openTicket, declared", () => {
  it("is a mint at the owner — index.read, federate, not idempotent — so a routed one is keyed", () => {
    const def = METHODS.find((m) => m.method === "index.openTicket");
    expect(def).toEqual({
      surface: "product",
      method: "index.openTicket",
      scope: "index.read",
      idempotent: false,
      locality: "federate",
    });
    // DS-D15 — the client mints one key per logical call and the owner
    // journals its receipt under it
    expect(KEYED_FORWARD_METHODS.has("index.openTicket")).toBe(true);
    // reachable from the tailnet — the phone's preset and a peer daemon's both
    // hold index.read, and `federate` crosses devices by definition — and NOT
    // a subscription, so SP-1's descriptor rule has nothing to ask of it
    expect(TAILNET_SCOPES).toContain("index.read");
    expect(PEER_FIELDD_SCOPES).toContain("index.read");
    expect(reachableFromTailnet(def!)).toBe(true);
    expect(def?.subscription).toBeUndefined();
  });

  it("takes a session and the device? that holds it", () => {
    expect(IndexOpenTicketParams.parse({ sessionId: "s1", device: "dev-a" })).toEqual({
      sessionId: "s1",
      device: "dev-a",
    });
    expect(IndexOpenTicketParams.safeParse({ sessionId: "" }).success).toBe(false);
    expect(IndexOpenTicketParams.safeParse({ device: "dev-a" }).success).toBe(false);
    expect(IndexOpenTicketParams.safeParse({ sessionId: "s1", device: "" }).success).toBe(false);
  });
});
