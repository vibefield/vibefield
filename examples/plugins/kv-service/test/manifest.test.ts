import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePluginManifest } from "@vibefield/contracts";
import { canonicalJson } from "@vibefield/plugin-build";
import { activateServiceWithMockHost } from "@vibefield/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import kvService from "../service.js";
import { kvManifest } from "../src/manifest";

// The plugin contract in miniature (P4 edition, service side): the CANONICAL
// manifest V1-validates, ACTIVATION provides exactly the declared namespace
// and methods (proven against the SDK's mock host — no worker, no daemon),
// the committed artifact is the canonical emission, and the store's actual
// behavior (round-trip, watch fan-out) is exercised directly against the
// collected handlers.
describe("plugin-example-kv", () => {
  const [serviceDecl] = kvManifest.contributes?.services ?? [];
  if (serviceDecl === undefined) throw new Error("manifest declares no services");
  const NAMESPACE = serviceDecl.namespace;
  const call = { caller: { kind: "test" } };

  it("the committed vibefield.plugin.json is the canonical emission (regen: pnpm gen:manifest)", () => {
    const result = validatePluginManifest(kvManifest);
    if (!result.ok) throw new Error(result.issues.join(" · "));
    const artifact = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "vibefield.plugin.json"),
      "utf8",
    );
    expect(artifact).toBe(canonicalJson(result.manifest));
  });

  it("activation provides exactly the manifest's declared namespace and method kinds", async () => {
    const session = await activateServiceWithMockHost(kvService, {
      id: kvManifest.id,
      version: kvManifest.version,
    });
    expect([...session.provided.keys()]).toEqual([NAMESPACE]);
    const methods = session.provided.get(NAMESPACE);
    expect([...(methods?.keys() ?? [])].sort()).toEqual(
      serviceDecl.methods.map((m) => m.name).sort(),
    );
    for (const decl of serviceDecl.methods) expect(methods?.get(decl.name)?.kind).toBe(decl.kind);
  });

  it("set then get round-trips through the store", async () => {
    const session = await activateServiceWithMockHost(kvService, { id: kvManifest.id });
    const methods = session.provided.get(NAMESPACE);
    const setHandler = methods?.get("set");
    const getHandler = methods?.get("get");
    if (setHandler?.kind !== "mutation" || getHandler?.kind !== "query")
      throw new Error("expected get/set handlers");
    expect(await setHandler.handle({ key: "a", value: "1" }, call)).toEqual({ ok: true });
    expect(await getHandler.handle({ key: "a" }, call)).toEqual({ value: "1" });
  });

  it("get on a key that was never set returns null, never throws", async () => {
    const session = await activateServiceWithMockHost(kvService, { id: kvManifest.id });
    const getHandler = session.provided.get(NAMESPACE)?.get("get");
    if (getHandler?.kind !== "query") throw new Error("expected a get handler");
    expect(await getHandler.handle({ key: "missing" }, call)).toEqual({ value: null });
  });

  it("watch: snapshot on subscribe, delta on set, silence after dispose", async () => {
    const session = await activateServiceWithMockHost(kvService, { id: kvManifest.id });
    const methods = session.provided.get(NAMESPACE);
    const watchHandler = methods?.get("watch");
    const setHandler = methods?.get("set");
    if (watchHandler?.kind !== "subscription" || setHandler?.kind !== "mutation")
      throw new Error("expected watch/set handlers");

    const snapshots: unknown[] = [];
    const deltas: unknown[] = [];
    const sink = {
      snapshot: (value: unknown) => snapshots.push(value),
      delta: (value: unknown) => deltas.push(value),
    };

    const disposable = await watchHandler.subscribe({ key: "b" }, call, sink);
    expect(snapshots).toEqual([{ value: null }]);

    await setHandler.handle({ key: "b", value: "x" }, call);
    expect(deltas).toEqual([{ value: "x" }]);

    await disposable.dispose();
    await setHandler.handle({ key: "b", value: "y" }, call);
    expect(deltas).toEqual([{ value: "x" }]); // no delta after dispose
  });
});
