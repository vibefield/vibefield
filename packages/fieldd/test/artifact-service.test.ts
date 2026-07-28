// C6-6 — the artifact hub. Unit half: ArtifactService against a fake serve
// bridge (registry durability, replay, validation, status fusion, teardown).
// Integration half: a REAL daemon over the mock mgmt server — publish through
// the product WS, the serve appears in health beside the product serve with a
// URL, the registry REPLAYS across a fieldd restart while the mock (playing
// field-native, which outlives fieldd) keeps its serve set, and the scope
// gate holds.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ARTIFACT_SERVE_PREFIX, type ArtifactStatus } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { type ArtifactServeBridge, ArtifactService } from "../src/artifact-service";
import { bootstrap } from "../src/index";
import type { ServeSpec, ServeState } from "../src/mesh-client";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { helloAs, until, WsRpc } from "./ws-rpc";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

function makeDataDir(): string {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-c66-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  return dataDir;
}

class FakeBridge implements ArtifactServeBridge {
  declared: ServeSpec[][] = [];
  serveStates: ServeState[] = [];
  listeners = new Set<() => void>();
  failDeclare = false;

  async declare(specs: ServeSpec[]): Promise<void> {
    if (this.failDeclare) throw new Error("mesh node not up");
    this.declared.push(specs);
  }
  states(): ServeState[] {
    return this.serveStates;
  }
  on(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  fire(): void {
    for (const cb of this.listeners) cb();
  }
  last(): ServeSpec[] {
    return this.declared.at(-1) ?? [];
  }
}

function service(dataDir: string, bridge: FakeBridge): ArtifactService {
  return new ArtifactService({ dataDir, bridge });
}

describe("ArtifactService (unit)", () => {
  it("publish declares a prefixed serve, persists intent, and answers pending honestly", async () => {
    const dataDir = makeDataDir();
    const bridge = new FakeBridge();
    const svc = service(dataDir, bridge);
    await svc.start();
    const status = await svc.publish({ name: "web", target: { kind: "port", port: 3000 } });
    expect(status.status).toBe("pending"); // no serve state yet — declared, not carried
    expect(bridge.last()).toEqual([
      { name: "artifact-web", target: { kind: "port", port: 3000 }, tls: false },
    ]);
    const file = JSON.parse(
      readFileSync(join(dataDir, "registries", "field.artifacts.v1.json"), "utf8"),
    );
    expect(file.artifacts).toHaveLength(1);
    expect(file.artifacts[0]).toMatchObject({ name: "web" });
  });

  it("fuses the serve's live verdict — url when active, error verbatim, never a stale mix", async () => {
    const bridge = new FakeBridge();
    const svc = service(makeDataDir(), bridge);
    await svc.start();
    await svc.publish({ name: "web", target: { kind: "port", port: 3000 } });
    bridge.serveStates = [
      {
        name: `${ARTIFACT_SERVE_PREFIX}web`,
        target: { kind: "port", port: 3000 },
        status: "active",
        url: "https://mock.ts.net/artifact-web",
      },
    ];
    expect(svc.statuses()[0]).toMatchObject({
      name: "web",
      status: "active",
      url: "https://mock.ts.net/artifact-web",
    });
    bridge.serveStates = [
      {
        name: `${ARTIFACT_SERVE_PREFIX}web`,
        target: { kind: "port", port: 3000 },
        status: "error",
        error: "proxy bind failed",
      },
    ];
    const errored = svc.statuses()[0] as ArtifactStatus;
    expect(errored.status).toBe("error");
    expect(errored.error).toBe("proxy bind failed");
    expect(errored.url).toBeUndefined();
  });

  it("replays the persisted set on a fresh start — re-serving is re-creating", async () => {
    const dataDir = makeDataDir();
    const first = new FakeBridge();
    const one = service(dataDir, first);
    await one.start();
    await one.publish({ name: "web", target: { kind: "port", port: 3000 }, allow: ["*.html"] });
    one.dispose();

    const second = new FakeBridge();
    const two = service(dataDir, second);
    await two.start();
    expect(second.last()).toEqual([
      {
        name: "artifact-web",
        target: { kind: "port", port: 3000 },
        allow: ["*.html"],
        tls: false,
      },
    ]);
  });

  it("upserts by name; unpublish removes and re-declares without it", async () => {
    const bridge = new FakeBridge();
    const svc = service(makeDataDir(), bridge);
    await svc.start();
    await svc.publish({ name: "web", target: { kind: "port", port: 3000 } });
    await svc.publish({ name: "web", target: { kind: "port", port: 4000 } });
    expect(bridge.last()).toHaveLength(1);
    expect(bridge.last()[0]?.target).toEqual({ kind: "port", port: 4000 });

    expect(await svc.unpublish("web")).toEqual({ removed: true });
    expect(bridge.last()).toEqual([]);
    expect(await svc.unpublish("web")).toEqual({ removed: false }); // idempotent
  });

  it("refuses a dir target that is not a directory — fast, at the door", async () => {
    const bridge = new FakeBridge();
    const svc = service(makeDataDir(), bridge);
    await svc.start();
    await expect(
      svc.publish({ name: "site", target: { kind: "dir", path: "/nonexistent/nowhere" } }),
    ).rejects.toMatchObject({ kind: "PRECONDITION_FAILED" });
    expect(bridge.last()).toEqual([]); // nothing declared for a refused publish

    const dir = makeDataDir();
    const ok = await svc.publish({ name: "site", target: { kind: "dir", path: dir } });
    expect(ok.name).toBe("site");
  });

  it("a failed declare defers, never fails the publish — intent is already durable", async () => {
    const dataDir = makeDataDir();
    const bridge = new FakeBridge();
    bridge.failDeclare = true;
    const svc = service(dataDir, bridge);
    await svc.start();
    const status = await svc.publish({ name: "web", target: { kind: "port", port: 3000 } });
    expect(status.status).toBe("pending"); // honest: declared intent, not carried
    const file = JSON.parse(
      readFileSync(join(dataDir, "registries", "field.artifacts.v1.json"), "utf8"),
    );
    expect(file.artifacts).toHaveLength(1); // the next boot replays it
  });

  it("moves an unreadable registry aside and starts empty — evidence kept, boot alive", async () => {
    const dataDir = makeDataDir();
    mkdirSync(join(dataDir, "registries"), { recursive: true });
    writeFileSync(join(dataDir, "registries", "field.artifacts.v1.json"), "{not json");
    const svc = service(dataDir, new FakeBridge());
    expect(svc.statuses()).toEqual([]);
    expect(svc.health().count).toBe(0);
    // the bad file moved aside rather than being silently overwritten
    const { readdirSync } = await import("node:fs");
    const names = readdirSync(join(dataDir, "registries"));
    expect(names.some((n) => n.startsWith("field.artifacts.v1.json.bad-"))).toBe(true);
  });

  it("emits status changes on serve transitions, deduped", async () => {
    const bridge = new FakeBridge();
    const svc = service(makeDataDir(), bridge);
    await svc.start();
    const seen: string[][] = [];
    cleanup.push(svc.onChanged((statuses) => seen.push(statuses.map((s) => s.status))));
    await svc.publish({ name: "web", target: { kind: "port", port: 3000 } });
    const after = seen.length;
    bridge.fire(); // nothing actually changed — the dedupe holds
    expect(seen.length).toBe(after);
    bridge.serveStates = [
      {
        name: `${ARTIFACT_SERVE_PREFIX}web`,
        target: { kind: "port", port: 3000 },
        status: "active",
        url: "https://mock.ts.net/artifact-web",
      },
    ];
    bridge.fire();
    expect(seen.at(-1)).toEqual(["active"]);
  });
});

describe("the artifact hub over a real daemon (integration)", () => {
  async function boot(dataDir: string) {
    mkdirSync(join(dataDir, "native", "run"), { recursive: true });
    writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
    const mock = new MockMgmtServer(join(dataDir, "native", "run", "mgmt.sock"));
    await mock.start();
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    return { mock, daemon };
  }

  async function rpcFor(port: number, token: string): Promise<WsRpc> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    cleanup.push(() => ws.close());
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    const rpc = new WsRpc(ws);
    await helloAs(rpc, token, "shell-main");
    return rpc;
  }

  it("publish → a serve beside the product serve, a URL back, replay across restart, unpublish", async () => {
    const dataDir = makeDataDir();
    const first = await boot(dataDir);
    // the mock (field-native) OUTLIVES the daemon in this test — the two-plane law
    cleanup.push(() => first.mock.stop());

    const rpc = await rpcFor(first.daemon.controlPort, first.daemon.shellToken);
    const published = (await rpc.call("artifact.publish", {
      name: "web",
      target: { kind: "port", port: 3000 },
    })) as ArtifactStatus;
    expect(published.status).toBe("active");
    expect(published.url).toBe("https://mock.ts.net/artifact-web");

    const serves = first.daemon.health().mesh.serves.map((s) => s.name);
    expect(serves).toContain("product"); // composed, never clobbered
    expect(serves).toContain("artifact-web");

    // fieldd restarts; field-native (the mock) keeps its serve set.
    await first.daemon.stop();
    const second = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => second.stop());
    await until(() => second.health().mesh.serves.some((s) => s.name === "artifact-web"), 8000);
    const rpc2 = await rpcFor(second.controlPort, second.shellToken);
    const listed = (await rpc2.call("artifact.list", {})) as { artifacts: ArtifactStatus[] };
    expect(listed.artifacts).toHaveLength(1);
    expect(listed.artifacts[0]).toMatchObject({
      name: "web",
      status: "active",
      url: "https://mock.ts.net/artifact-web",
    });

    await rpc2.call("artifact.unpublish", { name: "web" });
    expect(second.health().mesh.serves.map((s) => s.name)).not.toContain("artifact-web");
    expect(second.health().mesh.serves.map((s) => s.name)).toContain("product");
  }, 30_000);

  it("the scope gate: workspace.read can list but never publish", async () => {
    const dataDir = makeDataDir();
    const { mock, daemon } = await boot(dataDir);
    cleanup.push(() => mock.stop());
    cleanup.push(() => daemon.stop());

    const shell = await rpcFor(daemon.controlPort, daemon.shellToken);
    const minted = (await shell.call("system.mintWindowToken", {
      scopes: ["workspace.read"],
      label: "observer",
    })) as { token: string };

    const observer = await rpcFor(daemon.controlPort, minted.token);
    const denied = await observer.callErr("artifact.publish", {
      name: "sneak",
      target: { kind: "port", port: 9 },
    });
    expect(denied.data?.kind).toBe("FORBIDDEN_SCOPE");
    const listed = (await observer.call("artifact.list", {})) as { artifacts: unknown[] };
    expect(listed.artifacts).toEqual([]);
  }, 30_000);
});
