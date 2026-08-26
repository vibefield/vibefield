// @vitest-environment node

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (relativePath: string): string =>
  readFileSync(join(PACKAGE_ROOT, "src", relativePath), "utf8");

describe("Studio composition boundary", () => {
  it("keeps the production entries structurally independent of Studio", () => {
    expect(source("main/index.ts")).not.toMatch(/from ["']\.\.\/studio\//);
    expect(source("preload/index.ts")).not.toContain("studio/");
    expect(source("renderer-host/index.ts")).not.toContain("studio/");
  });

  it("registers the development composition before loading the product main", () => {
    const entry = source("studio/main.ts");
    expect(entry.indexOf("registerDesktopDevelopmentExtension")).toBeLessThan(
      entry.indexOf('import("../main/index")'),
    );
    expect(source("studio/product-preload.ts")).toContain('import "../preload/index";');
  });

  it("gives Studio a host-only lifecycle role and an isolated ephemeral session", () => {
    const host = source("studio/host.ts");
    expect(host).toContain('STUDIO_SESSION_PARTITION = "vibefield-studio"');
    expect(host).not.toContain('STUDIO_SESSION_PARTITION = "persist:');
    expect(host).toContain("createHostAuxiliaryWindow");
    expect(host).toContain("adoptHostAuxiliary");
    expect(host).toContain("installNavigationPolicy");
    expect(host).toContain("installPermissionPolicy");
  });

  it("exposes no raw Electron primitive from the Studio preload", () => {
    const preload = source("studio/studio-preload.ts");
    expect(preload).toContain('"vibefieldStudio"');
    expect(preload).not.toContain("ipcRenderer");
    expect(preload).not.toContain("MessagePort");
  });
});
