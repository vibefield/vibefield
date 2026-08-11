import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LinkService } from "../src/link-service";
import { RpcCallError } from "../src/native-link";

// UA-3 — the link lifecycle at its seam: capture folds honest states from the
// native answers, the stored login never guesses, and unlink clears exactly
// the identity. Probes are driven directly; the timer loop is cadence only.

const mkRoot = () => mkdtempSync(join(tmpdir(), "vf-link-"));
const linkPath = (root: string) => join(root, "fieldd", "link.json");

type Responder = () => Promise<unknown>;

function build(root: string, respond: (method: string) => Promise<unknown>) {
  const calls: string[] = [];
  const svc = new LinkService({
    dataDir: root,
    native: {
      request: (method: string) => {
        calls.push(method);
        return respond(method);
      },
    },
    now: () => 1_754_000_000_000,
  });
  return { svc, calls };
}

const probe = (svc: LinkService) => (svc as unknown as { probe: () => Promise<void> }).probe();

describe("UA-3 — LinkService", () => {
  it("folds a disabled mesh honestly", async () => {
    const root = mkRoot();
    const { svc } = build(root, () =>
      Promise.reject(
        new RpcCallError("UNAVAILABLE", "mesh node not up", true, {
          service: "mesh-gateway",
          state: "disabled",
        }),
      ),
    );
    await probe(svc);
    expect(svc.status()).toMatchObject({ meshEnabled: false, nodeState: "disabled", link: null });
  });

  it("surfaces the auth URL while login is pending", async () => {
    const root = mkRoot();
    const { svc } = build(root, () =>
      Promise.reject(
        new RpcCallError("UNAVAILABLE", "mesh node not up", true, {
          service: "mesh-gateway",
          state: "starting",
          authUrl: "https://login.tailscale.example/a/b",
        }),
      ),
    );
    await probe(svc);
    expect(svc.status()).toMatchObject({
      meshEnabled: true,
      nodeState: "starting",
      authUrl: "https://login.tailscale.example/a/b",
    });
  });

  it("captures the self-whois login once, with the tailnet suffix", async () => {
    const root = mkRoot();
    const { svc } = build(root, () =>
      Promise.resolve({
        deviceId: "01DEVICE",
        dnsName: "host.tail1234.ts.net",
        login: "james@github",
      }),
    );
    let changes = 0;
    svc.on("changed", () => changes++);
    await probe(svc);
    const written = JSON.parse(readFileSync(linkPath(root), "utf8"));
    expect(written.login).toBe("james@github");
    expect(written.tailnet).toBe("tail1234.ts.net");
    expect(written.linkedAt).toBe(new Date(1_754_000_000_000).toISOString());
    expect(svc.status().link?.login).toBe("james@github");
    // second probe, same login: verified in memory, no disk churn
    const before = readFileSync(linkPath(root), "utf8");
    await probe(svc);
    expect(readFileSync(linkPath(root), "utf8")).toBe(before);
    expect(changes).toBe(1); // the verify changed nothing material
  });

  it("a Running node without a login is a typed pre-capture state, not a write", async () => {
    const root = mkRoot();
    const { svc } = build(root, () => Promise.resolve({ deviceId: "01DEVICE" }));
    await probe(svc);
    expect(existsSync(linkPath(root))).toBe(false);
    expect(svc.status()).toMatchObject({ meshEnabled: true, nodeState: "up", link: null });
  });

  it("a corrupt link.json pauses capture and is never overwritten by a guess", async () => {
    const root = mkRoot();
    mkdirSync(join(root, "fieldd"), { recursive: true });
    writeFileSync(linkPath(root), "{ not json");
    const { svc } = build(root, () =>
      Promise.resolve({ deviceId: "01DEVICE", login: "james@github" }),
    );
    await probe(svc);
    expect(readFileSync(linkPath(root), "utf8")).toBe("{ not json");
    expect(svc.status().link).toBeNull();
  });

  it("a login change under a live link rewrites the record, keeps linkedAt, and warns (UA-4)", async () => {
    const root = mkRoot();
    let login = "james@github";
    const warns: string[] = [];
    const spyLogger = {
      child: () => spyLogger,
      trace() {},
      debug() {},
      info() {},
      warn(event: string) {
        warns.push(event);
      },
      error() {},
      fatal() {},
      isLevelEnabled: () => true,
    };
    const svc = new LinkService({
      dataDir: root,
      native: { request: () => Promise.resolve({ deviceId: "01DEVICE", login }) },
      now: () => 1_754_000_000_000,
      logger: spyLogger as unknown as import("@vibefield/logging").Logger,
    });
    await probe(svc);
    const first = JSON.parse(readFileSync(linkPath(root), "utf8"));
    expect(first.login).toBe("james@github");
    expect(warns).toEqual([]);

    // the trust root moves under the node (account switch without unlink):
    // the stored value follows — the door's verdicts re-scope from here —
    // and the event is loud, not silent
    login = "other@github";
    await probe(svc);
    const second = JSON.parse(readFileSync(linkPath(root), "utf8"));
    expect(second.login).toBe("other@github");
    expect(second.linkedAt).toBe(first.linkedAt);
    expect(warns).toEqual(["fieldd.link.login_changed"]);
  });

  it("unlink retires natively, clears the record, and reports the archive", async () => {
    const root = mkRoot();
    const { svc, calls } = build(root, (method) =>
      method === "native.mesh.retire"
        ? Promise.resolve({ retired: true, archivedTo: "/tmp/mesh.retired-1" })
        : Promise.resolve({ deviceId: "01DEVICE", login: "james@github" }),
    );
    await probe(svc);
    expect(existsSync(linkPath(root))).toBe(true);
    const result = await svc.unlink();
    expect(result).toMatchObject({ retired: true, archivedTo: "/tmp/mesh.retired-1" });
    expect(calls).toContain("native.mesh.retire");
    expect(existsSync(linkPath(root))).toBe(false);
    expect(svc.status()).toMatchObject({ link: null, meshEnabled: false, nodeState: "disabled" });
  });
});
