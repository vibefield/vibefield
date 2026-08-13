import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PLUGIN_MODULE_SCHEME } from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AuthorizedModule,
  PLUGIN_SCHEME_PRIVILEGES,
  resolvePluginUrl,
  servePluginRequest,
} from "../src/main/plugin-protocol";

// P8b-2 — the plugin module origin (ESP §8.4). The suite is shaped like the app
// scheme's: the parse is pure and each refusal CLASS gets a row, because the
// reason is evidence while every response is the same 404.
//
// What is deliberately NOT tested here is which plugin may load — that is the
// authority's question and it is tested in fieldd (plugin-modules.test.ts).
// This file's whole claim is that main adds nothing to the decision: it parses
// a token, asks, and serves exactly what it was told.

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.reverse()) fn();
  cleanup = [];
  vi.restoreAllMocks();
});

const TOKEN = "0123456789abcdef0123456789abcdef";
const url = (rest: string) => `${PLUGIN_MODULE_SCHEME}://${rest}`;

function fixtureFile(name = "renderer.js", body = "export default {};\n"): string {
  const dir = mkdtempSync(join(tmpdir(), "plugproto-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "dist"), { recursive: true });
  const path = join(dir, "dist", name);
  writeFileSync(path, body);
  return path;
}

describe("resolvePluginUrl (pure)", () => {
  it("accepts exactly `scheme://<32 hex>`", () => {
    expect(resolvePluginUrl(url(TOKEN))).toEqual({ ok: true, token: TOKEN });
    // A standard scheme reports "/" for the empty path; that is still no path.
    expect(resolvePluginUrl(url(`${TOKEN}/`))).toEqual({ ok: true, token: TOKEN });
  });

  it.each([
    ["a path segment", url(`${TOKEN}/../../etc/passwd`), "path-present"],
    ["any path at all", url(`${TOKEN}/renderer.js`), "path-present"],
    ["a query", url(`${TOKEN}?x=1`), "query-present"],
    // `evil@<token>` parses with the token still in the host, so the credential
    // check has to fire FIRST or the URL would be accepted as legitimate. The
    // refusal naming it is the more precise one, and the order is the reason.
    ["credentials", url(`evil@${TOKEN}`), "credentials-in-url"],
    ["a short token", url("abc"), "bad-token"],
    ["uppercase hex", url(TOKEN.toUpperCase()), "bad-token"],
    ["a non-hex token", url("z".repeat(32)), "bad-token"],
    ["another scheme", "vibefield-app://shell/index.html", "unsupported-scheme"],
    ["file:", "file:///etc/passwd", "unsupported-scheme"],
    ["gibberish", "%%%", "malformed-url"],
  ])("refuses %s", (_label, input, reason) => {
    const result = resolvePluginUrl(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe(reason);
  });

  it("never grants a privilege that would let plugin bytes escape the policy", () => {
    // bypassCSP is the one that matters most: plugin code is subject to the
    // document's CSP exactly like ours.
    expect(PLUGIN_SCHEME_PRIVILEGES.bypassCSP).toBe(false);
    expect(PLUGIN_SCHEME_PRIVILEGES.allowServiceWorkers).toBe(false);
  });

  it("stays a legal CORS destination — module fetches are CORS-mode (P8b-3 probe)", () => {
    // Flipped from false at P8b-3 (2026-08-13): with corsEnabled:false the app
    // document's import() of a plugin URL network-errors BEFORE headers are
    // consulted (probe rows B/C1–C3), so the scheme could never serve the one
    // caller it exists for. Electron enforces no response CORS on cors-enabled
    // custom schemes (row G1) — the boundary is tokens + CORP, not this flag.
    // If this ever reads false again, every staged plugin silently stops
    // loading; the e2e staged-load test is the row that catches it live.
    expect(PLUGIN_SCHEME_PRIVILEGES.corsEnabled).toBe(true);
  });
});

describe("servePluginRequest", () => {
  it("serves the bytes the authority named, with the type it named", async () => {
    const path = fixtureFile();
    const authorize = vi.fn(
      async (): Promise<AuthorizedModule> => ({ path, contentType: "text/javascript" }),
    );
    const response = await servePluginRequest(url(TOKEN), { authorize });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await response.text()).toContain("export default");
    expect(authorize).toHaveBeenCalledWith(TOKEN);
  });

  it("REFUSES when the authority says no — the §8.4 clause main is responsible for", async () => {
    const refusals: string[] = [];
    const response = await servePluginRequest(url(TOKEN), {
      authorize: async () => undefined,
      onRefusal: (reason) => refusals.push(reason),
    });
    expect(response.status).toBe(404);
    expect(refusals).toEqual(["unauthorized"]);
  });

  it("refuses when the authority cannot be reached, rather than serving without one", async () => {
    const response = await servePluginRequest(url(TOKEN), {
      authorize: async () => {
        throw new Error("fieldd is down");
      },
    }).catch(() => new Response("threw", { status: 500 }));
    // The handler must not propagate: an unreachable daemon is a 404, never a
    // crash in the protocol handler and never a served file.
    expect(response.status).toBe(404);
  });

  it("never asks the authority about a URL that failed the parse", async () => {
    const authorize = vi.fn(async () => undefined);
    const response = await servePluginRequest(url(`${TOKEN}/renderer.js`), { authorize });
    expect(response.status).toBe(404);
    expect(authorize).not.toHaveBeenCalled();
  });

  it("404s an authorized path that is not there", async () => {
    const response = await servePluginRequest(url(TOKEN), {
      authorize: async () => ({
        path: join(tmpdir(), "nope-", "gone.js"),
        contentType: "text/javascript",
      }),
    });
    expect(response.status).toBe(404);
  });

  it("serves a stylesheet as CSS, since a plugin's styles ride the same origin", async () => {
    const path = fixtureFile("renderer.css", ".x{}\n");
    const response = await servePluginRequest(url(TOKEN), {
      authorize: async () => ({ path, contentType: "text/css" }),
    });
    expect(response.headers.get("Content-Type")).toBe("text/css; charset=utf-8");
  });

  it("serves whatever the authority named, including a symlink — containment is NOT main's job", async () => {
    // This documents the boundary rather than a wish: main cannot contain a
    // path, because containing one needs the plugin root and main knowing a
    // root would be main discovering plugins (§8.4). The symlink defence lives
    // in fieldd's authority, freshly re-proven per authorization
    // (plugin-modules.ts `isContainedFile`) — this row exists so nobody "fixes"
    // main by teaching it about roots.
    const secret = fixtureFile("secret.txt", "SECRET\n");
    const dir = mkdtempSync(join(tmpdir(), "plugproto-link-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const link = join(dir, "renderer.js");
    symlinkSync(secret, link);
    const response = await servePluginRequest(url(TOKEN), {
      authorize: async () => ({ path: link, contentType: "text/javascript" }),
    });
    expect(response.status).toBe(200);
  });
});
