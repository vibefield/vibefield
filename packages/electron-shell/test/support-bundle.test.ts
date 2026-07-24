import { access, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { AuditLedgerWriter } from "@vibefield/audit";
import { LOG_STREAMS, PORTS } from "@vibefield/contracts";
import { createNoopLogger } from "@vibefield/logging";
import { afterEach, describe, expect, it } from "vitest";
import { CrashArtifactManager } from "../src/main/crash-artifacts";
import { createElectronLogging } from "../src/main/logging";
import { SupportBundleService } from "../src/main/support-bundle";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function unpackTarGz(raw: Buffer): Map<string, Buffer> {
  const tar = gunzipSync(raw);
  const files = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 512 <= tar.byteLength) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const sizeText = header.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim();
    const size = Number.parseInt(sizeText || "0", 8);
    offset += 512;
    files.set(name, Buffer.from(tar.subarray(offset, offset + size)));
    offset += Math.ceil(size / 512) * 512;
  }
  return files;
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "vibefield-support-"));
  roots.push(root);
  const logRoot = join(root, "logs");
  const logging = await createElectronLogging({
    logRoot,
    dataRoot: root,
    bootId: "desktop-support-test",
  });
  const crashes = new CrashArtifactManager({
    dataRoot: root,
    crashDumpsRoot: join(root, "dumps"),
    bootId: "desktop-support-test",
    appVersion: "1.2.3",
    logger: createNoopLogger(),
  });
  await crashes.initialize();
  const service = new SupportBundleService({
    dataRoot: root,
    logRoot,
    crashArtifacts: crashes,
    logger: createNoopLogger(),
    aliases: {
      home: root,
      temp: tmpdir(),
      logs: logRoot,
      data: root,
    },
    versions: {
      vibeField: "1.2.3",
      electron: "43.1.1",
      node: process.versions.node,
      contracts: "0.1.0",
    },
    collectContext: async () => ({
      userId: "real-user-id",
      env: { SHOULD_NOT: "leave" },
      mesh: {
        url: `http://127.0.0.1:${PORTS.FIELDD_WS_CONTROL}/t/route-secret-abcdefghijklmnop`,
      },
      note: "connect at https://alice:password@example.test/private?q=secret#fragment",
      pem: "-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----",
      root,
    }),
  });
  await service.initialize();
  return { root, logRoot, logging, crashes, service };
}

describe("previewed support bundles", () => {
  it("exports a second-scrubbed default bundle with no plugin, audit, crash, or canary data", async () => {
    const { root, logging, crashes, service } = await fixture();
    const now = Date.now();
    logging.logger.info("desktop.support.normal", "normal record", {
      docId: "real-document-id",
      location: join(root, "private", "document.txt"),
      token: "abcdefghijklmnopqrstuvwxyz123456",
    });
    logging.logger.info("desktop.support.canary", "must be omitted", {
      note: "VIBEFIELD_SUPPORT_CANARY_should_never_export",
    });
    logging.pluginRendererRouter.accept(
      {
        id: "example.secret-plugin",
        version: "1.0.0",
        installRevision: "revision-secret",
        entry: "renderer",
        windowId: "window-secret",
        installSource: "bundled",
        trust: "r0-bundled",
      },
      { level: "info", message: "plugin content must stay excluded" },
    );
    await Promise.all([logging.desktop.flush(), logging.pluginRenderer.flush()]);

    const preview = await service.preview({
      range: { from: now - 24 * 60 * 60 * 1_000, to: now + 1_000 },
      sources: [LOG_STREAMS.SYSTEM_DESKTOP],
      pluginIds: [],
      includeAudit: false,
      crashArtifactIds: [],
    });
    expect(preview.manifest).toMatchObject({
      sources: [LOG_STREAMS.SYSTEM_DESKTOP],
      pluginAliases: [],
      includesAudit: false,
      crashArtifacts: [],
    });
    expect(preview.manifest.omittedRecords).toBeGreaterThanOrEqual(1);
    expect(preview.warnings[0]).toContain("sensitive");

    const destination = join(root, "support-default.tar.gz");
    const result = await service.export(preview.previewId, destination);
    expect(result).toMatchObject({ status: "exported", bundleId: preview.manifest.bundleId });
    expect((await stat(destination)).mode & 0o777).toBe(0o600);
    const files = unpackTarGz(await readFile(destination));
    expect([...files.keys()]).toEqual(
      expect.arrayContaining([
        "logs/system/desktop.ndjson",
        "health/runtime.json",
        "doctor/status.json",
        "manifest.json",
      ]),
    );
    const allText = [...files.values()].map((value) => value.toString("utf8")).join("\n");
    expect(allText).toContain("desktop.support.normal");
    expect(allText).toContain("doc-1");
    expect(allText).not.toContain("real-document-id");
    expect(allText).not.toContain("example.secret-plugin");
    expect(allText).not.toContain("plugin content must stay excluded");
    expect(allText).not.toContain("VIBEFIELD_SUPPORT_CANARY");
    expect(allText).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    expect(allText).not.toContain("route-secret-abcdefghijklmnop");
    expect(allText).not.toContain("alice:password");
    expect(allText).not.toContain("q=secret");
    expect(allText).not.toContain("private-material");
    expect(allText).not.toContain("SHOULD_NOT");
    expect(allText).not.toContain(root);

    await crashes.markClean();
    await logging.close();
  });

  it("includes only explicitly selected plugin logs and crash artifacts", async () => {
    const { root, logging, crashes, service } = await fixture();
    const now = Date.now();
    const pluginId = "example.selected-plugin";
    logging.pluginRendererRouter.accept(
      {
        id: pluginId,
        version: "1.0.0",
        installRevision: "revision-selected",
        entry: "renderer",
        windowId: "window-selected",
        installSource: "bundled",
        trust: "r0-bundled",
      },
      { level: "warn", message: "selected plugin evidence" },
    );
    await logging.pluginRenderer.flush();
    await writeFile(join(root, "dumps", "renderer.dmp"), "explicit crash bytes");
    const crashList = await crashes.refresh("renderer");
    const crashId = crashList.artifacts[0]?.artifactId;
    expect(crashId).toBeDefined();

    const preview = await service.preview({
      range: { from: now - 60_000, to: now + 1_000 },
      sources: [LOG_STREAMS.PLUGINS_RENDERER],
      pluginIds: [pluginId],
      includeAudit: false,
      crashArtifactIds: [crashId],
    });
    expect(preview.manifest.pluginAliases).toEqual(["plugin-1"]);
    expect(preview.manifest.crashArtifacts).toEqual(["crash-1"]);
    expect(preview.warnings.join(" ")).toContain("crash dumps");

    const destination = join(root, "support-selected.tar.gz");
    await service.export(preview.previewId, destination);
    const files = unpackTarGz(await readFile(destination));
    expect(files.get("crash/crash-1.dmp")?.toString("utf8")).toBe("explicit crash bytes");
    expect(files.get("logs/plugins/plugin-1/renderer.ndjson")?.toString("utf8")).toContain(
      "selected plugin evidence",
    );
    const allText = [...files.values()].map((value) => value.toString("utf8")).join("\n");
    expect(allText).not.toContain(pluginId);
    expect(allText).not.toContain("revision-selected");
    expect((await crashes.refresh()).artifacts[0]?.exported).toBe(true);

    await crashes.markClean();
    await logging.close();
  });

  it("rejects unavailable audit data and detects a crash artifact changed after preview", async () => {
    const { root, logging, crashes, service } = await fixture();
    const now = Date.now();
    await expect(
      service.preview({
        range: { from: now - 1_000, to: now },
        sources: [LOG_STREAMS.SYSTEM_DESKTOP],
        includeAudit: true,
      }),
    ).rejects.toMatchObject({
      kind: "NOT_FOUND",
    });

    const dump = join(root, "dumps", "changed.dmp");
    await writeFile(dump, "before");
    const crash = (await crashes.refresh("renderer")).artifacts[0];
    expect(crash).toBeDefined();
    const preview = await service.preview({
      range: { from: now - 1_000, to: now + 1_000 },
      sources: [LOG_STREAMS.SYSTEM_DESKTOP],
      crashArtifactIds: [crash?.artifactId],
    });
    await writeFile(dump, "changed after preview");
    const destination = join(root, "must-not-exist.tar.gz");
    await expect(service.export(preview.previewId, destination)).rejects.toThrow(
      "crash artifact changed",
    );
    await expect(access(destination)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await crashes.refresh()).artifacts[0]?.exported).toBe(false);

    await crashes.markClean();
    await logging.close();
  });

  it("includes only explicitly selected, verified, second-scrubbed audit projections", async () => {
    const { root, logging, crashes, service } = await fixture();
    const now = Date.now();
    const writer = new AuditLedgerWriter({
      dataDir: root,
      bootId: "fieldd-support-audit",
      now: () => now,
    });
    await writer.initialize();
    await writer.append({
      v: 1,
      eventId: "audit_support_raw",
      time: now,
      actor: { kind: "shell-main", id: "tk_sensitive_actor" },
      action: "support.bundle.export",
      target: { kind: "support-bundle", id: "real-bundle-id" },
      phase: "outcome",
      outcome: "succeeded",
      operationId: "real-operation-id",
      transportProvenance: "ws-loopback",
      attrs: {
        token: "tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        note: "VIBEFIELD_SUPPORT_CANARY_audit_second_scrub",
      },
    });
    await writer.close();

    const preview = await service.preview({
      range: { from: now - 1_000, to: now + 1_000 },
      sources: [LOG_STREAMS.SYSTEM_DESKTOP],
      includeAudit: true,
    });
    expect(preview.manifest.includesAudit).toBe(true);
    expect(preview.manifest.files).toContainEqual(
      expect.objectContaining({ path: "audit/own-actions.jsonl", category: "audit" }),
    );
    expect(preview.warnings.join(" ")).toContain("audit records");

    const destination = join(root, "support-with-audit.tar.gz");
    await service.export(preview.previewId, destination);
    const files = unpackTarGz(await readFile(destination));
    const audit = files.get("audit/own-actions.jsonl")?.toString("utf8") ?? "";
    expect(audit).toContain("support.bundle.export");
    expect(audit).not.toContain("tk_sensitive_actor");
    expect(audit).not.toContain("real-bundle-id");
    expect(audit).not.toContain("real-operation-id");
    expect(audit).not.toContain("tok_aaaaaaaa");
    expect(audit).not.toContain("VIBEFIELD_SUPPORT_CANARY");
    expect(audit).not.toContain("integrity");

    await crashes.markClean();
    await logging.close();
  });

  it("rejects ambiguous duplicate selections and releases a cancelled preview", async () => {
    const { root, logging, crashes, service } = await fixture();
    const now = Date.now();
    await expect(
      service.preview({
        range: { from: now - 1_000, to: now },
        sources: [LOG_STREAMS.SYSTEM_DESKTOP, LOG_STREAMS.SYSTEM_DESKTOP],
      }),
    ).rejects.toMatchObject({ kind: "PRECONDITION_FAILED" });

    const preview = await service.preview({
      range: { from: now - 1_000, to: now },
      sources: [LOG_STREAMS.SYSTEM_DESKTOP],
    });
    expect(service.cancelled(preview.previewId)).toMatchObject({
      status: "cancelled",
      bundleId: preview.manifest.bundleId,
    });
    await expect(
      service.export(preview.previewId, join(root, "never-written.tar.gz")),
    ).rejects.toMatchObject({ kind: "NOT_FOUND" });

    await crashes.markClean();
    await logging.close();
  });
});
