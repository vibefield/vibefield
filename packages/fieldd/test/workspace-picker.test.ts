import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CallerContext } from "@vibefield/contracts";
import { afterEach, expect, it, vi } from "vitest";
import { AuditService } from "../src/audit-service";
import { WorkspacePicker } from "../src/workspace/picker";
import { RootsRegistry } from "../src/workspace/roots";
import { until } from "./ws-rpc";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
const windowContext = (): CallerContext => ({
  principal: {
    kind: "local-token",
    tokenId: "window-fs3",
    scopes: ["workspace.read"],
    rendererParticipant: { participantId: "renderer:fs3", incarnation: "renderer:fs3:document" },
  },
  clientKind: "renderer",
  transport: "ws-loopback",
  receivedAt: Date.now(),
});
async function fixture(failSync = 0) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "vf-fs3-pick-")));
  cleanup.push(() => rmSync(base, { recursive: true, force: true }));
  const folder = join(base, "Chosen folder");
  mkdirSync(folder);
  let syncs = 0;
  const audit = new AuditService({
    dataDir: join(base, "user"),
    bootId: "fs3-picker-test",
    hooks: {
      beforeSync: () => {
        if (++syncs === failSync) throw Object.assign(new Error("full"), { code: "ENOSPC" });
      },
    },
  });
  await audit.start();
  cleanup.push(() => audit.close());
  const registry = new RootsRegistry({
    file: join(base, "roots.json"),
    deviceId: () => "desk-one",
    browse: () => ({
      platform: process.platform,
      home: base,
      user: "",
      fs: { readdir: () => [], realpath: (p) => p, isDirectory: () => false, exists: () => false },
    }),
  });
  const choose = vi.fn(async (): Promise<unknown> => ({ canceled: false, path: folder }));
  let current = true;
  const picker = new WorkspacePicker({ registry, audit, choose, isCurrent: () => current });
  return {
    base,
    folder,
    registry,
    choose,
    picker,
    revoke: () => {
      current = false;
    },
  };
}
it("no export precedes successful audit, and either audit failure keeps the registry empty", async () => {
  for (const failedSync of [1, 2]) {
    const w = await fixture(failedSync);
    await expect(w.picker.pick(windowContext(), {})).rejects.toMatchObject({
      kind: "AUDIT_UNAVAILABLE",
    });
    expect(w.registry.roots()).toEqual([]);
    expect(w.choose).toHaveBeenCalledTimes(failedSync === 1 ? 0 : 1);
  }
});
it("cancel is a value, caller-supplied paths have no authority, and only the native choice is exported", async () => {
  const w = await fixture();
  w.choose.mockResolvedValueOnce({ canceled: true });
  expect(await w.picker.pick(windowContext(), { path: w.base })).toEqual({ canceled: true });
  expect(w.registry.roots()).toEqual([]);
  const result = await w.picker.pick(windowContext(), { path: w.base });
  expect(result).toMatchObject({ canceled: false, root: { path: w.folder, kind: "picked" } });
  expect(w.registry.roots()).toHaveLength(1);
  expect(readFileSync(join(w.base, "roots.json"), "utf8")).toContain("Chosen folder");
});
it("a revoked window or concurrent request cannot turn a late dialog answer into an export", async () => {
  const w = await fixture();
  let answer: (value: unknown) => void = () => {};
  w.choose.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  const pending = w.picker.pick(windowContext(), {}).catch((error: unknown) => error);
  await until(() => w.choose.mock.calls.length === 1);
  await expect(w.picker.pick(windowContext(), {})).rejects.toMatchObject({ kind: "CONFLICT" });
  w.revoke();
  answer({ canceled: false, path: w.folder });
  await expect(pending).resolves.toMatchObject({ kind: "FORBIDDEN_SCOPE" });
  expect(w.registry.roots()).toEqual([]);
});
it("plain tokens, shell main, plugins and remote callers are refused before a dialog", async () => {
  const w = await fixture();
  const win = windowContext();
  const callers: CallerContext[] = [
    { ...win, principal: { kind: "local-token", tokenId: "plain", scopes: ["workspace.read"] } },
    { ...win, clientKind: "shell-main" },
    { ...win, principal: { kind: "plugin", id: "example.plugin", scopes: ["workspace.read"] } },
    { ...win, transport: "ws-tailnet" },
  ];
  for (const ctx of callers)
    await expect(w.picker.pick(ctx, {})).rejects.toMatchObject({ kind: "FORBIDDEN_SCOPE" });
  expect(w.choose).not.toHaveBeenCalled();
});
it("a failed save returns an honest refusal and publishes no root", async () => {
  const w = await fixture();
  writeFileSync(join(w.base, "roots.json"), "{}");
  // Block the registry's parent after it was loaded without relying on the
  // test runner's filesystem permission privileges.
  const blocked = join(w.base, "blocked");
  writeFileSync(blocked, "file");
  const registry = new RootsRegistry({ file: join(blocked, "roots.json"), deviceId: () => "desk" });
  const audit = new AuditService({ dataDir: join(w.base, "other-user"), bootId: "fs3-save" });
  await audit.start();
  cleanup.push(() => audit.close());
  const picker = new WorkspacePicker({ registry, audit, choose: w.choose, isCurrent: () => true });
  await expect(picker.pick(windowContext(), {})).rejects.toMatchObject({ kind: "UNAVAILABLE" });
  expect(registry.roots().filter((root) => root.kind === "picked")).toEqual([]);
});
