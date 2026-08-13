import { createHash } from "node:crypto";
import { HOST_SINGLETON_MODULE_SPECIFIERS } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { APP_ORIGIN } from "../src/main/app-origin";
import { importMapHashesFromHtml } from "../src/main/security-policy";
import {
  importMapJson,
  isExpectedSingletonWarning,
  SINGLETON_CHUNK_PREFIX,
  singletonChunkName,
  singletonInputs,
  singletonSlug,
} from "../src/vite/host-singletons";

// P8b-3 §11.6 — the build-side half of the staged loader.
//
// The map's bytes are a SECURITY input, not just build output: main admits the
// inline script by hashing exactly these bytes out of the built HTML, and the
// policy has no other inline-script allowance. So the rows below are about
// byte-stability as much as about content — a map that serialized differently
// on two machines would be a renderer that boots on one of them.

describe("host singleton addresses", () => {
  it("covers exactly the specifiers contracts declares bindable", () => {
    const mapped = Object.keys(JSON.parse(importMapJson()).imports as Record<string, string>);
    expect([...mapped].sort()).toEqual([...HOST_SINGLETON_MODULE_SPECIFIERS].sort());
    expect(Object.keys(singletonInputs())).toHaveLength(HOST_SINGLETON_MODULE_SPECIFIERS.length);
  });

  it("slugs every specifier to a distinct, file-safe name", () => {
    const slugs = HOST_SINGLETON_MODULE_SPECIFIERS.map(singletonSlug);
    // A collision here would silently serve one plugin another plugin's library
    // — the failure would look like a version mismatch, not like a name clash.
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(singletonSlug("@react-three/fiber")).toBe("react-three-fiber");
    expect(singletonSlug("react/jsx-runtime")).toBe("react-jsx-runtime");
    expect(singletonChunkName("react")).toBe(`${SINGLETON_CHUNK_PREFIX}react`);
  });

  it("points every specifier at an unhashed chunk on the app origin", () => {
    const imports = JSON.parse(importMapJson()).imports as Record<string, string>;
    for (const [specifier, url] of Object.entries(imports)) {
      // Absolute and same-origin: the map is read by the DOCUMENT, so a plugin
      // module's own origin never enters the resolution (the 2026-08-13 probe's
      // row G4, which is what retired P8-D9's plugin-origin chunks).
      expect(url).toBe(`${APP_ORIGIN}/assets/${singletonChunkName(specifier)}.js`);
      expect(url).not.toMatch(/-[A-Za-z0-9_-]{8}\.js$/);
    }
  });
});

describe("the import map's bytes", () => {
  it("serializes identically across calls, with sorted keys", () => {
    const first = importMapJson();
    const second = importMapJson();
    expect(first).toBe(second);
    const keys = Object.keys(JSON.parse(first).imports as Record<string, string>);
    expect(keys).toEqual([...keys].sort());
  });

  it("hashes to a token main's CSP builder derives from the same bytes", () => {
    // The pairing, end to end and in one row: the tag this plugin injects, read
    // back by the function main runs over the built HTML, must produce the hash
    // of the map's own bytes. If either side changes its spelling — an extra
    // attribute, a reformatted body — this row fails instead of the renderer.
    const json = importMapJson();
    const html = `<!doctype html><html><head><script type="importmap">${json}</script></head></html>`;
    const expected = `sha256-${createHash("sha256").update(json, "utf8").digest("base64")}`;
    expect(importMapHashesFromHtml(html)).toEqual([expected]);
  });
});

describe("the expected-warning filter", () => {
  it("drops the singletons' own undefined-default warning and nothing else", () => {
    expect(
      isExpectedSingletonWarning({
        code: "IMPORT_IS_UNDEFINED",
        id: "\0vf-singleton:@vibecook/ice",
      }),
    ).toBe(true);
    // The same code from a REAL module is a real finding and stays visible.
    expect(
      isExpectedSingletonWarning({ code: "IMPORT_IS_UNDEFINED", id: "/src/field-engine.ts" }),
    ).toBe(false);
    expect(
      isExpectedSingletonWarning({ code: "CIRCULAR_DEPENDENCY", id: "\0vf-singleton:react" }),
    ).toBe(false);
  });
});
